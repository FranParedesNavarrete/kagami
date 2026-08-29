import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { CAST_URL, fulfillWithRangeSupport } from "./castFixture.js";

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
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();
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

	// El estado real de reproduccion vuelve al emisor por cast-status. El
	// boton de play/pausa es ahora solo icono (encargo de rediseño, parte
	// 12) — el estado se comprueba por aria-label, no por texto visible.
	await expect(sender.getByTestId("cast-play-pause")).toHaveAttribute(
		"aria-label",
		"Pause",
		{ timeout: 10_000 },
	);

	await sender.getByTestId("cast-play-pause").click();
	await expect
		.poll(async () =>
			screen.evaluate(
				() => document.querySelector(`[data-testid="cast-video"]`)?.paused,
			),
		)
		.toBe(true);
	await expect(sender.getByTestId("cast-play-pause")).toHaveAttribute(
		"aria-label",
		"Play",
	);

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
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();
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

test("the same room code reconnects after the sender leaves a cast and recovers the real state (SPECS.md §6)", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.route(CAST_URL, fulfillWithRangeSupport);

	await screen.goto("/");
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();
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

	// El primer emisor bloquea el telefono (cierra su conexion del todo).
	await senderCtx.close();
	await screen.waitForTimeout(1500);

	// Un SEGUNDO emisor entra con el MISMO codigo -- no un codigo nuevo,
	// la sala no ha muerto (SPECS.md §6, asimetria del cast).
	const reconnectCtx = await browser.newContext();
	const reconnected = await reconnectCtx.newPage();
	await reconnected.goto(`/?code=${code}`);

	// Recupera el control mostrando lo que ya se esta reproduciendo, no el
	// formulario de pegar una URL nueva (ya no lleva el prefijo "Casting:",
	// encargo de rediseño — el nombre solo, en lenguaje normal).
	await expect(reconnected.getByText(CAST_URL)).toBeVisible({
		timeout: 10_000,
	});

	// Y el estado real (posicion avanzada, reproduciendo) — nunca los
	// valores por defecto (0:00, pausado) como si nada hubiera pasado.
	await expect(reconnected.getByTestId("cast-play-pause")).toHaveAttribute(
		"aria-label",
		"Pause",
		{ timeout: 10_000 },
	);
	await expect
		.poll(async () =>
			reconnected.evaluate(() => {
				const el = document.querySelector(
					'[data-testid="cast-seek"]',
				) as HTMLInputElement | null;
				return el ? Number(el.value) : 0;
			}),
		)
		.toBeGreaterThan(0);

	// El video en la tele nunca se detuvo durante todo esto.
	const stillPlaying = await screen.evaluate(
		() =>
			(document.querySelector('[data-testid="cast-video"]') as HTMLVideoElement)
				.paused,
	);
	expect(stillPlaying).toBe(false);

	await screenCtx.close();
	await reconnectCtx.close();
});

test("rejects a non-http(s) cast URL with a clear message, client-side", async ({
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
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();
	await sender.getByTestId("cast-url-input").fill(BROKEN_URL);
	await sender.getByTestId("cast-url-submit").click();

	// Nunca una pantalla negra sin explicar por que (encargo M1, parte 2).
	// Los textos exactos cambiaron con el rediseño (tres niveles: icono,
	// titular, detalle — encargo de rediseño, parte 9) pero el titular
	// sigue siendo el mismo en las dos vistas.
	await expect(screen.getByText("This video can't be played")).toBeVisible({
		timeout: 10_000,
	});
	await expect(sender.getByText("The TV couldn't play this link")).toBeVisible({
		timeout: 10_000,
	});

	await screenCtx.close();
	await senderCtx.close();
});

test("the volume and seek sliders are themed, not left at the browser's default accent color", async ({
	browser,
}) => {
	// Regresion (encargo "el azul del control de volumen"): un
	// <input type="range"> sin accent-color hereda el azul de acento del
	// sistema, y como no es un literal en el CSS, la auditoria de "ningun
	// color fuera de los tokens" no lo detecta — ver docs/screen-aspect.md,
	// "Controles nativos sin tematizar". Este test comprueba el valor
	// computado de verdad, no una clase de Tailwind.
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.route(CAST_URL, fulfillWithRangeSupport);
	await screen.goto("/");
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto(`/?code=${code}`);
	await sender.getByText("Cast", { exact: true }).click();
	await sender.getByTestId("cast-url-input").fill(CAST_URL);
	await sender.getByTestId("cast-url-submit").click();

	await expect(sender.getByTestId("cast-seek")).toBeVisible({
		timeout: 10_000,
	});

	// rgb(111, 217, 185) es --glass (#6FD9B9, tailwind.config.js) — el
	// valor por defecto del navegador es "auto" (o azul segun plataforma),
	// nunca este valor exacto por casualidad.
	for (const testId of ["cast-seek", "cast-volume"]) {
		const accentColor = await sender
			.getByTestId(testId)
			.evaluate((el) => getComputedStyle(el).accentColor);
		expect(accentColor).toBe("rgb(111, 217, 185)");
	}

	await screenCtx.close();
	await senderCtx.close();
});
