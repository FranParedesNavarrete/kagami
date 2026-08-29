import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Fixture diminuta (41KB, 3s, testsrc2+tono) committeada a proposito para
// que `pnpm run e2e` funcione de cero sin depender de ffmpeg en la
// maquina que lo ejecute — ver apps/server/scripts/gen-diag-videos.sh
// para el fixture (con ffmpeg) que SI hace falta para docs/spike-range.md.
const FIXTURE = readFileSync(
	fileURLToPath(new URL("./fixtures/cast-test.mp4", import.meta.url)),
);
// Dominio inexistente a proposito: Playwright intercepta la peticion del
// <video> de la tele antes de que salga a red real (page.route), asi que
// nunca hace falta resolverlo. Esto prueba el protocolo (WS + <video>
// nativo), no si el server real sirve range requests contra la tele real
// — eso es exactamente lo que docs/spike-range.md cubre aparte.
const CAST_URL = "http://cast-fixture.invalid/video.mp4";

// Un mock que solo devuelve 200 con el cuerpo entero (sin Accept-Ranges ni
// 206) hizo que Chromium marcara el video como "buffered" pero NO
// "seekable" (`video.seekable` vacio pese a tener todo el fichero en
// buffer) — un salto real necesita que el mock se comporte como un
// servidor de verdad, no solo entregar los bytes.
function fulfillWithRangeSupport(route: Route): Promise<void> {
	const range = route.request().headers().range;
	if (!range) {
		return route.fulfill({
			status: 200,
			contentType: "video/mp4",
			headers: {
				"accept-ranges": "bytes",
				"content-length": String(FIXTURE.length),
			},
			body: FIXTURE,
		});
	}
	const match = /bytes=(\d*)-(\d*)/.exec(range);
	const start = match?.[1] ? Number(match[1]) : 0;
	const end = match?.[2] ? Number(match[2]) : FIXTURE.length - 1;
	return route.fulfill({
		status: 206,
		contentType: "video/mp4",
		headers: {
			"accept-ranges": "bytes",
			"content-range": `bytes ${start}-${end}/${FIXTURE.length}`,
			"content-length": String(end - start + 1),
		},
		body: FIXTURE.subarray(start, end + 1),
	});
}

// Locator.fill() en un <input type="range"> lo trata como texto y acaba
// escribiendo un valor equivocado dígito a dígito. El truco real: llamar
// al setter nativo de HTMLInputElement (no el que React sobreescribe en
// la instancia) y disparar un "input" de verdad — es como React se entera
// del cambio en un input controlado.
function setRangeValue(
	page: Page,
	testId: string,
	value: number,
): Promise<void> {
	return page.locator(`[data-testid="${testId}"]`).evaluate((el, v) => {
		const input = el as HTMLInputElement;
		const setter = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set;
		setter?.call(input, String(v));
		input.dispatchEvent(new Event("input", { bubbles: true }));
	}, value);
}

test("cast a URL: paste, play, pause, seek — reflected on both sides", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.route(CAST_URL, fulfillWithRangeSupport);

	await screen.goto("/");
	await screen.getByText("Be the screen").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast a URL").click();
	await sender.getByTestId("cast-url-input").fill(CAST_URL);
	await sender.getByTestId("cast-url-submit").click();

	// La tele reproduce el video real (sin WebRTC de por medio: es la
	// diferencia entera del cast frente al espejo, SPECS.md §2).
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

	// El estado real de reproduccion vuelve al emisor por cast-status.
	await expect(sender.getByTestId("cast-play-pause")).toContainText("Pause", {
		timeout: 10_000,
	});

	await sender.getByTestId("cast-play-pause").click();
	await expect
		.poll(async () =>
			screen.evaluate(
				() => document.querySelector(`[data-testid="cast-video"]`)?.paused,
			),
		)
		.toBe(true);
	await expect(sender.getByTestId("cast-play-pause")).toContainText("Play");

	// Saltar a mitad (fixture de 3s): el control remoto del emisor mueve
	// currentTime de verdad en la tele, no solo en la UI del emisor.
	await setRangeValue(sender, "cast-seek", 1.7);
	await expect
		.poll(async () =>
			screen.evaluate(
				() =>
					document.querySelector(`[data-testid="cast-video"]`)?.currentTime ??
					0,
			),
		)
		.toBeGreaterThan(1.5);

	await sender.getByTestId("cast-play-pause").click();
	await expect
		.poll(async () =>
			screen.evaluate(
				() => document.querySelector(`[data-testid="cast-video"]`)?.paused,
			),
		)
		.toBe(false);

	await screenCtx.close();
	await senderCtx.close();
});

test("sender disconnecting (locking the phone) does not stop playback on the TV", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.route(CAST_URL, fulfillWithRangeSupport);

	await screen.goto("/");
	await screen.getByText("Be the screen").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast a URL").click();
	await sender.getByTestId("cast-url-input").fill(CAST_URL);
	await sender.getByTestId("cast-url-submit").click();

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

	// Esto es la ventaja entera del cast frente al espejo (SPECS.md §2):
	// el emisor puede bloquear el telefono (aqui, cerrar su contexto del
	// todo, el caso mas extremo posible) y la tele no debe detenerse —
	// el video vive solo en su propio <video>, no depende del emisor.
	await senderCtx.close();
	await screen.waitForTimeout(1500);

	const stillPlaying = await screen.evaluate(() => {
		const v = document.querySelector(
			'[data-testid="cast-video"]',
		) as HTMLVideoElement | null;
		return { exists: !!v, paused: v?.paused, currentTime: v?.currentTime ?? 0 };
	});
	expect(stillPlaying.exists).toBe(true);
	expect(stillPlaying.paused).toBe(false);
	expect(stillPlaying.currentTime).toBeGreaterThan(0);

	await screenCtx.close();
});

test("rejects a non-http(s) cast URL with a clear message, client-side", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.goto("/");
	await screen.getByText("Be the screen").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast a URL").click();

	for (const badUrl of [
		"javascript:alert(1)",
		"ftp://example.com/video.mp4",
		"not a url",
	]) {
		await sender.getByTestId("cast-url-input").fill(badUrl);
		await sender.getByTestId("cast-url-submit").click();
		await expect(
			sender.getByText(/Only http:\/\/ and https:\/\/ links are supported/i),
		).toBeVisible();
	}

	// El formulario nunca llego a mandar cast-url: la pantalla se quedo
	// esperando (peer-connecting), nunca paso a reproducir nada.
	await expect(screen.getByText("Connecting to sender…")).toBeVisible();
	await expect(screen.getByTestId("cast-video")).toHaveCount(0);

	await screenCtx.close();
	await senderCtx.close();
});

test("an unreachable/unsupported cast URL shows a playback error on both sides", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	const BROKEN_URL = "http://cast-fixture.invalid/broken.mp4";
	await screen.route(BROKEN_URL, (route) =>
		route.fulfill({ status: 404, body: "not found" }),
	);

	await screen.goto("/");
	await screen.getByText("Be the screen").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast a URL").click();
	await sender.getByTestId("cast-url-input").fill(BROKEN_URL);
	await sender.getByTestId("cast-url-submit").click();

	// Nunca una pantalla negra sin explicar por que (encargo M1, parte 2).
	await expect(screen.getByText(/Playback error:/i)).toBeVisible({
		timeout: 10_000,
	});
	await expect(sender.getByText(/Playback error:/i)).toBeVisible({
		timeout: 10_000,
	});

	await screenCtx.close();
	await senderCtx.close();
});
