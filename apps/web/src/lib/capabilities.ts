// iOS no expone getDisplayMedia con captura de sistema a ninguna web —
// aunque Safari declare el metodo, solo comparte la propia pestaña.
// SPECS.md §2 pide detectarlo y ser honestos en la UI en vez de dejar
// que el usuario lo intente y falle en silencio.
export function isIOS(): boolean {
	return (
		/iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window)
	);
}

export function canMirror(): boolean {
	return (
		typeof navigator.mediaDevices?.getDisplayMedia === "function" && !isIOS()
	);
}
