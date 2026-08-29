import {
	ALLOWED_CAST_EXTENSIONS,
	type AspectMode,
	CAST_ALLOWED_EXTENSIONS_DISPLAY,
	CAST_FILE_ACCEPT,
	CastUrlSchema,
	type ServerMessage,
	extensionFromFilename,
} from "@kagami/shared";
import { Mic, MicOff, MonitorUp, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSignaling } from "../../hooks/useSignaling.js";
import { type I18nKey, useI18n } from "../../i18n/i18n.js";
import {
	ASPECT_MODES,
	loadAspectMode,
	saveAspectMode,
} from "../../lib/aspect.js";
import {
	AUDIO_MAX_BITRATE_BPS,
	applyAudioBitrate,
	withStereoOpus,
} from "../../lib/audioQuality.js";
import {
	type AudioSource,
	captureMedia,
	deriveAudioDeviceSelection,
	listAudioInputDevices,
	loadAudioDeviceId,
	loadAudioSource,
	requestMicrophoneAccess,
	saveAudioDeviceId,
	saveAudioSource,
	supportsSystemAudioCapture,
} from "../../lib/audioSource.js";
import { isBrave, isChrome, isSafari } from "../../lib/browserDetect.js";
import { canMirror } from "../../lib/capabilities.js";
import {
	type CodecPreference,
	UnsupportedCodecError,
	applyCodecPreferences,
	loadCodecPreference,
	saveCodecPreference,
} from "../../lib/codec.js";
import {
	VIDEO_PAGE_SITE_NAMES,
	detectVideoPageSite,
} from "../../lib/pageUrl.js";
import {
	QUALITY_PRESETS,
	type QualityPreset,
	applyQualityToSender,
	capMaxBitrate,
	loadQualityPreset,
	saveQualityPreset,
} from "../../lib/quality.js";
import {
	DEFAULT_RESOLUTION,
	RESOLUTION_PRESETS,
	type ResolutionPreset,
	computeScaleResolutionDownBy,
	loadResolutionPreset,
	saveResolutionPreset,
} from "../../lib/resolution.js";
import {
	type PeerSession,
	RTC_CONFIG,
	createPeerSession,
	iceCandidateToMessage,
} from "../../lib/webrtc.js";
import {
	getAvailableOutgoingBitrate,
	getNegotiatedVideoCodec,
	getOutboundAudioStats,
	getOutboundVideoStats,
} from "../../lib/webrtcStats.js";

type SenderState =
	| { phase: "joining" }
	| { phase: "ready"; error?: string }
	| { phase: "sharing"; label: string; hasAudio: boolean }
	| { phase: "session-ended"; reason: "screen-ended" | "self-stopped" }
	| { phase: "error"; message: string };

type SenderMode = "mirror" | "cast";

interface CastPlaybackState {
	url: string | null;
	currentTimeSec: number;
	durationSec: number | null;
	paused: boolean;
	ended: boolean;
	volume: number;
	// Solo para cast de fichero: el atomo moov estaba al final y no se
	// pudo remuxear (ffmpeg no disponible, o el remux fallo) — se sirve
	// el fichero tal cual, pero el salto puede no funcionar de verdad.
	seekMayNotWork: boolean;
	errorMessage: string | null;
}

const EMPTY_CAST_STATE: CastPlaybackState = {
	url: null,
	currentTimeSec: 0,
	durationSec: null,
	paused: true,
	ended: false,
	volume: 1,
	seekMayNotWork: false,
	errorMessage: null,
};

type FileUploadState =
	| { phase: "idle" }
	| { phase: "uploading"; percent: number }
	| { phase: "processing"; percent: number | null }
	| { phase: "error"; message: string };

const IDLE_UPLOAD: FileUploadState = { phase: "idle" };

function formatTime(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds)) return "--:--";
	const total = Math.max(0, Math.round(seconds));
	const mins = Math.floor(total / 60);
	const secs = total % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface LiveStats {
	codec: string | null;
	resolution: string | null;
	fps: number | null;
	sourceFps: number | null;
	kbps: number | null;
	audioKbps: number | null;
	availableKbps: number | null;
	avgQp: number | null;
	limitationReason: string | null;
	avgPacketDelayMs: number | null;
}

const EMPTY_STATS: LiveStats = {
	codec: null,
	resolution: null,
	fps: null,
	sourceFps: null,
	kbps: null,
	audioKbps: null,
	availableKbps: null,
	avgQp: null,
	limitationReason: null,
	avgPacketDelayMs: null,
};

function joinErrorKey(code: string): I18nKey {
	const key = `sender.joinError.${code}` as I18nKey;
	return key;
}

// Cada modo cuesta algo distinto (bandas, recorte o deformacion) y hay
// que decirlo sin eufemismos, no dejar que se descubra mirando la tele.
function aspectHintKey(mode: AspectMode): I18nKey {
	const key = `sender.aspectHint.${mode}` as I18nKey;
	return key;
}

interface Props {
	initialCode: string;
	onExit: () => void;
}

// Vista del emisor: HTTPS en produccion, getDisplayMedia exige contexto
// seguro (SPECS.md §4.4).
export function SenderView({ initialCode, onExit }: Props) {
	const { status, send, subscribe } = useSignaling();
	const { t } = useI18n();
	const [state, setState] = useState<SenderState>({ phase: "joining" });
	const [quality, setQuality] = useState<QualityPreset>(loadQualityPreset);
	const [resolutionPreset, setResolutionPreset] =
		useState<ResolutionPreset>(loadResolutionPreset);
	const [codecPref, setCodecPref] =
		useState<CodecPreference>(loadCodecPreference);
	const [contentHint, setContentHint] = useState<"detail" | "motion">("detail");
	const [audioSource, setAudioSource] = useState<AudioSource>(loadAudioSource);
	const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
	const [audioDeviceId, setAudioDeviceId] = useState<string | null>(
		loadAudioDeviceId,
	);
	// "idle" cubre tambien el caso de recargar la pagina con "input-device"
	// ya guardado en localStorage: a proposito NO se pide permiso solo, hay
	// que esperar al clic en "Allow microphone access" (Safari exige que
	// getUserMedia nazca de una interaccion real, no de un efecto).
	const [audioDeviceStatus, setAudioDeviceStatus] = useState<
		"idle" | "requesting" | "ready" | "denied" | "not-found" | "error"
	>("idle");
	const [aspectMode, setAspectMode] = useState<AspectMode>(loadAspectMode);
	const [braveDetected, setBraveDetected] = useState(false);
	const [stats, setStats] = useState<LiveStats>(EMPTY_STATS);
	// canMirror() es fijo por navegador (no cambia en caliente): en iOS
	// arranca directo en "cast", en el resto en "mirror" — el desktop
	// sigue viendo el flujo de espejo tal cual estaba.
	const [senderMode, setSenderMode] = useState<SenderMode>(() =>
		canMirror() ? "mirror" : "cast",
	);
	const [castUrlInput, setCastUrlInput] = useState("");
	const [castUrlError, setCastUrlError] = useState<string | null>(null);
	const [castStatus, setCastStatus] =
		useState<CastPlaybackState>(EMPTY_CAST_STATE);
	const [fileUpload, setFileUpload] = useState<FileUploadState>(IDLE_UPLOAD);
	const sessionRef = useRef<PeerSession | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const joinedRef = useRef(false);

	useEffect(() => {
		if (status === "open" && !joinedRef.current) {
			joinedRef.current = true;
			send({ type: "join-room", code: initialCode });
		}
	}, [status, send, initialCode]);

	useEffect(() => {
		isBrave().then(setBraveDetected);
	}, []);

	// Repuebla la lista sola cuando aparece/desaparece un dispositivo (p.
	// ej. activar BlackHole) sin que haga falta recargar la pagina.
	useEffect(() => {
		if (audioSource !== "input-device") return;
		const onDeviceChange = () => {
			listAudioInputDevices()
				.then((raw) => {
					const { devices, selectedId } = deriveAudioDeviceSelection(
						raw,
						audioDeviceId,
					);
					setAudioDevices(devices);
					if (devices.length > 0) {
						setAudioDeviceStatus("ready");
						if (selectedId && selectedId !== audioDeviceId) {
							setAudioDeviceId(selectedId);
							saveAudioDeviceId(selectedId);
						}
					} else {
						setAudioDeviceStatus((prev) =>
							prev === "ready" ? "not-found" : prev,
						);
					}
				})
				.catch(() => setAudioDeviceStatus("error"));
		};
		navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
		return () =>
			navigator.mediaDevices.removeEventListener(
				"devicechange",
				onDeviceChange,
			);
	}, [audioSource, audioDeviceId]);

	// Reenumera (sin volver a pedir permiso) al volver a "input-device"
	// tras haber pasado por otro modo en esta misma sesion: una vez que
	// getUserMedia resolvio una vez en este documento, enumerateDevices ya
	// da labels sin exigir un nuevo gesto.
	useEffect(() => {
		if (audioSource !== "input-device" || audioDeviceStatus === "idle") return;
		listAudioInputDevices()
			.then((raw) => {
				const { devices, selectedId } = deriveAudioDeviceSelection(
					raw,
					audioDeviceId,
				);
				setAudioDevices(devices);
				setAudioDeviceStatus(devices.length > 0 ? "ready" : "not-found");
				if (selectedId && selectedId !== audioDeviceId) {
					setAudioDeviceId(selectedId);
					saveAudioDeviceId(selectedId);
				}
			})
			.catch(() => {});
	}, [audioSource, audioDeviceStatus, audioDeviceId]);

	// Se llama SIEMPRE desde el manejador de clic de un boton, nunca desde
	// un efecto: Safari solo revela deviceId/label tras un getUserMedia
	// resuelto que nazca de una interaccion real del usuario.
	const requestAudioDevices = useCallback(async () => {
		setAudioDeviceStatus("requesting");
		const permissionError = await requestMicrophoneAccess();
		if (permissionError === "denied") {
			setAudioDeviceStatus("denied");
			return;
		}
		if (permissionError === "not-found") {
			setAudioDeviceStatus("not-found");
			return;
		}
		if (permissionError === "other") {
			setAudioDeviceStatus("error");
			return;
		}
		try {
			const raw = await listAudioInputDevices();
			const { devices, selectedId } = deriveAudioDeviceSelection(
				raw,
				audioDeviceId,
			);
			if (devices.length === 0) {
				setAudioDevices([]);
				setAudioDeviceStatus("not-found");
				return;
			}
			setAudioDevices(devices);
			setAudioDeviceStatus("ready");
			if (selectedId && selectedId !== audioDeviceId) {
				setAudioDeviceId(selectedId);
				saveAudioDeviceId(selectedId);
			}
		} catch {
			setAudioDeviceStatus("error");
		}
	}, [audioDeviceId]);

	// Validacion estricta de esquema en el propio cliente (SPECS.md §2): el
	// servidor tambien valida con el mismo CastUrlSchema al relayar el
	// mensaje (ver apps/server/src/ws/signaling.ts) — "los dos lados", no
	// solo confiar en que el formulario ya filtro bien.
	const submitCastUrl = useCallback(() => {
		const parsed = CastUrlSchema.safeParse(castUrlInput.trim());
		if (!parsed.success) {
			setCastUrlError(t("sender.castUrlInvalid"));
			return;
		}
		// Un enlace de YouTube/Vimeo/Twitch pasa esta validacion (es un
		// http/https valido) pero sirve una pagina, no un fichero de video —
		// sin esto, el fallo llega luego en la tele como "formato no
		// soportado", tecnicamente cierto pero incomprensible para quien lo
		// pego (encargo M1, parte F).
		const pageSite = detectVideoPageSite(parsed.data);
		if (pageSite) {
			setCastUrlError(
				pageSite === "youtube"
					? t("sender.castUrlIsPageYoutube")
					: t("sender.castUrlIsPage", {
							site: VIDEO_PAGE_SITE_NAMES[pageSite],
						}),
			);
			return;
		}
		setCastUrlError(null);
		send({ type: "cast-url", url: parsed.data });
		setCastStatus({ ...EMPTY_CAST_STATE, url: parsed.data });
	}, [castUrlInput, send, t]);

	const castNewUrl = useCallback(() => {
		setCastStatus(EMPTY_CAST_STATE);
		setCastUrlInput("");
		setCastUrlError(null);
		setFileUpload(IDLE_UPLOAD);
	}, []);

	// XHR, no fetch: es la unica API con progreso de subida real y de
	// verdad funciona en Safari (necesario para el flujo del iPhone). El
	// cuerpo es el fichero tal cual — el nombre viaja en la query, no en
	// un FormData, porque el server necesita el stream crudo sin
	// desempaquetar multipart para poder escribirlo a disco en streaming.
	const uploadCastFile = useCallback(
		(file: File) => {
			setFileUpload({ phase: "uploading", percent: 0 });
			const xhr = new XMLHttpRequest();
			xhr.upload.addEventListener("progress", (ev) => {
				if (ev.lengthComputable) {
					setFileUpload({
						phase: "uploading",
						percent: Math.round((ev.loaded / ev.total) * 100),
					});
				}
			});
			xhr.addEventListener("load", () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					// La confirmacion real de que ya se puede reproducir llega
					// por WS ("cast-file-processing"/"cast-file-ready"), no aqui
					// — esta respuesta solo dice que la subida en si termino.
					setFileUpload({ phase: "processing", percent: null });
					return;
				}
				let message = t("sender.castUploadFailed");
				try {
					const body = JSON.parse(xhr.responseText) as { error?: string };
					if (body.error) message = body.error;
				} catch {
					// respuesta no-JSON inesperada: se queda el mensaje generico
				}
				setFileUpload({ phase: "error", message });
			});
			xhr.addEventListener("error", () => {
				setFileUpload({
					phase: "error",
					message: t("sender.castUploadFailed"),
				});
			});
			xhr.open(
				"POST",
				`/cast/upload/${initialCode}?filename=${encodeURIComponent(file.name)}`,
			);
			xhr.send(file);
		},
		[initialCode, t],
	);

	// startPeerConnection NO vuelve a pedir getDisplayMedia: reutiliza el
	// stream ya capturado, tanto al empezar como en un restart-ice. Puede
	// lanzar UnsupportedCodecError si el navegador no ofrece H.264 ni VP8.
	const startPeerConnection = useCallback(
		async (stream: MediaStream) => {
			const pc = new RTCPeerConnection(RTC_CONFIG);
			const session = createPeerSession(pc);
			sessionRef.current = session;

			pc.onicecandidate = (ev) => {
				if (ev.candidate)
					send({ type: "ice", candidate: iceCandidateToMessage(ev.candidate) });
			};

			for (const track of stream.getTracks()) {
				if (track.kind === "video") {
					const transceiver = pc.addTransceiver(track, {
						direction: "sendonly",
						streams: [stream],
					});
					applyCodecPreferences(transceiver, codecPref);
					// scaleResolutionDownBy se calcula a partir de la resolucion
					// REAL capturada, no un valor fijo (sprint de calidad): un Mac
					// con Retina y uno sin Retina necesitan factores distintos
					// para llegar al mismo 1080p. Se fija aqui y no vuelve a
					// tocarse en mitad de stream.
					const capturedWidth = track.getSettings().width ?? 1920;
					const scaleDownBy = computeScaleResolutionDownBy(
						resolutionPreset,
						capturedWidth,
					);
					await applyQualityToSender(
						transceiver.sender,
						quality,
						scaleDownBy,
					).catch((err) => console.warn("setParameters failed", err));
				} else {
					const audioSender = pc.addTrack(track, stream);
					// 128 kbps estereo, no los ~32 kbps mono de una videollamada:
					// es audio de sistema (musica, peliculas), no una voz (docs/
					// webrtc-quality.md). El estereo en si se pide en el SDP, ver
					// mas abajo — esto solo levanta el techo de bitrate.
					await applyAudioBitrate(audioSender, AUDIO_MAX_BITRATE_BPS).catch(
						(err) => console.warn("setParameters (audio) failed", err),
					);
				}
			}

			const offer = await pc.createOffer();
			// Chrome/Safari negocian Opus mono por defecto para cualquier
			// pista de audio, sin distinguir "voz" de "audio de sistema" — el
			// SDP hay que tocarlo a mano, en una unica funcion documentada
			// (lib/audioQuality.ts), nunca con reemplazos de texto dispersos.
			const stereoSdp = withStereoOpus(offer.sdp ?? "");
			await pc.setLocalDescription({ type: offer.type, sdp: stereoSdp });
			send({
				type: "offer",
				sdp: { type: "offer", sdp: stereoSdp },
			});
		},
		[send, quality, codecPref, resolutionPreset],
	);

	useEffect(
		() =>
			subscribe((msg: ServerMessage) => {
				switch (msg.type) {
					case "room-joined":
						setState({ phase: "ready" });
						break;
					case "cast-status":
						setCastStatus((prev) => ({
							...prev,
							currentTimeSec: msg.currentTimeSec,
							durationSec: msg.durationSec,
							paused: msg.paused,
							ended: msg.ended,
							volume: msg.volume,
							errorMessage: msg.errorMessage,
						}));
						break;
					case "cast-resumed":
						// Reconexion tras bloquear el telefono durante un cast
						// (SPECS.md §6): la sala sobrevivio en el server con la
						// pantalla sola ("room-joined", justo antes de este mensaje,
						// ya puso la fase en "ready"). El "cast-status" con los datos
						// reales (nunca inventados) llega justo despues de este. Forzar
						// el modo "cast" tambien: un Mac reconectando por defecto
						// arrancaria en "mirror" y no veria los controles.
						setSenderMode("cast");
						setCastStatus({ ...EMPTY_CAST_STATE, url: msg.label });
						break;
					case "cast-file-processing":
						// Remux a faststart en marcha en el server (moov al final,
						// ver docs/spike-range.md) — puede tardar en ficheros
						// grandes, se informa del progreso real, no una barra falsa.
						setFileUpload({ phase: "processing", percent: msg.percent });
						break;
					case "cast-file-ready":
						setFileUpload(IDLE_UPLOAD);
						setCastStatus({
							...EMPTY_CAST_STATE,
							url: msg.filename,
							seekMayNotWork: msg.seekMayNotWork,
						});
						break;
					case "cast-file-error":
						setFileUpload({ phase: "error", message: msg.message });
						break;
					case "answer":
						sessionRef.current?.setRemoteDescription(msg.sdp);
						break;
					case "ice":
						sessionRef.current?.addRemoteIce(msg.candidate);
						break;
					case "restart-ice": {
						const stream = streamRef.current;
						if (!stream) break; // no compartiendo, nada que reiniciar
						sessionRef.current?.pc.close();
						sessionRef.current = null;
						setStats(EMPTY_STATS);
						startPeerConnection(stream).catch((err) =>
							console.warn("renegotiate failed", err),
						);
						break;
					}
					case "peer-left":
						// La sala ha muerto de verdad en el server (RoomService.leave
						// la borra siempre, la inicie quien la inicie) — un codigo
						// usado no vuelve (SPECS.md §6). Nada de "ready", nada que
						// sugiera que se puede seguir compartiendo aqui mismo.
						for (const track of streamRef.current?.getTracks() ?? [])
							track.stop();
						streamRef.current = null;
						sessionRef.current?.pc.close();
						sessionRef.current = null;
						setStats(EMPTY_STATS);
						setState({ phase: "session-ended", reason: "screen-ended" });
						break;
					case "error":
						setState({ phase: "error", message: t(joinErrorKey(msg.code)) });
						break;
				}
			}),
		[subscribe, t, startPeerConnection],
	);

	// Diagnostico SIEMPRE visible mientras comparte (no solo con
	// ?debug=1): codec, resolucion, fps de origen vs enviados, bitrate
	// real, techo disponible, QP medio, motivo de limitacion y retraso de
	// codificacion+envio. Son justo los campos que diagnosticaron los dos
	// hallazgos reales: Chrome/Brave negociando VP9 en negro
	// (docs/webrtc-codec.md) y que el coste es de RESOLUCION, no de
	// bitrate (docs/webrtc-quality.md) — no queremos volver a depurar
	// ninguno de los dos a ciegas.
	//
	// Este mismo intervalo hace el ajuste adaptativo del requisito 2: el
	// bitrate nunca debe superar availableOutgoingBitrate. Los presets de
	// calidad son un TECHO deseado, no un valor fijo.
	useEffect(() => {
		if (state.phase !== "sharing") return;
		let lastBytes = 0;
		let lastAudioBytes = 0;
		let lastQpSum = 0;
		let lastFramesEncoded = 0;
		let lastDelay = 0;
		let lastPacketsSent = 0;
		let lastTime = performance.now();

		const interval = setInterval(async () => {
			const pc = sessionRef.current?.pc;
			if (!pc) return;
			const [codec, outbound, outboundAudio, availableBps] = await Promise.all([
				getNegotiatedVideoCodec(pc, "outbound-rtp"),
				getOutboundVideoStats(pc),
				getOutboundAudioStats(pc),
				getAvailableOutgoingBitrate(pc),
			]);
			if (!outbound) return;

			const now = performance.now();
			const elapsedS = (now - lastTime) / 1000;
			const kbps =
				elapsedS > 0
					? Math.round(((outbound.bytesSent - lastBytes) * 8) / elapsedS / 1000)
					: null;
			const audioKbps =
				outboundAudio && elapsedS > 0
					? Math.round(
							((outboundAudio.bytesSent - lastAudioBytes) * 8) /
								elapsedS /
								1000,
						)
					: null;
			if (outboundAudio) lastAudioBytes = outboundAudio.bytesSent;

			let avgQp: number | null = null;
			if (
				outbound.qpSum !== undefined &&
				outbound.framesEncoded !== undefined
			) {
				const deltaQp = outbound.qpSum - lastQpSum;
				const deltaFrames = outbound.framesEncoded - lastFramesEncoded;
				if (deltaFrames > 0)
					avgQp = Math.round((deltaQp / deltaFrames) * 10) / 10;
				lastQpSum = outbound.qpSum;
				lastFramesEncoded = outbound.framesEncoded;
			}

			let avgPacketDelayMs: number | null = null;
			if (
				outbound.totalPacketSendDelay !== undefined &&
				outbound.packetsSent !== undefined
			) {
				const deltaDelay = outbound.totalPacketSendDelay - lastDelay;
				const deltaPackets = outbound.packetsSent - lastPacketsSent;
				if (deltaPackets > 0)
					avgPacketDelayMs =
						Math.round(((deltaDelay / deltaPackets) * 1000 * 10) / 1) / 10;
				lastDelay = outbound.totalPacketSendDelay;
				lastPacketsSent = outbound.packetsSent;
			}

			lastBytes = outbound.bytesSent;
			lastTime = now;

			const videoSender = pc
				.getSenders()
				.find((s) => s.track?.kind === "video");
			if (videoSender && availableBps !== null) {
				const cap = Math.min(
					quality.maxBitrate,
					Math.round(availableBps * 0.85),
				);
				capMaxBitrate(videoSender, cap).catch((err) =>
					console.warn("capMaxBitrate failed", err),
				);
			}

			setStats((prev) => ({
				codec: codec ?? prev.codec,
				resolution:
					outbound.frameWidth && outbound.frameHeight
						? `${outbound.frameWidth}x${outbound.frameHeight}`
						: prev.resolution,
				fps: outbound.framesPerSecond ?? prev.fps,
				sourceFps: prev.sourceFps,
				kbps: kbps ?? prev.kbps,
				audioKbps: audioKbps ?? prev.audioKbps,
				availableKbps:
					availableBps !== null
						? Math.round(availableBps / 1000)
						: prev.availableKbps,
				avgQp: avgQp ?? prev.avgQp,
				limitationReason:
					outbound.qualityLimitationReason ?? prev.limitationReason,
				avgPacketDelayMs: avgPacketDelayMs ?? prev.avgPacketDelayMs,
			}));
		}, 1000);
		return () => clearInterval(interval);
	}, [state.phase, quality]);

	async function shareScreen() {
		try {
			const videoConstraints: MediaTrackConstraints = { frameRate: 30 };
			if (isSafari()) {
				// Intento best-effort de pedir resolucion nativa Retina: Safari
				// captura la pantalla a puntos logicos por defecto (mitad de
				// resolucion en una pantalla Retina), sin garantia de que honre
				// esto. Ver docs/webrtc-quality.md.
				videoConstraints.width = {
					ideal: window.screen.width * window.devicePixelRatio,
				};
				videoConstraints.height = {
					ideal: window.screen.height * window.devicePixelRatio,
				};
			}

			const { stream, hasAudio } = await captureMedia(
				videoConstraints,
				audioSource,
				audioDeviceId,
			);
			streamRef.current = stream;

			const videoTrack = stream.getVideoTracks()[0];
			if (!videoTrack) throw new Error("no video track in captured stream");
			videoTrack.contentHint = contentHint;
			videoTrack.onended = () => stopSharing();

			const sourceFrameRate = videoTrack.getSettings().frameRate;
			setStats({
				...EMPTY_STATS,
				sourceFps: sourceFrameRate ? Math.round(sourceFrameRate) : null,
			});

			await startPeerConnection(stream);
			// La pantalla no tiene forma de saber el modo de aspecto elegido
			// si no se lo decimos en cuanto arranca.
			send({ type: "set-aspect-mode", mode: aspectMode });

			setState({
				phase: "sharing",
				label: videoTrack.label || "screen",
				hasAudio,
			});
		} catch (err) {
			for (const track of streamRef.current?.getTracks() ?? []) track.stop();
			streamRef.current = null;

			if (err instanceof UnsupportedCodecError) {
				setState({ phase: "ready", error: t("sender.codecUnsupported") });
				return;
			}
			const overconstrained =
				err instanceof DOMException && err.name === "OverconstrainedError";
			setState({
				phase: "ready",
				error: t(
					overconstrained ? "sender.qualityUnsupported" : "sender.shareFailed",
				),
			});
		}
	}

	function stopSharing() {
		// Enviar "leave" borra la sala en el server para siempre (un codigo
		// usado no vuelve, SPECS.md §6) — volver a "ready" aqui era el bug:
		// dejaba los selectores y el boton "Share screen" como si la sala
		// siguiera viva, y pulsarlo no hacia nada porque el server ya habia
		// olvidado el rol/codigo de esta conexion.
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sessionRef.current?.pc.close();
		sessionRef.current = null;
		setStats(EMPTY_STATS);
		send({ type: "leave" });
		setState({ phase: "session-ended", reason: "self-stopped" });
	}

	function changeAspectMode(mode: AspectMode) {
		setAspectMode(mode);
		saveAspectMode(mode);
		send({ type: "set-aspect-mode", mode });
	}

	const chromeH264Warning =
		state.phase !== "joining" &&
		codecPref === "h264" &&
		isChrome() &&
		!braveDetected;
	const bitrateExceedsAvailable =
		stats.kbps !== null &&
		stats.availableKbps !== null &&
		stats.kbps > stats.availableKbps;
	const highPacketDelay =
		stats.avgPacketDelayMs !== null && stats.avgPacketDelayMs > 20;
	// Medido en una LG OLED (docs/webrtc-codec.md): H.264 se decodifica por
	// hardware y se pinta en un plano de video superpuesto que el escalador
	// de la propia tele controla — el CSS de la pagina (containerStyleForAspect
	// / object-fit) no llega a ese plano. Solo "expanded" coincide con lo que
	// el overlay hace por su cuenta; los otros cuatro modos no tienen efecto
	// visible. VP8 se decodifica en el plano normal y si respeta el CSS.
	const negotiatedH264 = stats.codec !== null && /h264/i.test(stats.codec);

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 px-6 text-center text-white">
			{state.phase === "joining" && (
				<p className="text-2xl">{t("sender.joining")}</p>
			)}

			{state.phase === "ready" && (
				<>
					{!canMirror() && (
						<div className="max-w-md space-y-2">
							<h2 className="text-xl font-bold">{t("sender.iosTitle")}</h2>
							<p className="text-sm text-white/70">{t("sender.iosBody")}</p>
						</div>
					)}

					{canMirror() && (
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setSenderMode("mirror")}
								className={
									senderMode === "mirror"
										? "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold"
										: "rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white/70"
								}
							>
								{t("sender.modeMirror")}
							</button>
							<button
								type="button"
								onClick={() => setSenderMode("cast")}
								className={
									senderMode === "cast"
										? "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold"
										: "rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white/70"
								}
							>
								{t("sender.modeCast")}
							</button>
						</div>
					)}

					{senderMode === "cast" && (
						<div className="flex w-full max-w-md flex-col items-center gap-4">
							{castStatus.url === null ? (
								fileUpload.phase === "idle" ? (
									<>
										<input
											type="url"
											inputMode="url"
											data-testid="cast-url-input"
											value={castUrlInput}
											onChange={(e) => setCastUrlInput(e.target.value)}
											placeholder={t("sender.castUrlPlaceholder")}
											className="w-full rounded-lg bg-neutral-800 px-4 py-3 text-sm text-white placeholder:text-white/30"
										/>
										{castUrlError && (
											<p className="text-sm text-red-400">{castUrlError}</p>
										)}
										<button
											type="button"
											data-testid="cast-url-submit"
											onClick={submitCastUrl}
											disabled={castUrlInput.trim().length === 0}
											className="flex items-center gap-3 rounded-xl bg-blue-600 px-8 py-4 text-xl font-semibold hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-white/40"
										>
											{t("sender.castUrlSubmit")}
										</button>

										<div className="flex w-full items-center gap-2 text-xs text-white/40">
											<span className="h-px flex-1 bg-white/10" />
											{t("sender.castOr")}
											<span className="h-px flex-1 bg-white/10" />
										</div>

										{/* accept incluye video E imagen a proposito (SPECS.md
										§4.3): en iOS, Safari ofrece "Photo Library" como origen
										en cuanto el accept cubre video/imagen — no hace falta
										(ni conviene) el atributo "capture", que forzaria la
										camara y quitaria esa opcion. El accept es solo comodidad
										para que el selector del sistema ya filtre — no todos los
										navegadores lo hacen cumplir (el usuario puede elegir "todos
										los ficheros"), asi que el rechazo real va en onChange, antes
										de subir un solo byte (encargo de cierre, parte 1).*/}
										<label className="w-full cursor-pointer rounded-lg bg-neutral-800 px-4 py-3 text-center text-sm text-white/70 hover:bg-neutral-700">
											{t("sender.castFilePick")}
											<input
												type="file"
												data-testid="cast-file-input"
												accept={CAST_FILE_ACCEPT}
												className="hidden"
												onChange={(e) => {
													const file = e.target.files?.[0];
													e.target.value = "";
													if (!file) return;
													const ext = extensionFromFilename(file.name);
													if (!ALLOWED_CAST_EXTENSIONS.has(ext)) {
														setFileUpload({
															phase: "error",
															message: t("sender.castUnsupportedContainer", {
																ext: ext || "?",
																formats: CAST_ALLOWED_EXTENSIONS_DISPLAY,
															}),
														});
														return;
													}
													uploadCastFile(file);
												}}
											/>
										</label>
									</>
								) : (
									<>
										{fileUpload.phase === "uploading" && (
											<p
												data-testid="cast-upload-status"
												className="text-sm text-white/60"
											>
												{t("sender.castUploading", {
													percent: fileUpload.percent,
												})}
											</p>
										)}
										{fileUpload.phase === "processing" && (
											<p
												data-testid="cast-upload-status"
												className="text-sm text-white/60"
											>
												{fileUpload.percent !== null
													? t("sender.castProcessingPercent", {
															percent: fileUpload.percent,
														})
													: t("sender.castProcessing")}
											</p>
										)}
										{fileUpload.phase === "error" && (
											<>
												<p className="text-sm text-red-400">
													{fileUpload.message}
												</p>
												<button
													type="button"
													onClick={() => setFileUpload(IDLE_UPLOAD)}
													className="text-sm text-white/50 underline"
												>
													{t("sender.tryAgain")}
												</button>
											</>
										)}
									</>
								)
							) : (
								<>
									<p className="max-w-md truncate text-sm text-white/60">
										{t("sender.castNowPlaying", { url: castStatus.url })}
									</p>
									{castStatus.seekMayNotWork && (
										<p className="max-w-md text-xs text-yellow-400">
											{t("sender.castSeekMayNotWork")}
										</p>
									)}
									{castStatus.errorMessage ? (
										<p className="text-red-400">
											{t("sender.castErrorPrefix", {
												message: t(
													`mediaError.${castStatus.errorMessage}` as I18nKey,
												),
											})}
										</p>
									) : (
										<>
											<button
												type="button"
												data-testid="cast-play-pause"
												onClick={() =>
													send({
														type: castStatus.paused
															? "cast-play"
															: "cast-pause",
													})
												}
												className="flex items-center gap-3 rounded-xl bg-blue-600 px-8 py-4 text-xl font-semibold hover:bg-blue-500"
											>
												{castStatus.paused ? (
													<Play size={24} />
												) : (
													<Pause size={24} />
												)}
												{castStatus.paused
													? t("sender.castPlay")
													: t("sender.castPause")}
											</button>
											<div className="flex w-full items-center gap-3">
												<span className="w-24 shrink-0 font-mono text-xs text-white/60">
													{t("sender.castPositionLabel", {
														current: formatTime(castStatus.currentTimeSec),
														duration: formatTime(castStatus.durationSec),
													})}
												</span>
												<input
													type="range"
													data-testid="cast-seek"
													min={0}
													max={castStatus.durationSec ?? 0}
													step={0.1}
													value={castStatus.currentTimeSec}
													onChange={(e) =>
														send({
															type: "cast-seek",
															positionSec: Number(e.target.value),
														})
													}
													className="w-full"
												/>
											</div>
											<div className="flex w-full items-center gap-3">
												<span className="w-24 shrink-0 text-xs text-white/60">
													{t("sender.castVolumeLabel")}
												</span>
												<input
													type="range"
													data-testid="cast-volume"
													min={0}
													max={1}
													step={0.01}
													value={castStatus.volume}
													onChange={(e) =>
														send({
															type: "cast-volume",
															volume: Number(e.target.value),
														})
													}
													className="w-full"
												/>
											</div>
										</>
									)}
									<button
										type="button"
										onClick={castNewUrl}
										className="text-sm text-white/50 underline"
									>
										{t("sender.castChangeUrl")}
									</button>
								</>
							)}
						</div>
					)}

					{senderMode === "mirror" && canMirror() && (
						<>
							{braveDetected && (
								<p className="max-w-md text-sm text-yellow-400">
									{t("sender.braveWarning")}
								</p>
							)}
							{isSafari() && (
								<p className="max-w-md text-sm text-white/50">
									{t("sender.safariNote")}
								</p>
							)}

							<div className="flex flex-col items-center gap-2">
								<span className="text-sm text-white/60">
									{t("sender.codecPreference")}
								</span>
								<div className="flex gap-2">
									{(["vp8", "h264", "auto"] as const).map((pref) => (
										<button
											key={pref}
											type="button"
											onClick={() => {
												setCodecPref(pref);
												saveCodecPreference(pref);
											}}
											className={
												pref === codecPref
													? "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold uppercase"
													: "rounded-lg bg-neutral-800 px-4 py-2 text-sm uppercase text-white/70"
											}
										>
											{pref}
										</button>
									))}
								</div>
								{chromeH264Warning && (
									<p className="max-w-md text-sm text-yellow-400">
										{t("sender.chromeH264Warning")}
									</p>
								)}
							</div>

							<div className="flex flex-col items-center gap-2">
								<span className="text-sm text-white/60">
									{t("sender.resolution")}
								</span>
								<div className="flex gap-2">
									{RESOLUTION_PRESETS.map((preset) => (
										<button
											key={preset.id}
											type="button"
											onClick={() => {
												setResolutionPreset(preset);
												saveResolutionPreset(preset);
											}}
											className={
												preset.id === resolutionPreset.id
													? "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold"
													: "rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white/70"
											}
										>
											{preset.label}
										</button>
									))}
								</div>
							</div>

							<div className="flex flex-col items-center gap-2">
								<span className="text-sm text-white/60">
									{t("sender.quality")}
								</span>
								<div className="flex gap-2">
									{QUALITY_PRESETS.map((preset) => (
										<button
											key={preset.id}
											type="button"
											onClick={() => {
												setQuality(preset);
												saveQualityPreset(preset);
											}}
											className={
												preset.id === quality.id
													? "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold"
													: "rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white/70"
											}
										>
											{preset.label}
										</button>
									))}
								</div>
							</div>

							<div className="flex flex-col items-center gap-2">
								<span className="text-sm text-white/60">
									{t("sender.contentHint")}
								</span>
								<div className="flex gap-2">
									{(["detail", "motion"] as const).map((hint) => (
										<button
											key={hint}
											type="button"
											onClick={() => setContentHint(hint)}
											className={
												hint === contentHint
													? "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold uppercase"
													: "rounded-lg bg-neutral-800 px-4 py-2 text-sm uppercase text-white/70"
											}
										>
											{hint}
										</button>
									))}
								</div>
							</div>

							<div className="flex flex-col items-center gap-2">
								<span className="text-sm text-white/60">
									{t("sender.audioSource")}
								</span>
								<div className="flex gap-2">
									{supportsSystemAudioCapture() && (
										<button
											type="button"
											onClick={() => {
												setAudioSource("system");
												saveAudioSource("system");
											}}
											className={
												audioSource === "system"
													? "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold"
													: "rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white/70"
											}
										>
											{t("sender.audioSourceSystem")}
										</button>
									)}
									<button
										type="button"
										onClick={() => {
											setAudioSource("input-device");
											saveAudioSource("input-device");
											if (audioDeviceStatus === "idle") requestAudioDevices();
										}}
										className={
											audioSource === "input-device"
												? "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold"
												: "rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white/70"
										}
									>
										{t("sender.audioSourceDevice")}
									</button>
									<button
										type="button"
										onClick={() => {
											setAudioSource("none");
											saveAudioSource("none");
										}}
										className={
											audioSource === "none"
												? "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold"
												: "rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white/70"
										}
									>
										{t("sender.audioSourceNone")}
									</button>
								</div>
								{!supportsSystemAudioCapture() && (
									<p className="max-w-md text-xs text-white/40">
										{t("sender.audioSourceHint")}
									</p>
								)}
								{audioSource === "input-device" &&
									audioDeviceStatus === "ready" &&
									audioDevices.length > 0 && (
										<select
											value={audioDeviceId ?? ""}
											onChange={(e) => {
												setAudioDeviceId(e.target.value);
												saveAudioDeviceId(e.target.value);
											}}
											className="rounded-lg bg-neutral-800 px-3 py-2 text-sm text-white"
										>
											<option value="" disabled>
												{t("sender.audioDevicePick")}
											</option>
											{audioDevices.map((device) => (
												<option key={device.deviceId} value={device.deviceId}>
													{device.label || device.deviceId.slice(0, 8)}
												</option>
											))}
										</select>
									)}
								{audioSource === "input-device" &&
									audioDeviceStatus !== "ready" && (
										<div className="flex max-w-md flex-col items-center gap-2 text-center">
											<p className="text-xs text-white/60">
												{audioDeviceStatus === "requesting" &&
													t("sender.audioPermissionRequesting")}
												{audioDeviceStatus === "idle" &&
													t("sender.audioPermissionNeeded")}
												{audioDeviceStatus === "denied" &&
													t("sender.audioPermissionDenied")}
												{audioDeviceStatus === "not-found" &&
													t("sender.audioNoDevices")}
												{audioDeviceStatus === "error" &&
													t("sender.audioPermissionError")}
											</p>
											{audioDeviceStatus !== "requesting" && (
												<button
													type="button"
													onClick={requestAudioDevices}
													className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-neutral-700"
												>
													{audioDeviceStatus === "idle"
														? t("sender.audioGrantAccess")
														: t("sender.audioRetry")}
												</button>
											)}
										</div>
									)}
							</div>

							<button
								type="button"
								onClick={shareScreen}
								className="flex items-center gap-3 rounded-xl bg-blue-600 px-8 py-4 text-xl font-semibold hover:bg-blue-500"
							>
								<MonitorUp size={28} />
								{t("sender.shareScreen")}
							</button>
							{/* Aviso preventivo, no una deteccion (encargo de cierre,
							parte 3): no hay forma fiable de saber desde el emisor si la
							pestaña que se va a compartir tiene DRM antes de intentarlo —
							solo se sabe cuando ya sale en negro. Por eso es permanente
							junto al boton, no condicional a nada. */}
							<p className="max-w-md text-center text-xs text-white/40">
								{t("sender.drmNotice")}
							</p>
							{state.error && (
								<p className="max-w-md text-red-400">{state.error}</p>
							)}
						</>
					)}
				</>
			)}

			{state.phase === "sharing" && (
				<>
					<p className="flex items-center gap-2 text-xl">
						{state.hasAudio ? <Mic size={20} /> : <MicOff size={20} />}
						{t("sender.sharingLabel", { label: state.label })} (
						{state.hasAudio ? t("sender.audioYes") : t("sender.audioNo")})
					</p>
					<p className="max-w-md font-mono text-sm text-white/50">
						{stats.codec
							? t("sender.codecLabel", { codec: stats.codec })
							: t("sender.codecPending")}
						{stats.resolution ? ` · ${stats.resolution}` : ""}
						{stats.sourceFps !== null && stats.fps !== null
							? ` · ${stats.sourceFps}→${stats.fps}fps`
							: stats.fps !== null
								? ` · ${stats.fps}fps`
								: ""}
						{stats.kbps !== null
							? ` · ${(stats.kbps / 1000).toFixed(1)}Mbps`
							: ""}
						{stats.availableKbps !== null
							? ` (avail ${(stats.availableKbps / 1000).toFixed(1)})`
							: ""}
						{stats.audioKbps !== null ? ` · audio ${stats.audioKbps}kbps` : ""}
						{stats.avgQp !== null ? ` · QP ${stats.avgQp}` : ""}
						{stats.limitationReason
							? ` · limit: ${stats.limitationReason}`
							: ""}
					</p>
					{stats.avgPacketDelayMs !== null && (
						<p
							className={`text-sm ${highPacketDelay ? "text-red-400" : "text-white/40"}`}
						>
							encode+send delay: {stats.avgPacketDelayMs}ms
							{highPacketDelay ? ` — ${t("sender.highDelayWarning")}` : ""}
						</p>
					)}
					{bitrateExceedsAvailable && (
						<p className="text-sm text-red-400">
							{t("sender.bitrateExceedsWarning")}
						</p>
					)}
					{negotiatedH264 && (
						<p className="max-w-md text-sm text-yellow-400">
							{t("sender.h264AspectWarning")}
						</p>
					)}

					<div className="flex flex-col items-center gap-2">
						<span className="text-sm text-white/60">
							{t("sender.aspectMode")}
						</span>
						<div className="flex flex-wrap justify-center gap-2">
							{ASPECT_MODES.map((mode) => (
								<button
									key={mode}
									type="button"
									onClick={() => changeAspectMode(mode)}
									className={
										mode === aspectMode
											? "rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold"
											: "rounded-lg bg-neutral-800 px-3 py-2 text-sm text-white/70"
									}
								>
									{mode}
								</button>
							))}
						</div>
						<p className="max-w-md text-xs text-white/40">
							{t(aspectHintKey(aspectMode))}
						</p>
					</div>

					<button
						type="button"
						onClick={stopSharing}
						className="rounded-xl bg-red-600 px-6 py-3 font-semibold hover:bg-red-500"
					>
						{t("sender.stop")}
					</button>
				</>
			)}

			{state.phase === "session-ended" && (
				<>
					<p className="text-2xl">
						{state.reason === "screen-ended"
							? t("sender.screenEnded")
							: t("sender.selfStopped")}
					</p>
					<button
						type="button"
						onClick={onExit}
						className="text-blue-400 underline"
					>
						{t("sender.backToStart")}
					</button>
				</>
			)}

			{state.phase === "error" && (
				<>
					<p className="text-2xl text-red-400">{state.message}</p>
					<button
						type="button"
						onClick={onExit}
						className="text-blue-400 underline"
					>
						{t("sender.tryAgain")}
					</button>
				</>
			)}
		</div>
	);
}
