// Extraccion de los contadores del diagnostico ?debug=1 (ver
// docs/webrtc-quality.md): con esto se distingue, cuando la tele se
// congela, si la conexion sigue viva y solo dejan de llegar/decodificarse
// frames (culpa del decodificador) o si la conexion en si murio.

export interface InboundVideoStats {
	framesDecoded: number;
	framesDropped: number;
	bytesReceived: number;
	frameWidth?: number;
	frameHeight?: number;
}

export async function getInboundVideoStats(
	pc: RTCPeerConnection,
): Promise<InboundVideoStats | null> {
	const report = await pc.getStats();
	let result: InboundVideoStats | null = null;
	for (const stat of report.values()) {
		if (stat.type === "inbound-rtp" && stat.kind === "video") {
			result = {
				framesDecoded: stat.framesDecoded ?? 0,
				framesDropped: stat.framesDropped ?? 0,
				bytesReceived: stat.bytesReceived ?? 0,
				frameWidth: stat.frameWidth,
				frameHeight: stat.frameHeight,
			};
		}
	}
	return result;
}

// Que codec se negocio DE VERDAD, no el que se pidio — la unica forma
// fiable de confirmarlo tras el hallazgo de que Chrome/Brave negocian
// VP9 por defecto para compartir pantalla y la tele se queda en negro
// sin avisar (docs/webrtc-codec.md).
export async function getNegotiatedVideoCodec(
	pc: RTCPeerConnection,
	direction: "inbound-rtp" | "outbound-rtp",
): Promise<string | null> {
	const report = await pc.getStats();
	let codecId: string | undefined;
	for (const stat of report.values()) {
		if (stat.type === direction && stat.kind === "video")
			codecId = stat.codecId;
	}
	if (!codecId) return null;
	const codecStat = report.get(codecId);
	return codecStat?.type === "codec" ? codecStat.mimeType : null;
}

// qpSum/framesEncoded y qualityLimitationReason son los campos que de
// verdad diagnosticaron el borron en movimiento (docs/webrtc-quality.md):
// QP medio alto con qualityLimitationReason "none" (ni red ni CPU)
// significa que el propio bitrate objetivo es el techo, no la LAN ni la
// tele. Siempre visibles en la UI del emisor mientras comparte, no solo
// con ?debug=1 — no queremos volver a diagnosticar esto a ciegas.
export interface OutboundVideoStats {
	framesSent: number;
	bytesSent: number;
	frameWidth?: number;
	frameHeight?: number;
	framesPerSecond?: number;
	framesEncoded?: number;
	qpSum?: number;
	qualityLimitationReason?: string;
}

export async function getOutboundVideoStats(
	pc: RTCPeerConnection,
): Promise<OutboundVideoStats | null> {
	const report = await pc.getStats();
	let result: OutboundVideoStats | null = null;
	for (const stat of report.values()) {
		if (stat.type === "outbound-rtp" && stat.kind === "video") {
			result = {
				framesSent: stat.framesSent ?? 0,
				bytesSent: stat.bytesSent ?? 0,
				frameWidth: stat.frameWidth,
				frameHeight: stat.frameHeight,
				framesPerSecond: stat.framesPerSecond,
				framesEncoded: stat.framesEncoded,
				qpSum: stat.qpSum,
				qualityLimitationReason: stat.qualityLimitationReason,
			};
		}
	}
	return result;
}
