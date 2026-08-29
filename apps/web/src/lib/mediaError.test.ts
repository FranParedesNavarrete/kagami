import { describe, expect, it } from "vitest";
import { mediaErrorKind } from "./mediaError.js";

describe("mediaErrorKind", () => {
	it("returns null without an error", () => {
		expect(mediaErrorKind(null)).toBeNull();
	});

	it("maps each spec-defined MediaError code", () => {
		expect(mediaErrorKind({ code: 1 })).toBe("aborted");
		expect(mediaErrorKind({ code: 2 })).toBe("network");
		expect(mediaErrorKind({ code: 3 })).toBe("decode");
		expect(mediaErrorKind({ code: 4 })).toBe("unsupported");
	});

	it("falls back to unknown for an unrecognized code", () => {
		expect(mediaErrorKind({ code: 99 })).toBe("unknown");
	});
});
