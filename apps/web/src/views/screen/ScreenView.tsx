import { useCallback, useEffect, useRef, useState } from "react";
import { DebugOverlay } from "../../components/DebugOverlay.js";
import { QrCode } from "../../components/QrCode.js";
import { useSignaling } from "../../hooks/useSignaling.js";
import { useI18n } from "../../i18n/i18n.js";
import {
	type PeerSession,
	RTC_CONFIG,
	createPeerSession,
	iceCandidateToMessage,
} from "../../lib/webrtc.js";
import { getInboundVideoStats } from "../../lib/webrtcStats.js";

const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

// La tele real se congelo justo al pasar de resolucion baja a alta a
// mitad de stream (ver docs/webrtc-quality.md): estos umbrales son la
// red de seguridad para cuando vuelva a pasar, no una prueba de que no
// volvera a pasar. "Vivo" = connectionState connected pero framesDecoded
// dejo de avanzar — eso es un decodificador atascado, no una red caida.
const STALL_RESTART_MS = 5_000;
const STALL_GIVEUP_MS = 15_000;

type ScreenState =
	| { phase: "connecting" }
	| { phase: "code"; code: string; expiresInMs: number }
	| { phase: "peer-connecting" }
	| { phase: "sharing" }
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
	const videoRef = useRef<HTMLVideoElement>(null);
	const sessionRef = useRef<PeerSession | null>(null);
	const statsIntervalRef = useRef<number | null>(null);

	useEffect(() => {
		if (status === "open") send({ type: "create-room" });
	}, [status, send]);

	const stopStatsWatcher = useCallback(() => {
		if (statsIntervalRef.current !== null) {
			clearInterval(statsIntervalRef.current);
			statsIntervalRef.current = null;
		}
	}, []);

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
						setState({ phase: "peer-connecting" });
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

					case "peer-left":
						stopStatsWatcher();
						sessionRef.current?.pc.close();
						sessionRef.current = null;
						if (videoRef.current) videoRef.current.srcObject = null;
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
		<div className="flex min-h-screen items-center justify-center bg-black text-white">
			{/* biome-ignore lint/a11y/useMediaCaption: espejo en vivo, no hay pista de subtitulos que adjuntar */}
			<video
				ref={videoRef}
				autoPlay
				playsInline
				className={
					state.phase === "sharing"
						? "h-screen w-screen object-contain"
						: "hidden"
				}
			/>

			{state.phase !== "sharing" && (
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

			{DEBUG && Object.keys(debugInfo).length > 0 && (
				<DebugOverlay title="screen" rows={debugInfo} />
			)}
		</div>
	);
}
