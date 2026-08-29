// Resolucion fija desde el primer frame, elegida por el usuario y NUNCA
// recalculada a mitad de stream (cambiarla mata al decodificador de la
// tele, ver docs/webrtc-quality.md). Diagnostico real de esta sesion: la
// codificacion es por SOFTWARE (libvpx) y su coste escala con pixeles,
// no con bitrate — capturar a resolucion nativa Retina (5.9 Mpx/frame)
// no da tiempo a codificar aunque sobre ancho de banda, y ese retraso de
// codificacion es lo que desincroniza el audio (que va instantaneo).
export interface ResolutionPreset {
	id: string;
	label: string;
	targetWidth: number | null; // null = nativa, sin downscale
}

const R_720P: ResolutionPreset = {
	id: "720p",
	label: "720p",
	targetWidth: 1280,
};
const R_1080P: ResolutionPreset = {
	id: "1080p",
	label: "1080p",
	targetWidth: 1920,
};
const R_NATIVE: ResolutionPreset = {
	id: "native",
	label: "Native",
	targetWidth: null,
};

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
	R_720P,
	R_1080P,
	R_NATIVE,
];
// 1080p por defecto: la nativa Retina es contraproducente (ver arriba) y
// 720p deja calidad sobre la mesa cuando 1080p ya va fluido.
export const DEFAULT_RESOLUTION = R_1080P;

const STORAGE_KEY = "kagami-resolution";

export function loadResolutionPreset(): ResolutionPreset {
	try {
		const id = localStorage.getItem(STORAGE_KEY);
		return RESOLUTION_PRESETS.find((p) => p.id === id) ?? DEFAULT_RESOLUTION;
	} catch {
		return DEFAULT_RESOLUTION;
	}
}

export function saveResolutionPreset(preset: ResolutionPreset): void {
	try {
		localStorage.setItem(STORAGE_KEY, preset.id);
	} catch {
		// localStorage puede fallar (modo privado, cuota); no es critico.
	}
}

// >=1 siempre (asi lo exige WebRTC): si la resolucion nativa capturada ya
// es menor que el objetivo (p.ej. un portatil sin Retina pidiendo 1080p
// sobre una pantalla de 1366px), no se puede "subescalar" — se deja tal
// cual en vez de forzar un valor invalido.
export function computeScaleResolutionDownBy(
	preset: ResolutionPreset,
	capturedWidth: number,
): number {
	if (!preset.targetWidth) return 1;
	return Math.max(1, capturedWidth / preset.targetWidth);
}
