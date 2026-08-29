// Deteccion de navegador para los avisos de la matriz medida en
// docs/webrtc-quality.md: Chrome codifica H.264 roto en Apple Silicon
// (3 fps, 0.0 Mbps), Brave no llega a codificar nada con ningun codec,
// y Safari captura la pantalla a media resolucion (puntos logicos, no
// pixeles Retina). Ninguno de los tres bloquea — solo avisan.
export function isSafari(): boolean {
	const ua = navigator.userAgent;
	return /safari/i.test(ua) && !/chrome|chromium|crios|android|edg/i.test(ua);
}

export function isChrome(): boolean {
	const ua = navigator.userAgent;
	return /chrome|crios/i.test(ua) && !/edg|opr/i.test(ua);
}

export function isFirefox(): boolean {
	return /firefox|fxios/i.test(navigator.userAgent);
}

// Brave enmascara su user agent como Chrome — la unica forma fiable de
// detectarlo en runtime es su propia API experimental navigator.brave.
export async function isBrave(): Promise<boolean> {
	const nav = navigator as Navigator & {
		brave?: { isBrave: () => Promise<boolean> };
	};
	if (!nav.brave?.isBrave) return false;
	try {
		return await nav.brave.isBrave();
	} catch {
		return false;
	}
}
