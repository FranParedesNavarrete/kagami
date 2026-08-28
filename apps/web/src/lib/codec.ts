// Fuerza el conjunto de codecs de video ofrecidos a H.264/VP8, y EXCLUYE
// del todo VP9/AV1/cualquier otro — no reordenado detras, excluido. La
// tele del spike M-1 solo decodifica H.264/VP8; si el emisor negocia
// VP9/AV1 (lo que Chrome/Brave prefieren por defecto para compartir
// pantalla), la tele se queda en negro total sin ningun aviso — visto de
// verdad en produccion. Ver docs/webrtc-codec.md y SPECS.md §4.2.
//
// Orden por defecto VP8 primero, H.264 de respaldo: es lo MEDIDO en esta
// tele (4.5 min reales sin cortes, sin cambios de resolucion, con
// Chrome/VP8). H.264 solo se ha visto funcionar parcialmente (Safari, y
// se congelaba al cambiar de resolucion) — preferirlo por defecto habria
// sido elegir una hipotesis sin verificar por encima de la configuracion
// con prueba real. Configurable desde la UI del emisor precisamente para
// verificar por medicion, no por suposicion, si el fix de
// maintain-resolution (docs/webrtc-quality.md) rescata H.264 o no.
export type CodecPreference = "vp8" | "h264" | "auto";

const MIME_BY_PREFERENCE: Record<Exclude<CodecPreference, "auto">, string> = {
	vp8: "video/vp8",
	h264: "video/h264",
};
const ALLOWED_MIMES = Object.values(MIME_BY_PREFERENCE);
const AUX_CODECS = [
	"video/rtx",
	"video/red",
	"video/ulpfec",
	"video/flexfec-03",
];

const STORAGE_KEY = "kagami-codec-preference";
export const DEFAULT_CODEC_PREFERENCE: CodecPreference = "vp8";

export function loadCodecPreference(): CodecPreference {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return value === "vp8" || value === "h264" || value === "auto"
			? value
			: DEFAULT_CODEC_PREFERENCE;
	} catch {
		return DEFAULT_CODEC_PREFERENCE;
	}
}

export function saveCodecPreference(preference: CodecPreference): void {
	try {
		localStorage.setItem(STORAGE_KEY, preference);
	} catch {
		// localStorage puede fallar (modo privado, cuota); no es critico.
	}
}

export class UnsupportedCodecError extends Error {
	constructor() {
		super(
			"neither H.264 nor VP8 is available in this browser for sending video",
		);
		this.name = "UnsupportedCodecError";
	}
}

// Lanza UnsupportedCodecError si el navegador no ofrece ni H.264 ni
// VP8 — mejor negarse a conectar con un mensaje claro que dejar la
// tele en pantalla negra creyendo que todo va bien.
export function applyCodecPreferences(
	transceiver: RTCRtpTransceiver,
	preference: CodecPreference = DEFAULT_CODEC_PREFERENCE,
): void {
	if (typeof transceiver.setCodecPreferences !== "function") return; // navegador sin esta API: no se puede forzar nada
	const capabilities = RTCRtpSender.getCapabilities("video");
	if (!capabilities) return;

	const allowed = capabilities.codecs.filter((codec) =>
		ALLOWED_MIMES.includes(codec.mimeType.toLowerCase()),
	);
	if (allowed.length === 0) throw new UnsupportedCodecError();

	let ordered: RTCRtpCodec[];
	if (preference === "auto") {
		ordered = allowed; // orden nativo del navegador, ya filtrado a H.264/VP8
	} else {
		const primaryMime = MIME_BY_PREFERENCE[preference];
		const primary = allowed.filter(
			(codec) => codec.mimeType.toLowerCase() === primaryMime,
		);
		const secondary = allowed.filter(
			(codec) => codec.mimeType.toLowerCase() !== primaryMime,
		);
		ordered = [...primary, ...secondary];
	}

	for (const codec of capabilities.codecs) {
		if (AUX_CODECS.includes(codec.mimeType.toLowerCase())) ordered.push(codec);
	}

	transceiver.setCodecPreferences(ordered);
}
