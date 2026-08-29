import type { AspectMode } from "@kagami/shared";
import type { CSSProperties } from "react";

// Modo de aspecto de la vista pantalla — puro CSS, nunca toca la
// conexion WebRTC (cambiar la codificacion a mitad de stream esta
// prohibido, ver docs/webrtc-quality.md). El control vive en el emisor
// y viaja por WS porque el mando de la tele es incomodo para esto. El
// tipo AspectMode es el de packages/shared: es literalmente lo que viaja
// en el mensaje set-aspect-mode, una sola fuente de verdad.
export type { AspectMode };

export const ASPECT_MODES: AspectMode[] = [
	"auto",
	"cover",
	"16:9",
	"21:9",
	"4:3",
];
export const DEFAULT_ASPECT_MODE: AspectMode = "auto";

const STORAGE_KEY = "kagami-aspect-mode";

export function loadAspectMode(): AspectMode {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return (ASPECT_MODES as string[]).includes(value ?? "")
			? (value as AspectMode)
			: DEFAULT_ASPECT_MODE;
	} catch {
		return DEFAULT_ASPECT_MODE;
	}
}

export function saveAspectMode(mode: AspectMode): void {
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// localStorage puede fallar (modo privado, cuota); no es critico.
	}
}

const FIXED_RATIOS: Record<Exclude<AspectMode, "auto" | "cover">, number> = {
	"16:9": 16 / 9,
	"21:9": 21 / 9,
	"4:3": 4 / 3,
};

// "16:9"/"21:9"/"4:3": min()+calc() con vw/vh encaja la caja del ratio
// pedido dentro del viewport (letterbox o pillarbox segun haga falta)
// sin medir nada por JS ni depender de un ResizeObserver.
export function videoStyleForAspect(mode: AspectMode): CSSProperties {
	if (mode === "auto")
		return { width: "100%", height: "100%", objectFit: "contain" };
	if (mode === "cover")
		return { width: "100%", height: "100%", objectFit: "cover" };
	const ratio = FIXED_RATIOS[mode];
	return {
		width: `min(100vw, calc(100vh * ${ratio}))`,
		height: `min(100vh, calc(100vw / ${ratio}))`,
		objectFit: "cover",
	};
}
