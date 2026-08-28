import type { ServerMessage } from "@kagami/shared";
import { Mic, MicOff, MonitorUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSignaling } from "../../hooks/useSignaling.js";
import { type I18nKey, useI18n } from "../../i18n/i18n.js";
import { canMirror, isIOS } from "../../lib/capabilities.js";
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
	loadQualityPreset,
	saveQualityPreset,
} from "../../lib/quality.js";
import {
	type PeerSession,
	RTC_CONFIG,
	createPeerSession,
	iceCandidateToMessage,
} from "../../lib/webrtc.js";
import {
	getNegotiatedVideoCodec,
	getOutboundVideoStats,
} from "../../lib/webrtcStats.js";

type SenderState =
	| { phase: "joining" }
	| { phase: "ios-blocked" }
	| { phase: "ready"; error?: string }
	| { phase: "sharing"; label: string; hasAudio: boolean }
	| { phase: "ended" }
	| { phase: "error"; message: string };

interface LiveStats {
	codec: string | null;
	resolution: string | null;
	fps: number | null;
	kbps: number | null;
	avgQp: number | null;
	limitationReason: string | null;
}

const EMPTY_STATS: LiveStats = {
	codec: null,
	resolution: null,
	fps: null,
	kbps: null,
	avgQp: null,
	limitationReason: null,
};

function joinErrorKey(code: string): I18nKey {
	const key = `sender.joinError.${code}` as I18nKey;
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
	const [codecPref, setCodecPref] =
		useState<CodecPreference>(loadCodecPreference);
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
					await applyQualityToSender(transceiver.sender, quality).catch((err) =>
						console.warn("setParameters failed", err),
					);
				} else {
					pc.addTrack(track, stream);
				}
			}

			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			send({ type: "offer", sdp: offer as { type: "offer"; sdp: string } });
		},
		[send, quality, codecPref],
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
						for (const track of streamRef.current?.getTracks() ?? [])
							track.stop();
						streamRef.current = null;
						sessionRef.current?.pc.close();
						sessionRef.current = null;
						setState({ phase: "ended" });
						break;
					case "error":
						setState({ phase: "error", message: t(joinErrorKey(msg.code)) });
						break;
				}
			}),
		[subscribe, t, startPeerConnection],
	);

	// Diagnostico SIEMPRE visible mientras comparte (no solo con
	// ?debug=1): codec, resolucion, fps, bitrate real y QP medio. Son
	// justo los campos que diagnosticaron el hallazgo real — Chrome/Brave
	// negociando VP9 en negro (docs/webrtc-codec.md) y el techo de
	// bitrate por defecto emborronando el movimiento sin que fuera la
	// red ni la CPU (docs/webrtc-quality.md). No queremos volver a
	// depurar ninguno de los dos a ciegas.
	useEffect(() => {
		if (state.phase !== "sharing") return;
		let lastBytes = 0;
		let lastQpSum = 0;
		let lastFramesEncoded = 0;
		let lastTime = performance.now();

		const interval = setInterval(async () => {
			const pc = sessionRef.current?.pc;
			if (!pc) return;
			const [codec, outbound] = await Promise.all([
				getNegotiatedVideoCodec(pc, "outbound-rtp"),
				getOutboundVideoStats(pc),
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

			lastBytes = outbound.bytesSent;
			lastTime = now;

			setStats((prev) => ({
				codec: codec ?? prev.codec,
				resolution:
					outbound.frameWidth && outbound.frameHeight
						? `${outbound.frameWidth}x${outbound.frameHeight}`
						: prev.resolution,
				fps: outbound.framesPerSecond ?? prev.fps,
				kbps: kbps ?? prev.kbps,
				avgQp: avgQp ?? prev.avgQp,
				limitationReason:
					outbound.qualityLimitationReason ?? prev.limitationReason,
			}));
		}, 1000);
		return () => clearInterval(interval);
	}, [state.phase]);

	async function shareScreen() {
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				// Sin width/height: medido en real que la resolucion nativa
				// (Retina incluida) va bien de CPU y de red — el problema no
				// era la resolucion, era el techo de bitrate por defecto de
				// Chrome (ver docs/webrtc-quality.md). frameRate si se pide,
				// como numero llano (Chromium rechaza `exact` con TypeError).
				video: { frameRate: 30 },
				audio: true,
			});
			streamRef.current = stream;

			const videoTrack = stream.getVideoTracks()[0];
			if (!videoTrack) throw new Error("no video track in captured stream");
			videoTrack.onended = () => stopSharing();

			setStats(EMPTY_STATS);
			await startPeerConnection(stream);

			setState({
				phase: "sharing",
				label: videoTrack.label || "screen",
				hasAudio: stream.getAudioTracks().length > 0,
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
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sessionRef.current?.pc.close();
		sessionRef.current = null;
		setStats(EMPTY_STATS);
		send({ type: "leave" });
		setState({ phase: "ready" });
	}

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
						{stats.fps !== null ? ` · ${stats.fps}fps` : ""}
						{stats.kbps !== null
							? ` · ${(stats.kbps / 1000).toFixed(1)}Mbps`
							: ""}
						{stats.avgQp !== null ? ` · QP ${stats.avgQp}` : ""}
						{stats.limitationReason
							? ` · limit: ${stats.limitationReason}`
							: ""}
					</p>
					<button
						type="button"
						onClick={stopSharing}
						className="rounded-xl bg-red-600 px-6 py-3 font-semibold hover:bg-red-500"
					>
						{t("sender.stop")}
					</button>
				</>
			)}

			{state.phase === "ended" && (
				<>
					<p className="text-2xl">{t("sender.screenLeft")}</p>
					<button
						type="button"
						onClick={onExit}
						className="text-blue-400 underline"
					>
						{t("sender.tryAgain")}
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
