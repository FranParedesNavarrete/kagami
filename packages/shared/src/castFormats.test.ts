import { describe, expect, it } from "vitest";
import {
	ALLOWED_CAST_EXTENSIONS,
	CAST_FILE_ACCEPT,
	castKindForExtension,
	extensionFromFilename,
} from "./castFormats.js";

describe("castKindForExtension", () => {
	it("classifies known video and image extensions", () => {
		expect(castKindForExtension("mp4")).toBe("video");
		expect(castKindForExtension("MOV")).toBe("video");
		expect(castKindForExtension("webm")).toBe("video");
		expect(castKindForExtension("jpg")).toBe("image");
		expect(castKindForExtension("webp")).toBe("image");
	});

	it("rejects containers this TV isn't verified to play, like mkv", () => {
		expect(castKindForExtension("mkv")).toBe(null);
		expect(castKindForExtension("avi")).toBe(null);
	});
});

describe("extensionFromFilename", () => {
	it("extracts the extension in lowercase", () => {
		expect(extensionFromFilename("Movie.MP4")).toBe("mp4");
		expect(extensionFromFilename("clip.mkv")).toBe("mkv");
	});

	it("returns an empty string when there is no extension", () => {
		expect(extensionFromFilename("noextension")).toBe("");
	});
});

describe("ALLOWED_CAST_EXTENSIONS / CAST_FILE_ACCEPT", () => {
	it("does not include mkv", () => {
		expect(ALLOWED_CAST_EXTENSIONS.has("mkv")).toBe(false);
	});

	it("the accept string only lists mime types for allowed extensions", () => {
		expect(CAST_FILE_ACCEPT).toContain("video/mp4");
		expect(CAST_FILE_ACCEPT).toContain("image/webp");
		expect(CAST_FILE_ACCEPT).not.toContain("matroska");
	});
});
