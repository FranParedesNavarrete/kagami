import { describe, expect, it } from "vitest";
import {
	ALLOWED_CAST_EXTENSIONS,
	kindForExtension,
	sniffMediaType,
} from "./fileSniff.js";

function bytes(...values: number[]): Buffer {
	return Buffer.from(values);
}

describe("sniffMediaType", () => {
	it("reconoce mp4/mov por la caja ftyp", () => {
		const header = Buffer.concat([
			bytes(0x00, 0x00, 0x00, 0x18), // tamaño de caja, irrelevante aqui
			Buffer.from("ftypisom"),
			bytes(0, 0, 0, 0),
		]);
		expect(sniffMediaType(header)).toEqual({ kind: "video", ext: "mp4" });
	});

	it("reconoce webm por la cabecera EBML", () => {
		const header = bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0);
		expect(sniffMediaType(header)).toEqual({ kind: "video", ext: "webm" });
	});

	it("reconoce jpeg, png, gif y webp", () => {
		expect(sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({
			kind: "image",
			ext: "jpg",
		});
		expect(sniffMediaType(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0))).toEqual({
			kind: "image",
			ext: "png",
		});
		expect(sniffMediaType(Buffer.from("GIF89a"))).toEqual({
			kind: "image",
			ext: "gif",
		});
		const webp = Buffer.concat([
			Buffer.from("RIFF"),
			bytes(0, 0, 0, 0),
			Buffer.from("WEBP"),
		]);
		expect(sniffMediaType(webp)).toEqual({ kind: "image", ext: "webp" });
	});

	it("rechaza contenido que no es ninguno de los formatos permitidos", () => {
		expect(sniffMediaType(Buffer.from("no soy un video ni una imagen"))).toBe(
			null,
		);
		// Un ejecutable disfrazado de "video.mp4" por el nombre: la cabecera
		// real es lo que manda, no la extension del cliente.
		expect(sniffMediaType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(null);
	});

	it("no revienta con una cabecera mas corta que la firma buscada", () => {
		expect(sniffMediaType(bytes(0xff))).toBe(null);
		expect(sniffMediaType(Buffer.alloc(0))).toBe(null);
	});
});

describe("kindForExtension", () => {
	it("mp4 y mov son video aunque compartan cabecera — se distinguen por extension, no por contenido", () => {
		expect(kindForExtension("mp4")).toBe("video");
		expect(kindForExtension("mov")).toBe("video");
		expect(kindForExtension("MP4")).toBe("video");
	});

	it("las extensiones de imagen dan 'image'", () => {
		expect(kindForExtension("jpg")).toBe("image");
		expect(kindForExtension("png")).toBe("image");
	});

	it("una extension no permitida da null", () => {
		expect(kindForExtension("exe")).toBe(null);
		expect(kindForExtension("html")).toBe(null);
	});

	it("ALLOWED_CAST_EXTENSIONS solo contiene video e imagen", () => {
		expect(ALLOWED_CAST_EXTENSIONS.has("mp4")).toBe(true);
		expect(ALLOWED_CAST_EXTENSIONS.has("exe")).toBe(false);
	});
});
