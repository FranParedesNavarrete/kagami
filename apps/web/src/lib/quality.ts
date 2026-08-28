// Escalones de BITRATE, elegibles desde la UI del emisor sin recompilar
// ni redesplegar. Medido en real (Chrome, pantalla completa, 4.5 min,
// ver docs/webrtc-quality.md): Chrome topa el bitrate de screenshare en
// ~2.5 Mbps por defecto — con availableOutgoingBitrate en 5.65 Mbps sin
// usar, encoder con margen de sobra y 0 paquetes perdidos. No es limite
// de red ni de CPU, es un techo por defecto que se puede subir a mano.
// La resolucion NO se downscalea aqui: la nativa (Retina incluida)
// funciono bien en esa misma corrida; el problema era solo el bitrate.
export interface QualityPreset {
	id: string;
	label: string;
	maxBitrate: number;
}

const Q_2_5M: QualityPreset = {
	id: "2500k",
	label: "2.5 Mbps",
	maxBitrate: 2_500_000,
};
const Q_5M: QualityPreset = {
	id: "5000k",
	label: "5 Mbps",
	maxBitrate: 5_000_000,
};
const Q_8M: QualityPreset = {
	id: "8000k",
	label: "8 Mbps",
	maxBitrate: 8_000_000,
};
const Q_12M: QualityPreset = {
	id: "12000k",
	label: "12 Mbps",
	maxBitrate: 12_000_000,
};

export const QUALITY_PRESETS: QualityPreset[] = [Q_2_5M, Q_5M, Q_8M, Q_12M];
// 8 Mbps de partida en LAN (ver docs/webrtc-quality.md): sobra margen de
// red y de CPU medido en la corrida de referencia, así que el punto de
// partida para encontrar el techo de la tele es alto, no conservador.
export const DEFAULT_QUALITY = Q_8M;

const STORAGE_KEY = "kagami-quality";

export function loadQualityPreset(): QualityPreset {
	try {
		const id = localStorage.getItem(STORAGE_KEY);
		return QUALITY_PRESETS.find((p) => p.id === id) ?? DEFAULT_QUALITY;
	} catch {
		return DEFAULT_QUALITY;
	}
}

export function saveQualityPreset(preset: QualityPreset): void {
	try {
		localStorage.setItem(STORAGE_KEY, preset.id);
	} catch {
		// localStorage puede fallar (modo privado, cuota); no es critico.
	}
}

// maxBitrate ANTES de que el sender empiece a negociar. scaleResolutionDownBy:1
// + degradationPreference "maintain-resolution" evitan que el encoder
// cambie de resolucion a mitad de stream (docs/webrtc-quality.md) — con
// bitrate de sobra, ese modo ya no cuesta framerate como pasaba a 2.5 Mbps.
export async function applyQualityToSender(
	sender: RTCRtpSender,
	preset: QualityPreset,
): Promise<void> {
	const params = sender.getParameters();
	if (!params.encodings || params.encodings.length === 0)
		params.encodings = [{}];
	const encoding = params.encodings[0];
	if (encoding) {
		encoding.maxBitrate = preset.maxBitrate;
		encoding.scaleResolutionDownBy = 1;
	}
	params.degradationPreference = "maintain-resolution";
	await sender.setParameters(params);
}
