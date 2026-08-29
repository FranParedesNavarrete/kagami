import { expect, test } from "@playwright/test";

const CODE_RE = /^[234679ACDEFGHJKMNPQRTUVWXYZ]{4}$/;

test("room code, sender joins, shares, and disconnect returns a fresh code", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.goto("/");
	await screen.getByText("Show code").click();

	const codeLocator = screen.getByTestId("room-code");
	await expect(codeLocator).toBeVisible();
	const firstCode = (await codeLocator.innerText()).trim();
	expect(firstCode).toMatch(CODE_RE);

	await sender.goto(`/?code=${firstCode}`);
	await sender.getByText("Share screen").click();

	await expect(screen.getByTestId("video-wrapper")).not.toHaveClass(/hidden/, {
		timeout: 15_000,
	});
	await expect
		.poll(
			async () =>
				screen.evaluate(() => document.querySelector("video")?.videoWidth ?? 0),
			{
				timeout: 15_000,
			},
		)
		.toBeGreaterThan(0);

	// Regresion del hallazgo en docs/webrtc-codec.md: Chrome/Brave negocian
	// VP9/AV1 por defecto para compartir pantalla y la tele real se quedaba
	// en negro sin avisar. VP8 es el preferido por defecto (medido: 4.5 min
	// reales sin cortes en esta tele; H.264 solo funciono parcialmente en
	// Safari) — el emisor debe mostrarlo, nunca VP9/AV1, nunca
	// "negotiating..." indefinidamente.
	// El codec ya no esta siempre a la vista (encargo de rediseño, parte
	// 7: pasa al desplegable "Statistics") — hay que abrirlo primero.
	await sender.getByText("Statistics").click();
	await expect(sender.getByText(/video\/vp8/i)).toBeVisible({
		timeout: 10_000,
	});

	await sender.getByText("Stop sharing").click();

	await expect(codeLocator).toBeVisible({ timeout: 15_000 });
	const secondCode = (await codeLocator.innerText()).trim();
	expect(secondCode).toMatch(CODE_RE);
	expect(secondCode).not.toBe(firstCode);

	// Regresion del bug "el emisor no se entera de que la sala ha
	// terminado": tras enviar leave, el server borra la sala para siempre
	// (SPECS.md §6) — el emisor NO debe volver a "ready" con el boton
	// Share screen como si pudiera resucitarla pulsandolo.
	await expect(sender.getByText("You stopped sharing")).toBeVisible({
		timeout: 10_000,
	});
	await expect(sender.getByText("Share screen")).not.toBeVisible();

	await sender.getByText("Back to start").click();
	await expect(sender.getByText("Be the screen")).toBeVisible();
	expect(new URL(sender.url()).search).toBe(""); // el ?code= muerto no sobrevive

	await screenCtx.close();
	await senderCtx.close();
});

test("screen ending the session sends the sender back home with a clear message", async ({
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
	await sender.getByText("Share screen").click();
	await expect(screen.getByTestId("video-wrapper")).not.toHaveClass(/hidden/, {
		timeout: 15_000,
	});

	// La pantalla "corta" cerrando su contexto — mismo efecto que apagar
	// la tele o cerrar la pestaña: el WS se cierra, y el server notifica
	// al emisor con peer-left (RoomService.leave se dispara igual desde
	// el handler de "close" que desde un "leave" explicito).
	await screenCtx.close();

	// El texto cambio con el rediseño: ya no dice "the screen ended the
	// session" a secas, explica por que el codigo ya no sirve (encargo de
	// rediseño, parte 9).
	await expect(sender.getByText(/no longer works/i)).toBeVisible({
		timeout: 10_000,
	});
	await expect(sender.getByText("Share screen")).not.toBeVisible();

	await sender.getByText("Back to start").click();
	await expect(sender.getByText("Be the screen")).toBeVisible();
	expect(new URL(sender.url()).search).toBe("");

	await senderCtx.close();
});

// Los cinco modos de aspecto (mirror) y las mismas reglas para el cast
// tienen su propio fichero, screen-aspect.spec.ts: localizan el video por
// visibilidad real, no por ser "el primero en el DOM" — ver ese fichero
// para el porque exacto (fue un bug real de la propia prueba, no de la
// app, encontrado al investigar un reporte de regresion falso).

test("an unknown room code shows an error to the sender", async ({ page }) => {
	await page.goto("/?code=ZZZZ");
	await expect(page.getByText(/doesn't exist or already expired/i)).toBeVisible(
		{ timeout: 10_000 },
	);
});

test("a second sender is rejected once the room is paired", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const sender1Ctx = await browser.newContext();
	const sender2Ctx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender1 = await sender1Ctx.newPage();
	const sender2 = await sender2Ctx.newPage();

	await screen.goto("/");
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender1.goto(`/?code=${code}`);
	await expect(sender1.getByText("Share screen")).toBeVisible();

	await sender2.goto(`/?code=${code}`);
	await expect(sender2.getByText(/already has a sender/i)).toBeVisible({
		timeout: 10_000,
	});

	await screenCtx.close();
	await sender1Ctx.close();
	await sender2Ctx.close();
});
