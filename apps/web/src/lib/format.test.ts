import { describe, expect, it } from "vitest";
import { formatBytes, formatEta, formatTime } from "./format.js";

describe("formatTime", () => {
	it("formats seconds as m:ss", () => {
		expect(formatTime(0)).toBe("0:00");
		expect(formatTime(65)).toBe("1:05");
		expect(formatTime(600)).toBe("10:00");
	});

	it("falls back to placeholder for null/non-finite", () => {
		expect(formatTime(null)).toBe("--:--");
		expect(formatTime(Number.NaN)).toBe("--:--");
	});
});

describe("formatBytes", () => {
	it("picks the right unit", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1_500_000)).toBe("1.4 MB");
		expect(formatBytes(2_000_000_000)).toBe("1.9 GB");
	});
});

describe("formatEta", () => {
	it("estimates from real throughput, not just percent", () => {
		expect(formatEta(1_000_000, 100_000)).toBe("10s");
		expect(formatEta(60_000_000, 1_000_000)).toBe("1 min");
	});

	it("returns a placeholder when speed is unknown or zero", () => {
		expect(formatEta(1_000, 0)).toBe("--");
		expect(formatEta(1_000, Number.NaN)).toBe("--");
	});
});
