import {
	ALLOWED_CAST_EXTENSIONS,
	type AspectMode,
	CAST_ALLOWED_EXTENSIONS_DISPLAY,
	CAST_FILE_ACCEPT,
	CastUrlSchema,
	type ServerMessage,
	extensionFromFilename,
} from "@kagami/shared";
import { Mic, MicOff, MonitorUp, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "../../components/Alert.js";
import { Button } from "../../components/Button.js";
import { Disclosure } from "../../components/Disclosure.js";
import { Lockup } from "../../components/Lockup.js";
import { PlaybackControls } from "../../components/PlaybackControls.js";
import { Segmented } from "../../components/Segmented.js";
import { StatusPill } from "../../components/StatusPill.js";
import { UploadProgress } from "../../components/UploadProgress.js";
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
import { classifyCaptureLabel } from "../../lib/captureLabel.js";
import {
	type CodecPreference,
	UnsupportedCodecError,
	applyCodecPreferences,
	loadCodecPreference,
	saveCodecPreference,
} from "../../lib/codec.js";
import { formatTime } from "../../lib/format.js";
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
	| {
			phase: "uploading";
			percent: number;
			filename: string;
			sizeBytes: number;
			bytesPerSec: number | null;
	  }
	| { phase: "processing"; percent: number | null }
	| { phase: "error"; message: string };

const IDLE_UPLOAD: FileUploadState = { phase: "idle" };
const SKIP_SECONDS = 10;

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
	const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

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
			const startedAt = performance.now();
			setFileUpload({
				phase: "uploading",
				percent: 0,
				filename: file.name,
				sizeBytes: file.size,
				bytesPerSec: null,
			});
			const xhr = new XMLHttpRequest();
			uploadXhrRef.current = xhr;
			xhr.upload.addEventListener("progress", (ev) => {
				if (!ev.lengthComputable) return;
				const elapsedSec = (performance.now() - startedAt) / 1000;
				setFileUpload({
					phase: "uploading",
					percent: Math.round((ev.loaded / ev.total) * 100),
					filename: file.name,
					sizeBytes: file.size,
					// Velocidad REAL (bytes ya subidos / tiempo transcurrido),
					// nunca derivada solo del porcentaje — encargo de
					// rediseño, parte 11.
					bytesPerSec: elapsedSec > 0 ? ev.loaded / elapsedSec : null,
				});
			});
			xhr.addEventListener("load", () => {
				uploadXhrRef.current = null;
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
				uploadXhrRef.current = null;
				setFileUpload({
					phase: "error",
					message: t("sender.castUploadFailed"),
				});
			});
			xhr.addEventListener("abort", () => {
				uploadXhrRef.current = null;
				setFileUpload(IDLE_UPLOAD);
			});
			xhr.open(
				"POST",
				`/cast/upload/${initialCode}?filename=${encodeURIComponent(file.name)}`,
			);
			xhr.send(file);
		},
		[initialCode, t],
	);

	const cancelUpload = useCallback(() => {
		uploadXhrRef.current?.abort();
	}, []);

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

	// Diagnostico SIEMPRE medido mientras comparte (no solo con
	// ?debug=1): codec, resolucion, fps de origen vs enviados, bitrate
	// real, techo disponible, QP medio, motivo de limitacion y retraso de
	// codificacion+envio. Son justo los campos que diagnosticaron los dos
	// hallazgos reales: Chrome/Brave negociando VP9 en negro
	// (docs/webrtc-codec.md) y que el coste es de RESOLUCION, no de
	// bitrate (docs/webrtc-quality.md) — no queremos volver a depurar
	// ninguno de los dos a ciegas. Con el rediseño pasan a un desplegable
	// (encargo de cierre) en vez de estar siempre a la vista, pero se
	// siguen midiendo igual: no se ha borrado ni un dato.
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

	// Resumen en vivo del desplegable "Calidad y audio" (encargo de
	// rediseño, parte 6) — no decorativo: es justo lo que hoy exige
	// recorrer seis filas de botones para saber.
	const audioSourceLabel =
		audioSource === "system"
			? t("sender.audioSourceSystem")
			: audioSource === "input-device"
				? t("sender.audioSourceDevice")
				: t("sender.audioSourceNone");
	const codecLabel = codecPref === "h264" ? "H.264" : codecPref.toUpperCase();
	const qualitySummary = `${codecLabel} · ${resolutionPreset.label} · ${quality.label} · ${audioSourceLabel}`;

	// Resumen en vivo del desplegable "Estadisticas" (encargo de
	// rediseño, parte 7).
	const statsSummary = t("sender.statsSummary", {
		sourceFps: stats.sourceFps ?? "?",
		fps: stats.fps ?? "?",
		delayMs: stats.avgPacketDelayMs ?? 0,
	});

	// "screen:1:0" no le dice nada a quien esta proyectando (encargo de
	// rediseño, parte 7) — el label crudo de getDisplayMedia solo se
	// reinterpreta cuando coincide con un prefijo conocido de Chrome; si
	// no, se muestra tal cual (mejor eso que inventar una clasificacion).
	const captureKind =
		state.phase === "sharing" ? classifyCaptureLabel(state.label) : null;
	const captureLabel =
		state.phase === "sharing"
			? captureKind === "full-screen"
				? t("sender.captureFullScreen")
				: captureKind === "window"
					? t("sender.captureWindow")
					: captureKind === "tab"
						? t("sender.captureTab")
						: state.label
			: "";

	return (
		<div className="flex min-h-screen flex-col bg-ink text-silver">
			<header className="flex items-center justify-between border-b border-line px-4 py-3">
				<Lockup />
				<div>
					{state.phase === "sharing" && (
						<StatusPill
							tone="live"
							label={`${t("sender.liveLabel")} · ${resolutionPreset.label} · ${codecLabel}`}
						/>
					)}
					{state.phase === "ready" &&
						senderMode === "cast" &&
						castStatus.url !== null &&
						(castStatus.errorMessage ? (
							<StatusPill tone="bad" label={t("sender.castErrorPillLabel")} />
						) : (
							<StatusPill tone="live" label={t("sender.castPlayingLabel")} />
						))}
					{state.phase === "ready" &&
						!(senderMode === "cast" && castStatus.url !== null) && (
							<StatusPill
								label={t("sender.roomLabel", { code: initialCode })}
							/>
						)}
					{state.phase === "session-ended" && (
						<StatusPill label={t("sender.disconnectedLabel")} />
					)}
					{state.phase === "error" && (
						<StatusPill tone="bad" label={t("sender.joinFailedLabel")} />
					)}
				</div>
			</header>

			<main className="flex flex-1 flex-col items-center gap-6 px-5 py-6">
				{state.phase === "joining" && (
					<p className="text-lg text-muted">{t("sender.joining")}</p>
				)}

				{state.phase === "ready" && (
					<div className="flex w-full max-w-[560px] flex-col gap-6">
						{!canMirror() && (
							<Alert variant="warning" title={t("sender.iosTitle")}>
								{t("sender.iosBody")}
							</Alert>
						)}

						{canMirror() && (
							<Segmented
								aria-label={t("sender.modeSelectorLabel")}
								value={senderMode}
								onChange={setSenderMode}
								options={[
									{ value: "mirror", label: t("sender.modeMirror") },
									{ value: "cast", label: t("sender.modeCast") },
								]}
							/>
						)}

						{senderMode === "cast" && (
							<div className="flex w-full max-w-[460px] flex-col gap-6">
								{castStatus.url === null ? (
									fileUpload.phase === "idle" ? (
										<>
											<div className="flex flex-col gap-2">
												<p className="text-[10.5px] uppercase tracking-widest text-faint">
													{t("sender.castUrlLabel")}
												</p>
												<input
													type="url"
													inputMode="url"
													data-testid="cast-url-input"
													value={castUrlInput}
													onChange={(e) => setCastUrlInput(e.target.value)}
													placeholder={t("sender.castUrlPlaceholder")}
													className="w-full rounded-md border border-line bg-ink-2 px-3.5 py-3 text-sm text-silver placeholder:text-faint focus:border-line-2 focus:outline-none"
												/>
												<p className="text-xs text-faint">
													{t("sender.castUrlHint")}
												</p>
												{castUrlError && (
													<p className="text-sm text-coral">{castUrlError}</p>
												)}
												<Button
													variant="primary"
													data-testid="cast-url-submit"
													onClick={submitCastUrl}
													disabled={castUrlInput.trim().length === 0}
													className="w-full"
												>
													{t("sender.castUrlSubmit")}
												</Button>
											</div>

											<div className="flex w-full items-center gap-4 text-xs text-faint">
												<span className="h-px flex-1 bg-line" />
												{t("sender.castOr")}
												<span className="h-px flex-1 bg-line" />
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
											<div className="flex flex-col gap-2">
												<p className="text-[10.5px] uppercase tracking-widest text-faint">
													{t("sender.castFileSectionLabel")}
												</p>
												<label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-ink-3 px-4 py-2.5 text-sm font-medium text-silver hover:bg-ink-4">
													<Upload size={17} strokeWidth={1.8} />
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
																	message: t(
																		"sender.castUnsupportedContainer",
																		{
																			ext: ext || "?",
																			formats: CAST_ALLOWED_EXTENSIONS_DISPLAY,
																		},
																	),
																});
																return;
															}
															uploadCastFile(file);
														}}
													/>
												</label>
												<p className="text-xs text-faint">
													{t("sender.castFileHint")}
												</p>
											</div>
										</>
									) : (
										<>
											{fileUpload.phase === "uploading" && (
												<UploadProgress
													filename={fileUpload.filename}
													sizeBytes={fileUpload.sizeBytes}
													percent={fileUpload.percent}
													bytesPerSec={fileUpload.bytesPerSec}
													onCancel={cancelUpload}
													uploadingLabel={t("sender.castUploading", {
														percent: fileUpload.percent,
													})}
													formatRemaining={(eta) =>
														t("sender.uploadRemaining", { eta })
													}
													lockPhoneNotice={t("sender.uploadLockPhoneNotice")}
													cancelLabel={t("sender.uploadCancel")}
												/>
											)}
											{fileUpload.phase === "processing" && (
												<p
													data-testid="cast-upload-status"
													className="text-sm text-muted"
												>
													{fileUpload.percent !== null
														? t("sender.castProcessingPercent", {
																percent: fileUpload.percent,
															})
														: t("sender.castProcessing")}
												</p>
											)}
											{fileUpload.phase === "error" && (
												<Alert
													variant="error"
													title={t("sender.castUploadFailed")}
													actions={
														<Button
															variant="secondary"
															onClick={() => setFileUpload(IDLE_UPLOAD)}
														>
															{t("sender.tryAgain")}
														</Button>
													}
												>
													{fileUpload.message}
												</Alert>
											)}
										</>
									)
								) : (
									<>
										{castStatus.errorMessage ? (
											<Alert
												variant="error"
												title={t("sender.castErrorTitle")}
												actions={
													<>
														<Button variant="primary" onClick={castNewUrl}>
															{t("sender.castErrorRetryLink")}
														</Button>
														<Button variant="secondary" onClick={castNewUrl}>
															{t("sender.castErrorUploadFile")}
														</Button>
													</>
												}
											>
												{t(`mediaError.${castStatus.errorMessage}` as I18nKey)}
											</Alert>
										) : (
											<div className="flex flex-col gap-3">
												<div className="flex items-center justify-between gap-3">
													<p className="truncate text-sm font-medium text-silver">
														{castStatus.url}
													</p>
													<span className="shrink-0 font-mono text-xs text-muted">
														{t("sender.castPositionLabel", {
															current: formatTime(castStatus.currentTimeSec),
															duration: formatTime(castStatus.durationSec),
														})}
													</span>
												</div>
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
												{castStatus.seekMayNotWork && (
													<p className="text-xs text-amber">
														{t("sender.castSeekMayNotWork")}
													</p>
												)}
												<PlaybackControls
													paused={castStatus.paused}
													onPlayPause={() =>
														send({
															type: castStatus.paused
																? "cast-play"
																: "cast-pause",
														})
													}
													onSkipBack={() =>
														send({
															type: "cast-seek",
															positionSec: Math.max(
																0,
																castStatus.currentTimeSec - SKIP_SECONDS,
															),
														})
													}
													onSkipForward={() =>
														send({
															type: "cast-seek",
															positionSec: Math.min(
																castStatus.durationSec ??
																	castStatus.currentTimeSec + SKIP_SECONDS,
																castStatus.currentTimeSec + SKIP_SECONDS,
															),
														})
													}
													volume={castStatus.volume}
													onVolumeChange={(volume) =>
														send({ type: "cast-volume", volume })
													}
													playPauseTestId="cast-play-pause"
													volumeTestId="cast-volume"
													skipLabels={{
														back: t("sender.playbackSkipBack"),
														forward: t("sender.playbackSkipForward"),
														playPause: castStatus.paused
															? t("sender.castPlay")
															: t("sender.castPause"),
													}}
												/>
											</div>
										)}
										<Button variant="secondary" onClick={castNewUrl}>
											{t("sender.castChangeUrl")}
										</Button>
									</>
								)}
							</div>
						)}

						{senderMode === "mirror" && canMirror() && (
							<div className="flex flex-col gap-4">
								<p className="text-sm text-muted">
									{t("sender.shareScreenHint")}
								</p>
								<Button
									variant="primary"
									icon={<MonitorUp size={17} strokeWidth={1.9} />}
									onClick={shareScreen}
									className="w-full"
								>
									{t("sender.shareScreen")}
								</Button>
							</div>
						)}

						{senderMode === "mirror" && canMirror() && (
							<Disclosure
								title={t("sender.advancedTitle")}
								liveSummary={qualitySummary}
							>
								{braveDetected && (
									<Alert variant="warning" title={t("sender.braveWarning")} />
								)}
								{isSafari() && (
									<p className="text-xs text-faint">{t("sender.safariNote")}</p>
								)}

								<div className="flex flex-col gap-1.5">
									<p className="text-[10.5px] uppercase tracking-widest text-faint">
										{t("sender.resolution")}
									</p>
									<Segmented
										value={resolutionPreset.id}
										onChange={(id) => {
											const preset = RESOLUTION_PRESETS.find(
												(p) => p.id === id,
											);
											if (!preset) return;
											setResolutionPreset(preset);
											saveResolutionPreset(preset);
										}}
										options={RESOLUTION_PRESETS.map((p) => ({
											value: p.id,
											label: p.label,
										}))}
									/>
								</div>

								<div className="flex flex-col gap-1.5">
									<p className="text-[10.5px] uppercase tracking-widest text-faint">
										{t("sender.quality")}
									</p>
									<Segmented
										value={quality.id}
										onChange={(id) => {
											const preset = QUALITY_PRESETS.find((p) => p.id === id);
											if (!preset) return;
											setQuality(preset);
											saveQualityPreset(preset);
										}}
										options={QUALITY_PRESETS.map((p) => ({
											value: p.id,
											label: p.label,
										}))}
									/>
								</div>

								<div className="flex flex-col gap-1.5">
									<p className="text-[10.5px] uppercase tracking-widest text-faint">
										{t("sender.audioSource")}
									</p>
									<Segmented
										value={audioSource}
										onChange={(value) => {
											setAudioSource(value);
											saveAudioSource(value);
											if (
												value === "input-device" &&
												audioDeviceStatus === "idle"
											)
												requestAudioDevices();
										}}
										options={[
											...(supportsSystemAudioCapture()
												? [
														{
															value: "system" as const,
															label: t("sender.audioSourceSystem"),
														},
													]
												: []),
											{
												value: "input-device" as const,
												label: t("sender.audioSourceDevice"),
											},
											{
												value: "none" as const,
												label: t("sender.audioSourceNone"),
											},
										]}
									/>
									{!supportsSystemAudioCapture() && (
										<p className="text-xs text-faint">
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
												className="cursor-pointer rounded-md border border-line bg-ink-3 px-3 py-2 text-sm text-silver"
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
											<div className="flex flex-col gap-2">
												<p className="text-xs text-muted">
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
													<Button
														variant="secondary"
														onClick={requestAudioDevices}
														className="self-start"
													>
														{audioDeviceStatus === "idle"
															? t("sender.audioGrantAccess")
															: t("sender.audioRetry")}
													</Button>
												)}
											</div>
										)}
								</div>

								<div className="flex flex-col gap-1.5">
									<p className="text-[10.5px] uppercase tracking-widest text-faint">
										{t("sender.codecPreference")}
									</p>
									<Segmented
										value={codecPref}
										onChange={(pref) => {
											setCodecPref(pref);
											saveCodecPreference(pref);
										}}
										options={[
											{ value: "vp8" as const, label: "VP8" },
											{ value: "h264" as const, label: "H.264" },
											{ value: "auto" as const, label: t("sender.codecAuto") },
										]}
									/>
									<p className="text-xs text-faint">{t("sender.codecHint")}</p>
									{chromeH264Warning && (
										<p className="text-xs text-amber">
											{t("sender.chromeH264Warning")}
										</p>
									)}
								</div>

								<div className="flex flex-col gap-1.5">
									<p className="text-[10.5px] uppercase tracking-widest text-faint">
										{t("sender.contentHint")}
									</p>
									<Segmented
										value={contentHint}
										onChange={setContentHint}
										options={[
											{
												value: "detail" as const,
												label: t("sender.contentDetail"),
											},
											{
												value: "motion" as const,
												label: t("sender.contentMotion"),
											},
										]}
									/>
									<p className="text-xs text-faint">
										{t("sender.contentHintHint")}
									</p>
								</div>
							</Disclosure>
						)}

						{senderMode === "mirror" && canMirror() && (
							<Alert variant="warning" title={t("sender.drmTitle")}>
								{t("sender.drmNotice")}
							</Alert>
						)}

						{state.error && <Alert variant="error" title={state.error} />}
					</div>
				)}

				{state.phase === "sharing" && (
					<div className="flex w-full max-w-[460px] flex-col gap-6">
						<div className="flex flex-col gap-1.5">
							<p className="text-[10.5px] uppercase tracking-widest text-faint">
								{t("sender.sharingSectionLabel")}
							</p>
							<div className="flex items-center gap-3">
								{state.hasAudio ? (
									<Mic size={19} strokeWidth={1.7} className="text-glass" />
								) : (
									<MicOff size={19} strokeWidth={1.7} className="text-muted" />
								)}
								<div>
									<p className="font-semibold text-silver">{captureLabel}</p>
									<p className="text-xs text-muted">
										{state.hasAudio
											? t("sender.audioStatusOn")
											: t("sender.audioStatusOff")}
									</p>
								</div>
							</div>
						</div>

						{negotiatedH264 && (
							<Alert variant="warning" title={t("sender.h264AspectWarning")} />
						)}
						{bitrateExceedsAvailable && (
							<p className="text-sm text-coral">
								{t("sender.bitrateExceedsWarning")}
							</p>
						)}

						<div className="flex flex-col gap-1.5">
							<p className="text-[10.5px] uppercase tracking-widest text-faint">
								{t("sender.aspectMode")}
							</p>
							<Segmented
								value={aspectMode}
								onChange={changeAspectMode}
								options={ASPECT_MODES.map((mode) => ({
									value: mode,
									label:
										mode === "auto"
											? t("sender.aspectAuto")
											: mode === "expanded"
												? t("sender.aspectExpanded")
												: mode,
								}))}
							/>
							<p className="text-xs text-faint">
								{t(aspectHintKey(aspectMode))}
							</p>
						</div>

						<Disclosure
							title={t("sender.statsTitle")}
							liveSummary={statsSummary}
						>
							<div className="font-mono text-[11.5px] leading-[1.8] text-faint">
								<p>
									<span className="text-muted">{t("sender.statsCodec")}</span>{" "}
									{stats.codec ?? "—"}
								</p>
								<p>
									<span className="text-muted">
										{t("sender.statsResolution")}
									</span>{" "}
									{stats.resolution ?? "—"}
								</p>
								<p>
									<span className="text-muted">{t("sender.statsFps")}</span>{" "}
									{stats.sourceFps ?? "?"} → {stats.fps ?? "?"}
								</p>
								<p>
									<span className="text-muted">{t("sender.statsBitrate")}</span>{" "}
									{stats.kbps !== null ? (stats.kbps / 1000).toFixed(1) : "?"}
									{stats.availableKbps !== null
										? ` / ${(stats.availableKbps / 1000).toFixed(1)}`
										: ""}{" "}
									Mbps
								</p>
								{stats.audioKbps !== null && (
									<p>
										<span className="text-muted">{t("sender.statsAudio")}</span>{" "}
										{stats.audioKbps} kbps
									</p>
								)}
								<p>
									<span className="text-muted">{t("sender.statsQp")}</span>{" "}
									{stats.avgQp ?? "?"} ·{" "}
									<span className="text-muted">
										{t("sender.statsLimitation")}
									</span>{" "}
									{stats.limitationReason ?? "none"}
								</p>
								<p className={highPacketDelay ? "text-coral" : undefined}>
									<span className="text-muted">{t("sender.statsDelay")}</span>{" "}
									{stats.avgPacketDelayMs ?? 0} ms
									{highPacketDelay ? ` — ${t("sender.highDelayWarning")}` : ""}
								</p>
							</div>
						</Disclosure>

						<Button variant="danger" onClick={stopSharing} className="w-full">
							{t("sender.stop")}
						</Button>
					</div>
				)}

				{state.phase === "session-ended" && (
					<Alert
						variant="error"
						title={
							state.reason === "screen-ended"
								? t("sender.screenEnded", { code: initialCode })
								: t("sender.selfStopped")
						}
						actions={
							<Button variant="primary" onClick={onExit}>
								{t("sender.backToStart")}
							</Button>
						}
					/>
				)}

				{state.phase === "error" && (
					<Alert
						variant="error"
						title={state.message}
						actions={
							<Button variant="primary" onClick={onExit}>
								{t("sender.tryAgain")}
							</Button>
						}
					/>
				)}
			</main>
		</div>
	);
}
