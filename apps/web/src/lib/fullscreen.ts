// Tres escalones, en este orden (encargo M1 parte F) — documentado en
// README.md que funciona en cada plataforma, sin prometer lo que no se
// ha verificado en un dispositivo real:
//
// 1. `requestFullscreen()` en el elemento raiz, donde exista (webOS,
//    Android Chrome, escritorio). Es la via normal.
// 2. `video.webkitEnterFullscreen()` como respaldo en iPhone — Safari
//    de iOS no implementa `requestFullscreen` en NINGUN elemento salvo
//    el propio `<video>`, y solo mientras tiene contenido cargado.
// 3. Un manifest con `display: standalone` (`apps/web/public/
//    manifest.json`, enlazado desde `index.html`) para que "Añadir a
//    pantalla de inicio" abra sin la barra del navegador — no es una
//    llamada de API, es una configuracion estatica que se aplica sola
//    cuando el usuario añade el acceso directo; no hay nada que llamar
//    aqui para ese escalon.
export async function enterFullscreen(
	root: HTMLElement,
	video: (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null,
): Promise<void> {
	if (typeof root.requestFullscreen === "function") {
		try {
			await root.requestFullscreen();
			return;
		} catch {
			// Sigue al siguiente escalon — algunos navegadores exponen la
			// funcion pero la rechazan segun el contexto (p. ej. sin gesto
			// de usuario reciente).
		}
	}
	video?.webkitEnterFullscreen?.();
}
