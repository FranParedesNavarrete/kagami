// El "label" de un MediaStreamTrack de getDisplayMedia no esta
// estandarizado, pero Chrome (el navegador medido, docs/webrtc-quality.md)
// usa consistentemente el prefijo "screen:"/"window:"/"tab:" — encargo
// de rediseño, parte 7: "Pantalla completa · sin audio", nunca
// "screen:1:0". Si el prefijo no se reconoce (otro navegador, u otra
// version), null: mejor mostrar el label tal cual (lo que ya se hacia)
// que inventar una clasificacion sin base.
export type CaptureKind = "full-screen" | "window" | "tab";

export function classifyCaptureLabel(rawLabel: string): CaptureKind | null {
	if (/^screen:/i.test(rawLabel)) return "full-screen";
	if (/^window:/i.test(rawLabel)) return "window";
	if (/^(tab|web-contents-media-stream):/i.test(rawLabel)) return "tab";
	return null;
}
