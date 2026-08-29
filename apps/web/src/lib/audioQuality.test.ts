import { describe, expect, it } from "vitest";
import { withStereoOpus } from "./audioQuality.js";

const SAMPLE_SDP = [
	"v=0",
	"o=- 123456 2 IN IP4 127.0.0.1",
	"s=-",
	"t=0 0",
	"m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
	"c=IN IP4 0.0.0.0",
	"a=rtpmap:111 opus/48000/2",
	"a=fmtp:111 minptime=10;useinbandfec=1",
	"a=rtpmap:63 red/48000/2",
	"m=video 9 UDP/TLS/RTP/SAVPF 96",
	"a=rtpmap:96 VP8/90000",
].join("\r\n");

describe("withStereoOpus", () => {
	it("añade stereo, sprop-stereo y maxaveragebitrate a la línea fmtp de Opus", () => {
		const result = withStereoOpus(SAMPLE_SDP);
		const fmtpLine = result
			.split("\r\n")
			.find((line) => line.startsWith("a=fmtp:111 "));
		expect(fmtpLine).toBeDefined();
		expect(fmtpLine).toContain("stereo=1");
		expect(fmtpLine).toContain("sprop-stereo=1");
		expect(fmtpLine).toContain("maxaveragebitrate=128000");
	});

	it("conserva los parámetros existentes en vez de machacarlos", () => {
		const result = withStereoOpus(SAMPLE_SDP);
		const fmtpLine = result
			.split("\r\n")
			.find((line) => line.startsWith("a=fmtp:111 "));
		expect(fmtpLine).toContain("minptime=10");
		expect(fmtpLine).toContain("useinbandfec=1");
	});

	it("no toca ninguna otra línea del SDP", () => {
		const result = withStereoOpus(SAMPLE_SDP);
		for (const line of SAMPLE_SDP.split("\r\n")) {
			if (line.startsWith("a=fmtp:111 ")) continue;
			expect(result).toContain(line);
		}
	});

	it("inserta una línea fmtp si Opus no tenía ninguna", () => {
		const sdpWithoutFmtp = [
			"m=audio 9 UDP/TLS/RTP/SAVPF 111",
			"a=rtpmap:111 opus/48000/2",
		].join("\r\n");
		const result = withStereoOpus(sdpWithoutFmtp);
		const fmtpLine = result
			.split("\r\n")
			.find((line) => line.startsWith("a=fmtp:111 "));
		expect(fmtpLine).toContain("stereo=1");
		expect(fmtpLine).toContain("sprop-stereo=1");
		expect(fmtpLine).toContain("maxaveragebitrate=128000");
	});

	it("devuelve el SDP sin tocar si no hay Opus", () => {
		const sdpWithoutOpus = [
			"m=audio 9 UDP/TLS/RTP/SAVPF 0",
			"a=rtpmap:0 PCMU/8000",
		].join("\r\n");
		expect(withStereoOpus(sdpWithoutOpus)).toBe(sdpWithoutOpus);
	});
});
