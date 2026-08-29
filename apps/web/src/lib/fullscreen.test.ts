import { describe, expect, it, vi } from "vitest";
import { enterFullscreen } from "./fullscreen.js";

describe("enterFullscreen", () => {
	it("usa requestFullscreen cuando existe y funciona", async () => {
		const requestFullscreen = vi.fn().mockResolvedValue(undefined);
		const root = { requestFullscreen } as unknown as HTMLElement;
		const video = {
			webkitEnterFullscreen: vi.fn(),
		} as unknown as HTMLVideoElement & { webkitEnterFullscreen: () => void };

		await enterFullscreen(root, video);

		expect(requestFullscreen).toHaveBeenCalledTimes(1);
		expect(video.webkitEnterFullscreen).not.toHaveBeenCalled();
	});

	it("cae a webkitEnterFullscreen del video si requestFullscreen no existe (iPhone)", async () => {
		const root = {} as HTMLElement; // sin requestFullscreen, como iOS Safari
		const webkitEnterFullscreen = vi.fn();
		const video = { webkitEnterFullscreen } as unknown as HTMLVideoElement & {
			webkitEnterFullscreen: () => void;
		};

		await enterFullscreen(root, video);

		expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
	});

	it("cae a webkitEnterFullscreen si requestFullscreen existe pero rechaza", async () => {
		const requestFullscreen = vi.fn().mockRejectedValue(new Error("nope"));
		const root = { requestFullscreen } as unknown as HTMLElement;
		const webkitEnterFullscreen = vi.fn();
		const video = { webkitEnterFullscreen } as unknown as HTMLVideoElement & {
			webkitEnterFullscreen: () => void;
		};

		await enterFullscreen(root, video);

		expect(webkitEnterFullscreen).toHaveBeenCalledTimes(1);
	});

	it("no revienta sin ningun video (p. ej. en la pantalla de codigo)", async () => {
		const root = {} as HTMLElement;
		await expect(enterFullscreen(root, null)).resolves.toBeUndefined();
	});
});
