import { describe, expect, it } from "vitest";
import { detectVideoPageSite } from "./pageUrl.js";

describe("detectVideoPageSite", () => {
	it.each([
		["https://www.youtube.com/watch?v=abc123", "youtube"],
		["https://youtube.com/watch?v=abc123", "youtube"],
		["https://m.youtube.com/watch?v=abc123", "youtube"],
		["https://youtu.be/abc123", "youtube"],
		["https://vimeo.com/12345", "vimeo"],
		["https://www.vimeo.com/12345", "vimeo"],
		["https://www.twitch.tv/somechannel", "twitch"],
		["https://twitch.tv/somechannel", "twitch"],
	])("detecta %s como %s", (url, site) => {
		expect(detectVideoPageSite(url)).toBe(site);
	});

	it("no marca un fichero de video directo como pagina", () => {
		expect(detectVideoPageSite("https://example.com/video.mp4")).toBeNull();
	});

	it("no marca un dominio parecido pero distinto", () => {
		expect(
			detectVideoPageSite("https://notyoutube.com/watch?v=abc"),
		).toBeNull();
	});

	it("devuelve null ante una URL invalida en vez de reventar", () => {
		expect(detectVideoPageSite("not a url")).toBeNull();
	});
});
