import { afterEach, describe, expect, it, vi } from "vitest";
import { canMirror, isIOS } from "./capabilities.js";

function setUserAgent(ua: string) {
	vi.stubGlobal("navigator", {
		...navigator,
		userAgent: ua,
		mediaDevices: navigator.mediaDevices,
	});
}

describe("isIOS", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("detects an iPhone user agent", () => {
		setUserAgent(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
		);
		expect(isIOS()).toBe(true);
	});

	it("does not flag a desktop Mac user agent", () => {
		setUserAgent(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
		);
		expect(isIOS()).toBe(false);
	});
});

describe("canMirror", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("is false on iOS even if getDisplayMedia exists", () => {
		vi.stubGlobal("navigator", {
			...navigator,
			userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
			mediaDevices: { getDisplayMedia: () => Promise.resolve() },
		});
		expect(canMirror()).toBe(false);
	});

	it("is true on desktop when getDisplayMedia exists", () => {
		vi.stubGlobal("navigator", {
			...navigator,
			userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
			mediaDevices: { getDisplayMedia: () => Promise.resolve() },
		});
		expect(canMirror()).toBe(true);
	});
});
