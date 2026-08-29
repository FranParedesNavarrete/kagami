import { describe, expect, it } from "vitest";
import { classifyCaptureLabel } from "./captureLabel.js";

describe("classifyCaptureLabel", () => {
	it("recognizes Chrome's known prefixes", () => {
		expect(classifyCaptureLabel("screen:0:0")).toBe("full-screen");
		expect(classifyCaptureLabel("window:12345:0")).toBe("window");
		expect(classifyCaptureLabel("tab:0")).toBe("tab");
		expect(classifyCaptureLabel("web-contents-media-stream://1:2")).toBe("tab");
	});

	it("returns null for anything else, rather than guessing", () => {
		expect(classifyCaptureLabel("")).toBe(null);
		expect(classifyCaptureLabel("My Window Title")).toBe(null);
		expect(classifyCaptureLabel("Safari Screen Capture")).toBe(null);
	});
});
