import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoHideController } from "./autoHideControls.js";

describe("AutoHideController", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("hides after the configured timeout with no activity", () => {
		const onVisibilityChange = vi.fn();
		new AutoHideController({ hideAfterMs: 5_000, onVisibilityChange });

		vi.advanceTimersByTime(4_999);
		expect(onVisibilityChange).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onVisibilityChange).toHaveBeenCalledTimes(1);
		expect(onVisibilityChange).toHaveBeenCalledWith(false);
	});

	it("activity (click/mousemove/keydown all call noteActivity) shows it again and resets the countdown", () => {
		const onVisibilityChange = vi.fn();
		const controller = new AutoHideController({
			hideAfterMs: 5_000,
			onVisibilityChange,
		});

		vi.advanceTimersByTime(5_000);
		expect(onVisibilityChange).toHaveBeenLastCalledWith(false);

		controller.noteActivity();
		expect(onVisibilityChange).toHaveBeenLastCalledWith(true);

		// El contador se reinicio: a los 4999ms desde la actividad todavia
		// no se esconde.
		vi.advanceTimersByTime(4_999);
		expect(onVisibilityChange).toHaveBeenLastCalledWith(true);
		vi.advanceTimersByTime(1);
		expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
	});

	it("never hides while focused (keyboard remote), even past the timeout", () => {
		const onVisibilityChange = vi.fn();
		const controller = new AutoHideController({
			hideAfterMs: 5_000,
			onVisibilityChange,
		});

		controller.setFocused(true);
		vi.advanceTimersByTime(60_000);
		expect(onVisibilityChange).not.toHaveBeenCalledWith(false);
	});

	it("resumes the countdown once focus is lost", () => {
		const onVisibilityChange = vi.fn();
		const controller = new AutoHideController({
			hideAfterMs: 5_000,
			onVisibilityChange,
		});

		controller.setFocused(true);
		vi.advanceTimersByTime(60_000);
		controller.setFocused(false);

		vi.advanceTimersByTime(4_999);
		expect(onVisibilityChange).not.toHaveBeenCalledWith(false);
		vi.advanceTimersByTime(1);
		expect(onVisibilityChange).toHaveBeenCalledWith(false);
	});

	it("dispose stops the pending timer from firing", () => {
		const onVisibilityChange = vi.fn();
		const controller = new AutoHideController({
			hideAfterMs: 5_000,
			onVisibilityChange,
		});

		controller.dispose();
		vi.advanceTimersByTime(60_000);
		expect(onVisibilityChange).not.toHaveBeenCalled();
	});
});
