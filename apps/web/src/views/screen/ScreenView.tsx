import { useEffect, useRef, useState } from "react";
import { QrCode } from "../../components/QrCode.js";
import { useSignaling } from "../../hooks/useSignaling.js";
import { useI18n } from "../../i18n/i18n.js";
import {
	type PeerSession,
	RTC_CONFIG,
	createPeerSession,
	iceCandidateToMessage,
} from "../../lib/webrtc.js";

type ScreenState =
	| { phase: "connecting" }
	| { phase: "code"; code: string; expiresInMs: number }
	| { phase: "peer-connecting" }
	| { phase: "sharing" }
	| { phase: "error"; message: string };

function senderUrl(code: string): string {
	return `${location.origin}/?code=${code}`;
}

// Vista de la tele: HTTP plano, sin APIs de contexto seguro (SPECS.md §4.4).
export function ScreenView() {
	const { status, send, subscribe } = useSignaling();
	const { t } = useI18n();
	const [state, setState] = useState<ScreenState>({ phase: "connecting" });
	const videoRef = useRef<HTMLVideoElement>(null);
	const sessionRef = useRef<PeerSession | null>(null);

	useEffect(() => {
		if (status === "open") send({ type: "create-room" });
	}, [status, send]);

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
		[subscribe, send],
	);

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

					{state.phase === "error" && (
						<p className="text-3xl text-red-400">
							{t("screen.errorPrefix", { message: state.message })}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
