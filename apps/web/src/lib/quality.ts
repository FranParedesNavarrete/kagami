// Escalones de BITRATE, elegibles desde la UI del emisor sin recompilar
// ni redesplegar. Son un TECHO deseado, no un valor fijo: el emisor los
// recorta en vivo a como mucho ~85% de availableOutgoingBitrate (ver
// capMaxBitrate) para no mandar mas de lo que la red puede llevar de
// verdad. Medido en real (Chrome, pantalla completa, 4.5 min, ver
// docs/webrtc-quality.md): Chrome topa el bitrate de screenshare en
// ~2.5 Mbps por defecto sin que sea limite de red ni de CPU.
//
// La causa raiz real, medida despues, no era el bitrate sino la
// RESOLUCION (docs/webrtc-quality.md, sesion de calidad/latencia): la
// codificacion es por software y su coste escala con pixeles. La
// resolucion se fija aparte, ver lib/resolution.ts.
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
// 5 Mbps por defecto: a 1080p (la resolucion por defecto, ver
// lib/resolution.ts) sobra de sobra y no satura — 8/12 Mbps solo tenian
// sentido como techo cuando se pensaba que el bitrate era la causa raiz.
export const DEFAULT_QUALITY = Q_5M;

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

// maxBitrate y scaleResolutionDownBy ANTES de que el sender empiece a
// negociar. scaleResolutionDownBy se calcula fuera (lib/resolution.ts) a
// partir de la resolucion REAL capturada, nunca un valor fijo — un Mac
// sin Retina y uno con Retina necesitan factores de escala distintos
// para llegar al mismo 1080p. degradationPreference "maintain-resolution"
// evita que el encoder cambie de resolucion a mitad de stream
// (docs/webrtc-quality.md): con bitrate y resolucion ya ajustados, ese
// modo no debería costar framerate como pasaba a 2.5 Mbps/nativa.
export async function applyQualityToSender(
	sender: RTCRtpSender,
	preset: QualityPreset,
	scaleResolutionDownBy: number,
): Promise<void> {
	const params = sender.getParameters();
	if (!params.encodings || params.encodings.length === 0)
		params.encodings = [{}];
	const encoding = params.encodings[0];
	if (encoding) {
		encoding.maxBitrate = preset.maxBitrate;
		encoding.scaleResolutionDownBy = scaleResolutionDownBy;
	}
	params.degradationPreference = "maintain-resolution";
	await sender.setParameters(params);
}

// Ajuste adaptativo en vivo (requisito 2 del sprint de calidad): el
// bitrate efectivo nunca debe superar availableOutgoingBitrate. Solo
// toca maxBitrate — resolucion y degradationPreference no se tocan
// nunca a mitad de stream. No llama a setParameters si el valor no
// cambia, para no generar renegociacion de mas cada segundo.
export async function capMaxBitrate(
	sender: RTCRtpSender,
	capBps: number,
): Promise<void> {
	const params = sender.getParameters();
	const encoding = params.encodings?.[0];
	if (!encoding || encoding.maxBitrate === capBps) return;
	encoding.maxBitrate = capBps;
	await sender.setParameters(params);
}
