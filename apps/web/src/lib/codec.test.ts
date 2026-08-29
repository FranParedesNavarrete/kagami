import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_CODEC_PREFERENCE,
	UnsupportedCodecError,
	applyCodecPreferences,
	loadCodecPreference,
} from "./codec.js";

function fakeCodec(mimeType: string): RTCRtpCodec {
	return { mimeType, clockRate: 90000 } as RTCRtpCodec;
}

// happy-dom no implementa WebRTC: RTCRtpSender no existe como global en
// el entorno de test, hay que ponerlo a mano para cada caso.
function stubCapabilities(codecs: RTCRtpCodec[]): void {
	// biome-ignore lint/suspicious/noExplicitAny: stub de un global que no existe en el entorno de test
	(globalThis as any).RTCRtpSender = {
		getCapabilities: () => ({ codecs }),
	};
}

describe("applyCodecPreferences", () => {
	afterEach(() => {
		// biome-ignore lint/suspicious/noExplicitAny: limpiar el stub del global
		(globalThis as any).RTCRtpSender = undefined;
	});

	it("con preference 'vp8' fuerza VP8 primero aunque el navegador prefiera H.264 de forma nativa", () => {
		stubCapabilities([
			fakeCodec("video/H264"),
			fakeCodec("video/VP8"),
			fakeCodec("video/VP9"),
		]);
		const setCodecPreferences = vi.fn();
		applyCodecPreferences(
			{ setCodecPreferences } as unknown as RTCRtpTransceiver,
			"vp8",
		);
		const ordered = setCodecPreferences.mock.calls[0]?.[0] as RTCRtpCodec[];
		expect(ordered[0]?.mimeType).toBe("video/VP8");
		expect(ordered.some((c) => c.mimeType === "video/VP9")).toBe(false);
	});

	// Documenta a proposito el comportamiento de "auto", no es un test que
	// deba "arreglarse": es la constancia de que auto respeta el orden
	// nativo del navegador dentro de {H.264, VP8} -- exactamente el camino
	// por el que Safari puede acabar negociando H.264 (docs/webrtc-codec.md,
	// "Segundo hallazgo"), donde H.264 decodificado por hardware anula los
	// modos de aspecto en la tele. Si esto cambia alguna vez, debe ser una
	// decision explicita, no una regresion silenciosa.
	it("con preference 'auto' respeta el orden nativo del navegador dentro de H.264/VP8", () => {
		stubCapabilities([fakeCodec("video/H264"), fakeCodec("video/VP8")]);
		const setCodecPreferences = vi.fn();
		applyCodecPreferences(
			{ setCodecPreferences } as unknown as RTCRtpTransceiver,
			"auto",
		);
		const ordered = setCodecPreferences.mock.calls[0]?.[0] as RTCRtpCodec[];
		expect(ordered[0]?.mimeType).toBe("video/H264");
	});

	it("sin H.264 ni VP8 disponibles, lanza UnsupportedCodecError", () => {
		stubCapabilities([fakeCodec("video/VP9"), fakeCodec("video/AV1")]);
		const setCodecPreferences = vi.fn();
		expect(() =>
			applyCodecPreferences(
				{ setCodecPreferences } as unknown as RTCRtpTransceiver,
				"vp8",
			),
		).toThrow(UnsupportedCodecError);
	});
});

describe("codec preference default", () => {
	// El valor por defecto real de la UI es VP8 -- no un accidente de que
	// "vp8" aparezca primero en un objeto o una lista. VP8 se decodifica
	// por software en la LG (no tiene aceleracion de hardware para VP8),
	// asi que respeta el CSS de los modos de aspecto; H.264 no
	// (docs/webrtc-codec.md).
	it("DEFAULT_CODEC_PREFERENCE es vp8", () => {
		expect(DEFAULT_CODEC_PREFERENCE).toBe("vp8");
	});

	it("loadCodecPreference() cae en vp8 sin preferencia guardada", () => {
		expect(loadCodecPreference()).toBe("vp8");
	});
});
