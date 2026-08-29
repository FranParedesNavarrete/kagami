// Nunca confiar en la extension que manda el cliente ni en el
// Content-Type declarado — los primeros bytes del fichero dicen la
// verdad. Cubre exactamente los formatos que SPECS.md permite castear:
// video (mp4/mov, webm) e imagen (jpeg, png, gif, webp).
export type SniffedKind = "video" | "image";

export interface SniffedType {
	kind: SniffedKind;
	ext: string;
}

// mp4/mov: caja "ftyp" empezando en el byte 4 (el tamaño de caja ocupa
// los primeros 4 bytes, big-endian, y no nos hace falta para esto).
function isIsoBmff(buf: Buffer): boolean {
	return buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp";
}

function isWebm(buf: Buffer): boolean {
	return (
		buf.length >= 4 &&
		buf[0] === 0x1a &&
		buf[1] === 0x45 &&
		buf[2] === 0xdf &&
		buf[3] === 0xa3
	);
}

function isJpeg(buf: Buffer): boolean {
	return (
		buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
	);
}

function isPng(buf: Buffer): boolean {
	return (
		buf.length >= 8 &&
		buf[0] === 0x89 &&
		buf[1] === 0x50 &&
		buf[2] === 0x4e &&
		buf[3] === 0x47
	);
}

function isGif(buf: Buffer): boolean {
	if (buf.length < 6) return false;
	const header = buf.toString("ascii", 0, 6);
	return header === "GIF87a" || header === "GIF89a";
}

function isWebp(buf: Buffer): boolean {
	return (
		buf.length >= 12 &&
		buf.toString("ascii", 0, 4) === "RIFF" &&
		buf.toString("ascii", 8, 12) === "WEBP"
	);
}

const EXTENSION_KIND: Record<string, SniffedKind> = {
	mp4: "video",
	webm: "video",
	mov: "video",
	m4v: "video",
	jpg: "image",
	jpeg: "image",
	png: "image",
	gif: "image",
	webp: "image",
};

export const ALLOWED_CAST_EXTENSIONS = new Set(Object.keys(EXTENSION_KIND));

// mp4 y mov comparten la misma cabecera ISO-BMFF ("ftyp") — no se puede
// distinguir uno de otro solo por los bytes, asi que la validacion por
// contenido compara el TIPO (video/imagen), no la extension exacta que
// mando el cliente. Devuelve null si la extension no esta permitida en
// absoluto.
export function kindForExtension(ext: string): SniffedKind | null {
	return EXTENSION_KIND[ext.toLowerCase()] ?? null;
}

// Comprueba solo la CABECERA del fichero (los primeros ~32 bytes ya
// recibidos en streaming) — nunca hace falta leer el fichero entero
// para esto, coherente con "streaming al disco, nunca en memoria".
export function sniffMediaType(header: Buffer): SniffedType | null {
	if (isIsoBmff(header)) return { kind: "video", ext: "mp4" };
	if (isWebm(header)) return { kind: "video", ext: "webm" };
	if (isJpeg(header)) return { kind: "image", ext: "jpg" };
	if (isPng(header)) return { kind: "image", ext: "png" };
	if (isGif(header)) return { kind: "image", ext: "gif" };
	if (isWebp(header)) return { kind: "image", ext: "webp" };
	return null;
}
