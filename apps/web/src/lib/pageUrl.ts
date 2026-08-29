// Encargo M1, parte F: pegar un enlace de YouTube/Vimeo/Twitch en el campo
// de cast produce, sin esto, el mensaje "formato no soportado" — correcto
// pero incomprensible, porque el problema real es que esa URL sirve una
// pagina HTML, no un fichero de video, y ningun navegador va a decodificar
// eso como <video src>. Deteccion por dominio conocido, no por contenido —
// no hay ningun fetch aqui, solo mirar el host antes de intentar el cast.
export type KnownVideoPageSite = "youtube" | "vimeo" | "twitch";

const HOST_TO_SITE: Record<string, KnownVideoPageSite> = {
	"youtube.com": "youtube",
	"www.youtube.com": "youtube",
	"m.youtube.com": "youtube",
	"youtu.be": "youtube",
	"vimeo.com": "vimeo",
	"www.vimeo.com": "vimeo",
	"twitch.tv": "twitch",
	"www.twitch.tv": "twitch",
	"m.twitch.tv": "twitch",
};

export const VIDEO_PAGE_SITE_NAMES: Record<KnownVideoPageSite, string> = {
	youtube: "YouTube",
	vimeo: "Vimeo",
	twitch: "Twitch",
};

export function detectVideoPageSite(url: string): KnownVideoPageSite | null {
	try {
		return HOST_TO_SITE[new URL(url).hostname.toLowerCase()] ?? null;
	} catch {
		return null;
	}
}
