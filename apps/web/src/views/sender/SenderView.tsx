import type { AspectMode, ServerMessage } from "@kagami/shared";
import { Mic, MicOff, MonitorUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSignaling } from "../../hooks/useSignaling.js";
import { type I18nKey, useI18n } from "../../i18n/i18n.js";
import {
	ASPECT_MODES,
	loadAspectMode,
	saveAspectMode,
} from "../../lib/aspect.js";
import {
	type AudioSource,
	captureMedia,
	listAudioInputDevices,
	loadAudioDeviceId,
	loadAudioSource,
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
	getOutboundVideoStats,
} from "../../lib/webrtcStats.js";

type SenderState =
	| { phase: "joining" }
	| { phase: "ios-blocked" }
	| { phase: "ready"; error?: string }
	| { phase: "sharing"; label: string; hasAudio: boolean }
	| { phase: "session-ended"; reason: "screen-ended" | "self-stopped" }
	| { phase: "error"; message: string };

interface LiveStats {
	codec: string | null;
	resolution: string | null;
	fps: number | null;
	sourceFps: number | null;
	kbps: number | null;
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
	const [aspectMode, setAspectMode] = useState<AspectMode>(loadAspectMode);
	const [braveDetected, setBraveDetected] = useState(false);
	const [stats, setStats] = useState<LiveStats>(EMPTY_STATS);
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

	useEffect(() => {
		if (audioSource !== "input-device") return;
		listAudioInputDevices()
			.then(setAudioDevices)
			.catch((err) => console.warn("enumerateDevices failed", err));
	}, [audioSource]);

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
					pc.addTrack(track, stream);
				}
			}

			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			send({ type: "offer", sdp: offer as { type: "offer"; sdp: string } });
		},
		[send, quality, codecPref, resolutionPreset],
	);

	useEffect(
		() =>
			subscribe((msg: ServerMessage) => {
				switch (msg.type) {
					case "room-joined":
						setState(
							canMirror() ? { phase: "ready" } : { phase: "ios-blocked" },
						);
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
		let lastQpSum = 0;
		let lastFramesEncoded = 0;
		let lastDelay = 0;
		let lastPacketsSent = 0;
		let lastTime = performance.now();

		const interval = setInterval(async () => {
			const pc = sessionRef.current?.pc;
			if (!pc) return;
			const [codec, outbound, availableBps] = await Promise.all([
				getNegotiatedVideoCodec(pc, "outbound-rtp"),
				getOutboundVideoStats(pc),
				getAvailableOutgoingBitrate(pc),
			]);
			if (!outbound) return;

			const now = performance.now();
			const elapsedS = (now - lastTime) / 1000;
			const kbps =
				elapsedS > 0
					? Math.round(((outbound.bytesSent - lastBytes) * 8) / elapsedS / 1000)
					: null;

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

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 px-6 text-center text-white">
			{state.phase === "joining" && (
				<p className="text-2xl">{t("sender.joining")}</p>
			)}

			{state.phase === "ios-blocked" && (
				<div className="max-w-md space-y-3">
					<h2 className="text-2xl font-bold">{t("sender.iosTitle")}</h2>
					<p className="text-white/70">{t("sender.iosBody")}</p>
				</div>
			)}

			{state.phase === "ready" && (
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
						<span className="text-sm text-white/60">{t("sender.quality")}</span>
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
						{audioSource === "input-device" && (
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
					</div>

					<button
						type="button"
						onClick={shareScreen}
						className="flex items-center gap-3 rounded-xl bg-blue-600 px-8 py-4 text-xl font-semibold hover:bg-blue-500"
					>
						<MonitorUp size={28} />
						{t("sender.shareScreen")}
					</button>
					{state.error && (
						<p className="max-w-md text-red-400">{state.error}</p>
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
