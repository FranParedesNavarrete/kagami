// Sin STUN ni TURN: solo candidatos host, LAN/tailnet (SPECS.md §4.2).
export const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

// RTCIceCandidate.toJSON() tipa `candidate` como opcional; nuestro
// esquema de señalizacion lo exige como string. En la practica siempre
// viene relleno para un candidate real.
export function iceCandidateToMessage(candidate: RTCIceCandidate): {
	candidate: string;
	sdpMid?: string | null;
	sdpMLineIndex?: number | null;
	usernameFragment?: string | null;
} {
	const json = candidate.toJSON();
	return { ...json, candidate: json.candidate ?? "" };
}

// Cola de ICE candidates hasta tener remote description — sin esto, un
// candidate que llega antes de setRemoteDescription() falla (aprendido a
// la fuerza en el spike M-1, ver docs/registro.md).
export interface PeerSession {
	pc: RTCPeerConnection;
	addRemoteIce(candidate: RTCIceCandidateInit): void;
	setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>;
}

export function createPeerSession(pc: RTCPeerConnection): PeerSession {
	const pending: RTCIceCandidateInit[] = [];

	return {
		pc,
		addRemoteIce(candidate) {
			if (pc.remoteDescription) {
				pc.addIceCandidate(candidate).catch((err) =>
					console.warn("addIceCandidate failed", err),
				);
			} else {
				pending.push(candidate);
			}
		},
		async setRemoteDescription(desc) {
			await pc.setRemoteDescription(desc);
			for (const candidate of pending.splice(0)) {
				await pc
					.addIceCandidate(candidate)
					.catch((err) => console.warn("addIceCandidate failed", err));
			}
		},
	};
}
