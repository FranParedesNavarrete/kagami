import type { AspectMode } from "@kagami/shared";
import type { CSSProperties } from "react";

// Modo de aspecto de la vista pantalla — puro CSS (min()/calc()/
// aspect-ratio resueltos por el motor de CSS, nunca JS calculando
// tamaños o posiciones), nunca toca la conexion WebRTC. El control vive
// en el emisor y viaja por WS porque el mando de la tele es incomodo
// para esto. El tipo AspectMode es el de packages/shared: es
// literalmente lo que viaja en el mensaje set-aspect-mode.
export type { AspectMode };

export const ASPECT_MODES: AspectMode[] = [
	"auto",
	"expanded",
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

const FIXED_RATIOS: Record<Exclude<AspectMode, "auto" | "expanded">, number> = {
	"16:9": 16 / 9,
	"21:9": 21 / 9,
	"4:3": 4 / 3,
};

// La caja que envuelve al <video>. El video en si es SIEMPRE
// width:100%/height:100%/display:block dentro de esta caja — lo que
// cambia por modo es el TAMAÑO de la caja, nunca una capa por encima
// del video. Lo que se ve "vacio" alrededor de la caja es sencillamente
// el fondo #000 del contenedor raiz asomando — jamas un elemento de
// franja superpuesto.
//
// "auto"/"expanded": la caja es el viewport entero.
// "16:9"/"21:9"/"4:3": la caja mas grande de ese ratio que quepa en el
// viewport, centrada — min(100dvw, 100dvh*ratio) / min(100dvh,
// 100dvw/ratio) da exactamente eso sin medir nada por JS. dvh/dvw, no
// vh/vw: webOS reporta vh incluyendo area oculta bajo su barra, lo que
// producia scroll (ver index.css).
export function containerStyleForAspect(mode: AspectMode): CSSProperties {
	if (mode === "auto" || mode === "expanded") {
		return { width: "100%", height: "100%" };
	}
	const ratio = FIXED_RATIOS[mode];
	return {
		aspectRatio: `${ratio}`,
		width: `min(100dvw, calc(100dvh * ${ratio}))`,
		height: `min(100dvh, calc(100dvw / ${ratio}))`,
	};
}

// object-fit por modo — la unica pieza que decide si se pierde
// contenido o no:
// - "auto": contain. Se ve todo, proporcion real, franjas si hace falta.
// - "expanded" (expandido): cover. Llena la tele, recorta bordes — el
//   unico modo donde se pierde contenido, y es la eleccion explicita
//   del usuario ("expandido").
// - ratios fijos: fill, NUNCA cover. El usuario pidio ese formato
//   sabiendo que su pantalla no lo es; la deformacion es intencionada,
//   pero perder contenido no lo es — por eso fill (estira, no recorta)
//   y no cover (recortaria para llenar la caja).
export function videoObjectFitForAspect(
	mode: AspectMode,
): CSSProperties["objectFit"] {
	if (mode === "auto") return "contain";
	if (mode === "expanded") return "cover";
	return "fill";
}
