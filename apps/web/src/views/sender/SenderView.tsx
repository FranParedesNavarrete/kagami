import type { ServerMessage } from "@kagami/shared";
import { Mic, MicOff, MonitorUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSignaling } from "../../hooks/useSignaling.js";
import { type I18nKey, useI18n } from "../../i18n/i18n.js";
import { canMirror, isIOS } from "../../lib/capabilities.js";
import {
	type PeerSession,
	RTC_CONFIG,
	createPeerSession,
	iceCandidateToMessage,
} from "../../lib/webrtc.js";

type SenderState =
	| { phase: "joining" }
	| { phase: "ios-blocked" }
	| { phase: "ready"; error?: string }
	| { phase: "sharing"; label: string; hasAudio: boolean }
	| { phase: "ended" }
	| { phase: "error"; message: string };

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
	const sessionRef = useRef<PeerSession | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const joinedRef = useRef(false);

	useEffect(() => {
		if (status === "open" && !joinedRef.current) {
			joinedRef.current = true;
			send({ type: "join-room", code: initialCode });
		}
	}, [status, send, initialCode]);

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
					case "peer-left":
						for (const track of streamRef.current?.getTracks() ?? [])
							track.stop();
						sessionRef.current?.pc.close();
						sessionRef.current = null;
						setState({ phase: "ended" });
						break;
					case "error":
						setState({ phase: "error", message: t(joinErrorKey(msg.code)) });
						break;
				}
			}),
		[subscribe, t],
	);

	async function shareScreen() {
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: true,
			});
			const pc = new RTCPeerConnection(RTC_CONFIG);
			const session = createPeerSession(pc);
			sessionRef.current = session;
			streamRef.current = stream;

			for (const track of stream.getTracks()) pc.addTrack(track, stream);
			pc.onicecandidate = (ev) => {
				if (ev.candidate)
					send({ type: "ice", candidate: iceCandidateToMessage(ev.candidate) });
			};

			const videoTrack = stream.getVideoTracks()[0];
			if (!videoTrack) throw new Error("no video track in captured stream");
			videoTrack.onended = () => stopSharing();

			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			send({ type: "offer", sdp: offer as { type: "offer"; sdp: string } });

			setState({
				phase: "sharing",
				label: videoTrack.label || "screen",
				hasAudio: stream.getAudioTracks().length > 0,
			});
		} catch {
			setState({ phase: "ready", error: t("sender.shareFailed") });
		}
	}

	function stopSharing() {
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sessionRef.current?.pc.close();
		sessionRef.current = null;
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
					<button
						type="button"
						onClick={shareScreen}
						className="flex items-center gap-3 rounded-xl bg-blue-600 px-8 py-4 text-xl font-semibold hover:bg-blue-500"
					>
						<MonitorUp size={28} />
						{t("sender.shareScreen")}
					</button>
					{state.error && <p className="text-red-400">{state.error}</p>}
				</>
			)}

			{state.phase === "sharing" && (
				<>
					<p className="flex items-center gap-2 text-xl">
						{state.hasAudio ? <Mic size={20} /> : <MicOff size={20} />}
						{t("sender.sharingLabel", { label: state.label })} (
						{state.hasAudio ? t("sender.audioYes") : t("sender.audioNo")})
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
