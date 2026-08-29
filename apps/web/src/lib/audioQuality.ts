// WebRTC negocia Opus con los valores por defecto de VIDEOLLAMADA: mono,
// bitrate bajo (medido en produccion: targetBitrate 32 kbps, fmtp sin
// stereo=1 — ver docs/webrtc-quality.md). Tiene sentido para una voz;
// kagami transporta audio de SISTEMA — musica, peliculas — donde eso se
// percibe como perdida de calidad (no lo era: cero paquetes perdidos,
// era la negociacion de audio pidiendo mono a 32 kbps sin que nadie lo
// pidiera a proposito).
//
// No hay una API de alto nivel de WebRTC para pedir Opus en estereo: el
// unico mecanismo es anadir los parametros al `a=fmtp` de Opus en el SDP
// a mano, antes de `setLocalDescription`. Se hace en UNA funcion propia
// y documentada, nunca con reemplazos de texto dispersos por el codigo.
const OPUS_EXTRA_PARAMS: Record<string, string> = {
	stereo: "1",
	"sprop-stereo": "1",
	maxaveragebitrate: "128000",
};

function findOpusPayloadType(lines: string[]): string | null {
	for (const line of lines) {
		const match = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
		if (match) return match[1] ?? null;
	}
	return null;
}

// Fusiona los parametros nuevos con los que ya trajera la linea fmtp
// (minptime, useinbandfec...) en vez de machacarla — perderlos rompe
// otras cosas que Chrome ya negocia bien por defecto.
function mergeFmtpLine(line: string, payload: string): string {
	const prefix = `a=fmtp:${payload} `;
	const existing = line.slice(prefix.length);
	const params = new Map<string, string>();
	for (const pair of existing.split(";")) {
		const [key, value] = pair.split("=");
		if (key) params.set(key.trim(), (value ?? "").trim());
	}
	for (const [key, value] of Object.entries(OPUS_EXTRA_PARAMS)) {
		params.set(key, value);
	}
	const merged = [...params.entries()]
		.map(([key, value]) => (value ? `${key}=${value}` : key))
		.join(";");
	return prefix + merged;
}

// Aplica los parametros de Opus estereo a la oferta SDP generada por
// `createOffer()`. Si el navegador no ofrece Opus (no deberia pasar,
// pero mejor no reventar la conexion por esto), devuelve el SDP sin
// tocar.
export function withStereoOpus(sdp: string): string {
	const lines = sdp.split("\r\n");
	const payload = findOpusPayloadType(lines);
	if (payload === null) return sdp;

	let sawFmtp = false;
	const result = lines.map((line) => {
		if (!line.startsWith(`a=fmtp:${payload} `)) return line;
		sawFmtp = true;
		return mergeFmtpLine(line, payload);
	});

	if (!sawFmtp) {
		// Sin linea fmtp previa (no visto en la practica, pero posible segun
		// el navegador): se inserta justo despues del rtpmap de Opus.
		const rtpmapIndex = result.findIndex((line) =>
			line.startsWith(`a=rtpmap:${payload} opus/`),
		);
		if (rtpmapIndex !== -1) {
			const params = Object.entries(OPUS_EXTRA_PARAMS)
				.map(([key, value]) => `${key}=${value}`)
				.join(";");
			result.splice(rtpmapIndex + 1, 0, `a=fmtp:${payload} ${params}`);
		}
	}

	return result.join("\r\n");
}

// Mismo mecanismo que `capMaxBitrate` (lib/quality.ts) pero para el
// unico encoding de audio — 128 kbps de techo real para audio de
// sistema en estereo, no los ~32 kbps de una llamada de voz mono.
export const AUDIO_MAX_BITRATE_BPS = 128_000;

export async function applyAudioBitrate(
	sender: RTCRtpSender,
	maxBitrate: number = AUDIO_MAX_BITRATE_BPS,
): Promise<void> {
	const params = sender.getParameters();
	if (!params.encodings || params.encodings.length === 0)
		params.encodings = [{}];
	const encoding = params.encodings[0];
	if (encoding) encoding.maxBitrate = maxBitrate;
	await sender.setParameters(params);
}
