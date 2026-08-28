// Fuerza el conjunto y el orden de codecs de video ofrecidos: H.264
// primero, VP8 de respaldo, y todo lo demas (VP9, AV1...) EXCLUIDO del
// todo, no solo reordenado detras. La tele del spike M-1 solo decodifica
// H.264/VP8; si el emisor negocia VP9/AV1 (lo que Chrome/Brave prefieren
// por defecto para compartir pantalla), la tele se queda en negro total
// sin ningun aviso — visto de verdad en produccion. Ver
// docs/webrtc-codec.md y SPECS.md §4.2, que ya pedia esto y nunca se
// implemento.
const ALLOWED_CODECS = ["video/h264", "video/vp8"];
const AUX_CODECS = [
	"video/rtx",
	"video/red",
	"video/ulpfec",
	"video/flexfec-03",
];

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
export function applyCodecPreferences(transceiver: RTCRtpTransceiver): void {
	if (typeof transceiver.setCodecPreferences !== "function") return; // navegador sin esta API: no se puede forzar nada
	const capabilities = RTCRtpSender.getCapabilities("video");
	if (!capabilities) return;

	const ordered: RTCRtpCodec[] = [];
	for (const mime of ALLOWED_CODECS) {
		for (const codec of capabilities.codecs) {
			if (codec.mimeType.toLowerCase() === mime) ordered.push(codec);
		}
	}
	if (ordered.length === 0) throw new UnsupportedCodecError();

	for (const codec of capabilities.codecs) {
		if (AUX_CODECS.includes(codec.mimeType.toLowerCase())) ordered.push(codec);
	}

	transceiver.setCodecPreferences(ordered);
}
