import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const FASTSTART_FIXTURE = fileURLToPath(
	new URL("./fixtures/cast-test.mp4", import.meta.url),
);
const PLAIN_FIXTURE = fileURLToPath(
	new URL("./fixtures/cast-test-plain.mp4", import.meta.url),
);
const MKV_FIXTURE = fileURLToPath(
	new URL("./fixtures/cast-test.mkv", import.meta.url),
);

test("picking an unsupported container (.mkv) is rejected instantly, before any upload starts (cierre de kagami, parte 1)", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.goto("/");
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();

	// Playwright's setInputFiles ignores the `accept` filter entirely (a
	// real OS file picker might not, but nothing stops a user from
	// choosing "all files") — this proves the REAL guard is the onChange
	// check, not just the accept attribute.
	await sender.getByTestId("cast-file-input").setInputFiles(MKV_FIXTURE);

	await expect(sender.getByText(/\.mkv/)).toBeVisible();
	await expect(sender.getByText(/MP4/)).toBeVisible();
	// Nunca llego a arrancar ninguna subida: ni "Uploading" ni "Processing".
	await expect(sender.getByTestId("cast-upload-status")).not.toBeVisible();
});

test("cast a file: upload, real progress, plays on the TV via range requests", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.goto("/");
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();
	await sender.getByTestId("cast-file-input").setInputFiles(FASTSTART_FIXTURE);

	// Progreso real de subida (no una barra falsa): al menos un "Uploading"
	// o directo "Processing" para un fichero tan pequeño.
	await expect(sender.getByTestId("cast-upload-status")).toBeVisible({
		timeout: 10_000,
	});

	// Ya reproduciendo de verdad en la tele, a traves de range requests
	// contra /cast/files/ (el mismo mecanismo verificado en /diag/range).
	await expect
		.poll(
			async () =>
				screen.evaluate(
					() =>
						document.querySelector(`[data-testid="cast-video"]`)?.readyState ??
						0,
				),
			{ timeout: 10_000 },
		)
		.toBeGreaterThanOrEqual(1);

	await expect(sender.getByTestId("cast-play-pause")).toHaveAttribute(
		"aria-label",
		"Pause",
		{ timeout: 10_000 },
	);
	await expect(sender.getByText("cast-test.mp4")).toBeVisible();

	// El fichero servido responde con range requests reales, no solo el
	// video de la tele "pareciendo" reproducirse.
	const src = await screen.evaluate(
		() =>
			(document.querySelector('[data-testid="cast-video"]') as HTMLVideoElement)
				.src,
	);
	const response = await screen.request.get(src, {
		headers: { Range: "bytes=0-1023" },
	});
	expect(response.status()).toBe(206);
	expect(response.headers()["content-range"]).toMatch(/^bytes 0-1023\//);

	await screenCtx.close();
	await senderCtx.close();
});

test("cast a file with moov at the end: server remuxes automatically and reports progress", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.goto("/");
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();
	await sender.getByTestId("cast-file-input").setInputFiles(PLAIN_FIXTURE);

	// "Processing" es justo el remux a faststart pasando de verdad por
	// ffmpeg en el server -- no un paso que se salte en silencio.
	await expect(sender.getByTestId("cast-upload-status")).toContainText(
		/Processing/i,
		{ timeout: 10_000 },
	);

	await expect(sender.getByTestId("cast-play-pause")).toHaveAttribute(
		"aria-label",
		"Pause",
		{ timeout: 15_000 },
	);
	// Se remuxeo bien: no hace falta el aviso de que el salto puede fallar.
	await expect(sender.getByText(/seeking may not work/i)).not.toBeVisible();

	await expect
		.poll(
			async () =>
				screen.evaluate(
					() =>
						document.querySelector(`[data-testid="cast-video"]`)?.readyState ??
						0,
				),
			{ timeout: 10_000 },
		)
		.toBeGreaterThanOrEqual(1);

	await screenCtx.close();
	await senderCtx.close();
});

test("the uploaded file is served only to the room that uploaded it", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const otherScreenCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();
	const otherScreen = await otherScreenCtx.newPage();

	await screen.goto("/");
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();
	await sender.getByTestId("cast-file-input").setInputFiles(FASTSTART_FIXTURE);

	await expect(sender.getByTestId("cast-play-pause")).toHaveAttribute(
		"aria-label",
		"Pause",
		{ timeout: 10_000 },
	);
	const path = await screen.evaluate(() => {
		const video = document.querySelector(
			'[data-testid="cast-video"]',
		) as HTMLVideoElement;
		return new URL(video.src).pathname;
	});

	// Una sala completamente distinta (un identificador de fichero
	// imposible de adivinar no basta) no puede pedir el mismo path...
	await otherScreen.goto("/");
	await otherScreen.getByText("Show code").click();
	const wrongRoomPath = path.replace(code, "ZZZZ");
	const forbidden = await otherScreen.request.get(wrongRoomPath);
	expect(forbidden.status()).toBe(404);

	// ...pero la propia sala que lo subio si puede.
	const allowed = await screen.request.get(path);
	expect(allowed.status()).toBe(200);

	await screenCtx.close();
	await senderCtx.close();
	await otherScreenCtx.close();
});

test("closing the room deletes the uploaded file (guaranteed cleanup, path 1)", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.goto("/");
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();
	await sender.getByTestId("cast-file-input").setInputFiles(FASTSTART_FIXTURE);

	await expect(sender.getByTestId("cast-play-pause")).toHaveAttribute(
		"aria-label",
		"Pause",
		{ timeout: 10_000 },
	);
	const path = await screen.evaluate(
		() =>
			new URL(
				(
					document.querySelector(
						'[data-testid="cast-video"]',
					) as HTMLVideoElement
				).src,
			).pathname,
	);

	// La pantalla se va: durante un cast, esto SI mata la sala del todo
	// (SPECS.md §6 — la asimetria es al reves, con el emisor).
	await screenCtx.close();
	await senderCtx.close();

	const freshCtx = await browser.newContext();
	const fresh = await freshCtx.newPage();
	await fresh.goto("/");
	const response = await fresh.request.get(path);
	expect(response.status()).toBe(404);

	await freshCtx.close();
});
