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
	await screen.getByText("Be the screen").click();

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
	await expect(sender.getByText(/codec: video\/vp8/i)).toBeVisible({
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
	await screen.getByText("Be the screen").click();
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

	await expect(sender.getByText("The screen ended the session")).toBeVisible({
		timeout: 10_000,
	});
	await expect(sender.getByText("Share screen")).not.toBeVisible();

	await sender.getByText("Back to start").click();
	await expect(sender.getByText("Be the screen")).toBeVisible();
	expect(new URL(sender.url()).search).toBe("");

	await senderCtx.close();
});

// Regresion de los dos fallos vistos en la LG real: la vista pantalla
// metia scrollbar (webOS reporta vh incluyendo area oculta bajo su
// barra), y los modos de ratio fijo recortaban contenido con
// object-fit:cover en vez de deformar con fill. Cubre los requisitos de
// test 1-4 del encargo para los 5 modos; lo que exige la tele real
// (requisito 8, con capturas de 1280x800 y resolucion nativa) queda para
// que Fran lo confirme delante del televisor.
const OBJECT_FIT_BY_MODE: Record<string, string> = {
	auto: "contain",
	expanded: "cover",
	"16:9": "fill",
	"21:9": "fill",
	"4:3": "fill",
};

test("all five aspect modes: no scrollbar, correct object-fit, no overlay bars", async ({
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
	await sender.getByText("Share screen").click();
	await expect(screen.getByTestId("video-wrapper")).not.toHaveClass(/hidden/, {
		timeout: 15_000,
	});

	for (const [mode, expectedFit] of Object.entries(OBJECT_FIT_BY_MODE)) {
		if (mode !== "auto") await sender.getByText(mode, { exact: true }).click();

		// 1: cero scrollbar, en cualquier modo.
		await expect
			.poll(async () =>
				screen.evaluate(() => {
					const el = document.documentElement;
					return (
						el.scrollWidth === el.clientWidth &&
						el.scrollHeight === el.clientHeight
					);
				}),
			)
			.toBe(true);

		// 2/3: object-fit exacto por modo — "fill" en los ratios fijos, nunca
		// "cover", es lo que garantiza que no se pierde contenido (requisito 2).
		await expect
			.poll(async () =>
				screen.evaluate(() => document.querySelector("video")?.style.objectFit),
			)
			.toBe(expectedFit);

		// 3: el rectangulo del <video> cae entero dentro del viewport.
		const fitsInViewport = await screen.evaluate(() => {
			const video = document.querySelector("video");
			if (!video) return false;
			const rect = video.getBoundingClientRect();
			return (
				rect.left >= -0.5 &&
				rect.top >= -0.5 &&
				rect.right <= window.innerWidth + 0.5 &&
				rect.bottom <= window.innerHeight + 0.5
			);
		});
		expect(fitsInViewport).toBe(true);

		// 4: nada solapando el <video> — su caja no tiene mas hijos que el
		// propio video, nunca un div de franja por encima.
		const wrapperChildCount = await screen.evaluate(
			() =>
				document.querySelector('[data-testid="video-wrapper"]')?.children
					.length,
		);
		expect(wrapperChildCount).toBe(1);
	}

	await screenCtx.close();
	await senderCtx.close();
});

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
	await screen.getByText("Be the screen").click();
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
