// Lista unica de contenedores que el cast de fichero admite — compartida
// entre `apps/server` (validacion por contenido, la que de verdad decide)
// y `apps/web` (filtro del selector + rechazo inmediato al elegir el
// fichero, antes de subir un solo byte). Un solo sitio que editar si algun
// dia se anade o se quita un formato, en vez de dos listas que se puedan
// desincronizar. Ver README.md: esta lista sale de lo que la LG real
// reproduce, no de lo que cada especificacion de contenedor promete.
export type CastFileKind = "video" | "image";

interface CastFormatEntry {
	readonly ext: string;
	readonly kind: CastFileKind;
	readonly mime: string;
}

const CAST_FORMATS: readonly CastFormatEntry[] = [
	{ ext: "mp4", kind: "video", mime: "video/mp4" },
	{ ext: "m4v", kind: "video", mime: "video/x-m4v" },
	{ ext: "mov", kind: "video", mime: "video/quicktime" },
	{ ext: "webm", kind: "video", mime: "video/webm" },
	{ ext: "jpg", kind: "image", mime: "image/jpeg" },
	{ ext: "jpeg", kind: "image", mime: "image/jpeg" },
	{ ext: "png", kind: "image", mime: "image/png" },
	{ ext: "gif", kind: "image", mime: "image/gif" },
	{ ext: "webp", kind: "image", mime: "image/webp" },
];

export const CAST_EXTENSION_KIND: Readonly<Record<string, CastFileKind>> =
	Object.fromEntries(CAST_FORMATS.map((f) => [f.ext, f.kind]));

export const ALLOWED_CAST_EXTENSIONS = new Set(
	Object.keys(CAST_EXTENSION_KIND),
);

// Para el atributo `accept` del `<input type="file">` — comodidad para que
// el selector del sistema ya filtre, nunca la comprobacion real (esa sigue
// siendo el sniffing de contenido en el server).
export const CAST_FILE_ACCEPT = [
	...new Set(CAST_FORMATS.map((f) => f.mime)),
].join(",");

// Extensiones en mayusculas para mostrar en un mensaje de error legible
// ("kagami admite: MP4, MOV, WEBM, ...") sin repetir la lista a mano.
export const CAST_ALLOWED_EXTENSIONS_DISPLAY = [...ALLOWED_CAST_EXTENSIONS]
	.map((ext) => ext.toUpperCase())
	.join(", ");

export function castKindForExtension(ext: string): CastFileKind | null {
	return CAST_EXTENSION_KIND[ext.toLowerCase()] ?? null;
}

// Nunca confiar en el MIME declarado, solo en el nombre — el propio
// fichero puede no traer extension en absoluto (cadena vacia en ese caso).
export function extensionFromFilename(filename: string): string {
	const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
	return match?.[1]?.toLowerCase() ?? "";
}
