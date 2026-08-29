import { Maximize } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DebugOverlay } from "../../components/DebugOverlay.js";
import { QrCode } from "../../components/QrCode.js";
import { useSignaling } from "../../hooks/useSignaling.js";
import { type I18nKey, useI18n } from "../../i18n/i18n.js";
import {
	type AspectMode,
	containerStyleForAspect,
	videoObjectFitForAspect,
} from "../../lib/aspect.js";
import { enterFullscreen } from "../../lib/fullscreen.js";
import { type MediaErrorKind, mediaErrorKind } from "../../lib/mediaError.js";
import {
	type PeerSession,
	RTC_CONFIG,
	createPeerSession,
	iceCandidateToMessage,
} from "../../lib/webrtc.js";
import { getInboundVideoStats } from "../../lib/webrtcStats.js";

function mediaErrorKey(kind: MediaErrorKind): I18nKey {
	return `mediaError.${kind}` as I18nKey;
}

const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

// La tele real se congelo justo al pasar de resolucion baja a alta a
// mitad de stream (ver docs/webrtc-quality.md): estos umbrales son la
// red de seguridad para cuando vuelva a pasar, no una prueba de que no
// volvera a pasar. "Vivo" = connectionState connected pero framesDecoded
// dejo de avanzar — eso es un decodificador atascado, no una red caida.
//
// LIMITACION CONOCIDA, sin verificar: un restart-ice renegocia la
// conexion, pero si lo que esta atascado es el decodificador de la
// propia tele (no la red ni el peer connection), reiniciar el ICE puede
// no arreglar nada — el problema no es de conectividad. Sin probar
// contra un cuelgue real todavia; si el restart-ice no rescata el caso
// real, lo unico garantizado es que STALL_GIVEUP_MS igualmente saca de
// la imagen congelada y vuelve a un codigo nuevo.
const STALL_RESTART_MS = 5_000;
const STALL_GIVEUP_MS = 15_000;

type ScreenState =
	| { phase: "connecting" }
	| { phase: "code"; code: string; expiresInMs: number }
	| { phase: "peer-connecting" }
	| { phase: "sharing" }
	| {
			phase: "casting";
			url: string;
			needsInteraction: boolean;
			errorKind: MediaErrorKind | null;
	  }
	| { phase: "stalled" }
	| { phase: "error"; message: string };

function senderUrl(code: string): string {
	return `${location.origin}/?code=${code}`;
}

// Vista de la tele: HTTP plano, sin APIs de contexto seguro (SPECS.md §4.4).
export function ScreenView() {
	const { status, send, subscribe } = useSignaling();
	const { t } = useI18n();
	const [state, setState] = useState<ScreenState>({ phase: "connecting" });
	const [debugInfo, setDebugInfo] = useState<Record<string, string>>({});
	const [aspectMode, setAspectMode] = useState<AspectMode>("auto");
	const videoRef = useRef<HTMLVideoElement>(null);
	const castVideoRef = useRef<HTMLVideoElement>(null);
	const sessionRef = useRef<PeerSession | null>(null);
	const statsIntervalRef = useRef<number | null>(null);
	const wakeLockRef = useRef<WakeLockSentinel | null>(null);
	// El switch de mensajes WS vive en un efecto que no se re-suscribe en
	// cada render (deps abajo) — leer `state.phase` ahi dentro daria un
	// valor obsoleto. Un ref se actualiza sin re-suscribir nada, igual que
	// ya hace `streamRef`/`sessionRef` en el resto de esta vista.
	const phaseRef = useRef<ScreenState["phase"]>("connecting");
	useEffect(() => {
		phaseRef.current = state.phase;
	}, [state.phase]);

	// Intento de autoplay explicito (no el atributo HTML) para poder
	// capturar el rechazo: si la tele exige interaccion, se pide con letra
	// enorme en vez de quedarse en negro (encargo M1, parte 2). M-1 midio
	// que el autoplay sin interaccion SI funciona en esta LG — esto es la
	// red de seguridad para cuando no sea el caso (otra tele, otro navegador).
	const castUrl = state.phase === "casting" ? state.url : null;
	useEffect(() => {
		if (castUrl === null) return;
		const video = castVideoRef.current;
		if (!video) return;
		video.play().catch(() => {
			setState((prev) =>
				prev.phase === "casting" ? { ...prev, needsInteraction: true } : prev,
			);
		});
	}, [castUrl]);

	useEffect(() => {
		if (status === "open") send({ type: "create-room" });
	}, [status, send]);

	// Cero scroll, siempre, en cualquier modo y tambien en la pantalla de
	// codigo — toggle de clase (ver index.css), nunca calculo de estilos
	// por JS. Se quita al desmontar para no afectar a otras vistas (el
	// emisor si necesita poder hacer scroll en pantallas pequeñas).
	useEffect(() => {
		document.documentElement.classList.add("kagami-fullscreen");
		document.body.classList.add("kagami-fullscreen");
		return () => {
			document.documentElement.classList.remove("kagami-fullscreen");
			document.body.classList.remove("kagami-fullscreen");
		};
	}, []);

	// La tele se duerme sola: el salvapantallas de webOS no considera un
	// video WebRTC "actividad". Screen Wake Lock API mientras hay video;
	// si el navegador no la soporta (posible en webOS), no hay fallback
	// por JS — hay que desactivar el salvapantallas en la propia tele
	// (no es el modo eco). Ver docs/webrtc-quality.md.
	useEffect(() => {
		const active = state.phase === "sharing" || state.phase === "casting";
		if (!active || !("wakeLock" in navigator)) return;
		let cancelled = false;
		navigator.wakeLock
			.request("screen")
			.then((lock) => {
				if (cancelled) {
					lock.release().catch(() => {});
					return;
				}
				wakeLockRef.current = lock;
			})
			.catch((err) => console.warn("wake lock request failed", err));
		return () => {
			cancelled = true;
			wakeLockRef.current?.release().catch(() => {});
			wakeLockRef.current = null;
		};
	}, [state.phase]);

	// Boton de pantalla completa (encargo M1, parte F) — el elemento de
	// video correcto depende de la fase (espejo o cast), pero el nodo raiz
	// a pedir en pantalla completa es siempre el mismo (ver fullscreen.ts).
	const handleFullscreenClick = useCallback(() => {
		const video =
			state.phase === "casting"
				? castVideoRef.current
				: state.phase === "sharing"
					? videoRef.current
					: null;
		enterFullscreen(document.documentElement, video);
	}, [state.phase]);

	const stopStatsWatcher = useCallback(() => {
		if (statsIntervalRef.current !== null) {
			clearInterval(statsIntervalRef.current);
			statsIntervalRef.current = null;
		}
	}, []);

	// El error, una vez ocurre, sigue activo hasta el proximo cast-url —
	// no hasta el proximo evento del <video> (timeupdate/pause siguen
	// disparandose despues de un error y mandaban errorMessage:null,
	// borrando el aviso en el emisor un instante despues de mostrarlo).
	const castErrorRef = useRef<MediaErrorKind | null>(null);

	// Refleja el estado real del <video> de cast en el emisor (posicion,
	// duracion, pausado, terminado, error) — el emisor no tiene forma
	// propia de saberlo, el video vive solo en la tele.
	const reportCastStatus = useCallback(() => {
		const video = castVideoRef.current;
		if (!video) return;
		send({
			type: "cast-status",
			currentTimeSec: video.currentTime,
			durationSec: Number.isFinite(video.duration) ? video.duration : null,
			paused: video.paused,
			ended: video.ended,
			// El server guarda el ultimo cast-status para poder devolverselo
			// al emisor si reconecta tras bloquear el telefono (SPECS.md §6)
			// — sin esto, un reconectado veria el volumen a un valor
			// inventado en vez del real de la tele.
			volume: video.volume,
			errorMessage: castErrorRef.current,
		});
	}, [send]);

	// Vigila framesDecoded cada segundo. Si la conexion sigue "connected"
	// pero los frames dejan de avanzar, pide un restart-ice al emisor; si
	// eso tampoco lo saca del atasco, se rinde y vuelve a un codigo nuevo
	// en vez de dejar una imagen congelada para siempre.
	const watchStats = useCallback(
		(pc: RTCPeerConnection) => {
			stopStatsWatcher();
			let lastFrames = -1;
			let lastProgressAt = performance.now();
			let restarted = false;

			statsIntervalRef.current = window.setInterval(async () => {
				const inbound = await getInboundVideoStats(pc);
				if (!inbound) return;
				const now = performance.now();
				if (inbound.framesDecoded !== lastFrames) {
					lastFrames = inbound.framesDecoded;
					lastProgressAt = now;
					restarted = false;
				}
				const stalledMs = now - lastProgressAt;
				const alive = pc.connectionState === "connected";

				if (DEBUG) {
					setDebugInfo({
						"ice state": pc.iceConnectionState,
						"conn state": pc.connectionState,
						"frames decoded": String(inbound.framesDecoded),
						"frames dropped": String(inbound.framesDropped),
						"bytes received": String(inbound.bytesReceived),
						resolution:
							inbound.frameWidth && inbound.frameHeight
								? `${inbound.frameWidth}x${inbound.frameHeight}`
								: "?",
						"stalled for": `${Math.round(stalledMs / 1000)}s`,
					});
				}

				if (alive && stalledMs > STALL_GIVEUP_MS) {
					stopStatsWatcher();
					send({ type: "leave" });
					pc.close();
					sessionRef.current = null;
					if (videoRef.current) videoRef.current.srcObject = null;
					setState({ phase: "stalled" });
					window.setTimeout(() => send({ type: "create-room" }), 2_500);
				} else if (alive && stalledMs > STALL_RESTART_MS && !restarted) {
					restarted = true;
					send({ type: "restart-ice" });
				}
			}, 1_000);
		},
		[send, stopStatsWatcher],
	);

	useEffect(
		() =>
			subscribe((msg) => {
				switch (msg.type) {
					case "room-created":
						setState({
							phase: "code",
							code: msg.code,
							expiresInMs: msg.expiresInMs,
						});
						break;

					case "peer-joined":
						// Puede ser el emparejamiento inicial (pasar a esperar una
						// oferta o un cast), o un emisor reconectando a una sala que
						// quedo "pantalla sola" durante un cast (SPECS.md §6) — en ese
						// caso NO hay que tocar el estado: el video ya esta
						// reproduciendose y no depende de que el emisor este ahi.
						if (phaseRef.current !== "casting") {
							setState({ phase: "peer-connecting" });
						}
						break;

					case "offer": {
						stopStatsWatcher();
						const pc = new RTCPeerConnection(RTC_CONFIG);
						const session = createPeerSession(pc);
						sessionRef.current = session;

						pc.ontrack = (ev) => {
							const video = videoRef.current;
							if (video) {
								video.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
								video.play().catch(() => {});
							}
							setState({ phase: "sharing" });
							watchStats(pc);
						};
						pc.onicecandidate = (ev) => {
							if (ev.candidate)
								send({
									type: "ice",
									candidate: iceCandidateToMessage(ev.candidate),
								});
						};

						session
							.setRemoteDescription(msg.sdp)
							.then(() => pc.createAnswer())
							.then(async (answer) => {
								await pc.setLocalDescription(answer);
								send({
									type: "answer",
									sdp: answer as { type: "answer"; sdp: string },
								});
							})
							.catch((err) =>
								setState({ phase: "error", message: String(err) }),
							);
						break;
					}

					case "ice":
						sessionRef.current?.addRemoteIce(msg.candidate);
						break;

					case "set-aspect-mode":
						setAspectMode(msg.mode);
						break;

					case "cast-url":
						// Un cast puede llegar en cualquier estado previo (recien
						// emparejado, o cambiando de espejo a cast en la misma sala) —
						// se cierra cualquier PeerConnection de espejo que hubiera.
						stopStatsWatcher();
						sessionRef.current?.pc.close();
						sessionRef.current = null;
						if (videoRef.current) videoRef.current.srcObject = null;
						castErrorRef.current = null;
						setState({
							phase: "casting",
							url: msg.url,
							needsInteraction: false,
							errorKind: null,
						});
						break;

					case "cast-file-ready":
						// Igual que "cast-url", pero el path es relativo: el emisor
						// pudo subir por un host distinto (HTTPS, detras de un
						// dominio), la pantalla siempre resuelve contra su propio
						// origen (SPECS.md §4.4 — HTTP plano, mismo server real).
						stopStatsWatcher();
						sessionRef.current?.pc.close();
						sessionRef.current = null;
						if (videoRef.current) videoRef.current.srcObject = null;
						castErrorRef.current = null;
						setState({
							phase: "casting",
							url: new URL(msg.path, location.origin).toString(),
							needsInteraction: false,
							errorKind: null,
						});
						break;

					case "cast-play":
						castVideoRef.current?.play().catch(() => {
							setState((prev) =>
								prev.phase === "casting"
									? { ...prev, needsInteraction: true }
									: prev,
							);
						});
						break;

					case "cast-pause":
						castVideoRef.current?.pause();
						break;

					case "cast-seek":
						if (castVideoRef.current)
							castVideoRef.current.currentTime = msg.positionSec;
						break;

					case "cast-volume":
						if (castVideoRef.current)
							castVideoRef.current.volume = Math.min(
								1,
								Math.max(0, msg.volume),
							);
						break;

					case "peer-left":
						// Es justo la ventaja del cast frente al espejo (SPECS.md §2 y
						// §6): el emisor puede desconectarse (bloquear el telefono) sin
						// que el video se detenga — vive solo en el <video> de la tele,
						// no depende de que el WS del emisor siga vivo. La sala queda
						// "pantalla sola" en el server (hasta 30 min, SPECS.md §6): el
						// MISMO codigo puede reconectar y recuperar el control. Si nadie
						// lo hace a tiempo, llega "screen-alone-expired" aparte — eso si
						// hay que atenderlo.
						if (phaseRef.current === "casting") break;
						stopStatsWatcher();
						sessionRef.current?.pc.close();
						sessionRef.current = null;
						if (videoRef.current) videoRef.current.srcObject = null;
						setState({ phase: "connecting" });
						send({ type: "create-room" });
						break;

					case "screen-alone-expired":
						// Se acabaron los 30 min de "pantalla sola" sin que nadie
						// reconectara — esta vez la sala si murio de verdad, a
						// diferencia de "peer-left" durante el cast (que se ignora
						// arriba a proposito).
						stopStatsWatcher();
						sessionRef.current?.pc.close();
						sessionRef.current = null;
						if (videoRef.current) videoRef.current.srcObject = null;
						if (castVideoRef.current) castVideoRef.current.src = "";
						castErrorRef.current = null;
						setState({ phase: "connecting" });
						send({ type: "create-room" });
						break;

					case "error":
						setState({ phase: "error", message: msg.message });
						break;
				}
			}),
		[subscribe, send, stopStatsWatcher, watchStats],
	);

	useEffect(() => stopStatsWatcher, [stopStatsWatcher]);

	return (
		<div className="relative flex h-[100dvh] w-[100dvw] items-center justify-center overflow-hidden bg-black text-white">
			{/* La caja decide el tamaño por modo (containerStyleForAspect); el
			    video en si es siempre 100%/100%/block dentro de ella y solo
			    cambia su object-fit (videoObjectFitForAspect). Lo que se ve
			    "vacio" alrededor de la caja es el fondo #000 de este div raiz
			    asomando — nunca un elemento de franja por encima del video. */}
			<div
				data-testid="video-wrapper"
				className={
					state.phase === "sharing"
						? "flex items-center justify-center"
						: "hidden"
				}
				style={
					state.phase === "sharing"
						? containerStyleForAspect(aspectMode)
						: undefined
				}
			>
				{/* biome-ignore lint/a11y/useMediaCaption: espejo en vivo, no hay pista de subtitulos que adjuntar */}
				<video
					ref={videoRef}
					autoPlay
					playsInline
					className="block h-full w-full"
					style={{ objectFit: videoObjectFitForAspect(aspectMode) }}
				/>
			</div>

			{state.phase === "casting" && (
				<div className="relative flex h-full w-full items-center justify-center">
					{/* biome-ignore lint/a11y/useMediaCaption: cast de un video externo del emisor, sin pista de subtitulos que adjuntar */}
					<video
						ref={castVideoRef}
						data-testid="cast-video"
						src={state.url}
						playsInline
						className="h-full w-full"
						style={{ objectFit: "contain" }}
						onLoadedMetadata={() => reportCastStatus()}
						onTimeUpdate={() => reportCastStatus()}
						onPlay={() => {
							setState((prev) =>
								prev.phase === "casting"
									? { ...prev, needsInteraction: false }
									: prev,
							);
							reportCastStatus();
						}}
						onPause={() => reportCastStatus()}
						onEnded={() => reportCastStatus()}
						onError={(ev) => {
							const kind = mediaErrorKind(ev.currentTarget.error);
							castErrorRef.current = kind;
							setState((prev) =>
								prev.phase === "casting" ? { ...prev, errorKind: kind } : prev,
							);
							reportCastStatus();
						}}
					/>
					{state.needsInteraction && !state.errorKind && (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/80 text-center">
							<p className="text-4xl">{t("screen.castTapToPlay")}</p>
							<button
								type="button"
								onClick={() => {
									castVideoRef.current
										?.play()
										.then(() => {
											setState((prev) =>
												prev.phase === "casting"
													? { ...prev, needsInteraction: false }
													: prev,
											);
										})
										.catch(() => {});
								}}
								className="rounded-xl bg-blue-600 px-10 py-5 text-3xl font-semibold"
							>
								{t("screen.castTapToPlayButton")}
							</button>
						</div>
					)}
					{state.errorKind && (
						<div className="absolute inset-0 flex items-center justify-center bg-black/90">
							<p className="max-w-2xl px-6 text-3xl text-red-400">
								{t("screen.castErrorPrefix", {
									message: t(mediaErrorKey(state.errorKind)),
								})}
							</p>
						</div>
					)}
				</div>
			)}

			{state.phase !== "sharing" && state.phase !== "casting" && (
				<div className="flex flex-col items-center gap-6 text-center">
					{state.phase === "connecting" && (
						<p className="text-4xl">{t("screen.connecting")}</p>
					)}

					{state.phase === "code" && (
						<>
							<p
								data-testid="room-code"
								className="font-mono text-9xl font-bold tracking-widest"
							>
								{state.code}
							</p>
							<QrCode value={senderUrl(state.code)} size={220} />
							<p className="max-w-md text-2xl text-white/70">
								{t("screen.waitingHint")}
							</p>
							<p className="text-lg text-white/40">
								{t("screen.expiresIn", {
									minutes: Math.round(state.expiresInMs / 60_000),
								})}
							</p>
						</>
					)}

					{state.phase === "peer-connecting" && (
						<p className="text-4xl">{t("screen.peerConnecting")}</p>
					)}

					{state.phase === "stalled" && (
						<p className="text-4xl text-yellow-400">{t("screen.stalled")}</p>
					)}

					{state.phase === "error" && (
						<p className="text-3xl text-red-400">
							{t("screen.errorPrefix", { message: state.message })}
						</p>
					)}
				</div>
			)}

			{(state.phase === "sharing" || state.phase === "casting") && (
				<button
					type="button"
					onClick={handleFullscreenClick}
					aria-label={t("screen.fullscreen")}
					title={t("screen.fullscreen")}
					className="absolute top-4 right-4 rounded-full bg-black/40 p-3 text-white/70 hover:bg-black/60 hover:text-white"
				>
					<Maximize size={28} />
				</button>
			)}

			{DEBUG && Object.keys(debugInfo).length > 0 && (
				<DebugOverlay title="screen" rows={debugInfo} />
			)}
		</div>
	);
}
