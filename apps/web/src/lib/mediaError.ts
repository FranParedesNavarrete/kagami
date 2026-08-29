// El cast nunca debe dejar una pantalla negra sin explicar por que
// (encargo M1, parte 2). El codigo de MediaError es lo unico fiable que
// da el navegador; se traduce a una clave corta que cada lado (tele y
// emisor) resuelve con su propio idioma via i18n en vez de mandar una
// frase ya hecha por WS.
export type MediaErrorKind =
	| "aborted"
	| "network"
	| "decode"
	| "unsupported"
	| "unknown";

// Valores numericos fijados por la spec (HTMLMediaElement.error.code), no
// por `MediaError.MEDIA_ERR_*` — esa clase no existe como global en todos
// los entornos de test (p. ej. happy-dom), y el numero nunca cambia.
export function mediaErrorKind(
	error: { code: number } | null,
): MediaErrorKind | null {
	if (!error) return null;
	switch (error.code) {
		case 1:
			return "aborted";
		case 2:
			return "network";
		case 3:
			return "decode";
		case 4:
			return "unsupported";
		default:
			return "unknown";
	}
}
