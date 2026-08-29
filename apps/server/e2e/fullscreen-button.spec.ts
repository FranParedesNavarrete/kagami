import { expect, test } from "@playwright/test";

// Comportamiento de los controles de cualquier reproductor (encargo de
// cierre de kagami, parte 2): visible al entrar, se esconde a los 5s sin
// interaccion, y cualquier actividad (toque, raton, O tecla — esto ultimo
// es lo que hace falta desde el sofa con el mando de webOS, que manda
// eventos de teclado) lo devuelve. La comprobacion con un mando real
// queda sin marcar, la hace Fran.

async function opacityOf(
	page: import("@playwright/test").Page,
): Promise<number> {
	const raw = await page
		.getByTestId("fullscreen-button")
		.evaluate((el) => getComputedStyle(el).opacity);
	return Number(raw);
}

// La transicion CSS (duration-300) tarda un poco en LLEGAR a 0/1 tras el
// cambio de clase — comparar con un umbral en vez de igualdad exacta
// evita depender de en que punto exacto de la transicion cae el poll.
async function waitForHidden(page: import("@playwright/test").Page) {
	await expect
		.poll(() => opacityOf(page), { timeout: 2_000 })
		.toBeLessThan(0.05);
}
async function waitForVisible(page: import("@playwright/test").Page) {
	await expect
		.poll(() => opacityOf(page), { timeout: 2_000 })
		.toBeGreaterThan(0.95);
}

async function assertNoScrollbar(page: import("@playwright/test").Page) {
	const ok = await page.evaluate(() => {
		const el = document.documentElement;
		return (
			el.scrollWidth === el.clientWidth && el.scrollHeight === el.clientHeight
		);
	});
	expect(ok).toBe(true);
}

test("the fullscreen button hides after 5s of inactivity and no scroll appears", async ({
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

	// Visible nada mas entrar en "sharing".
	await expect(screen.getByTestId("fullscreen-button")).toBeVisible();
	expect(await opacityOf(screen)).toBeGreaterThan(0.95);
	await assertNoScrollbar(screen);

	await screen.waitForTimeout(5_000);
	await waitForHidden(screen);
	await assertNoScrollbar(screen);

	// El video-wrapper no gano hijos de mas por el camino: el boton vive
	// fuera de esa caja, tal como pide el encargo.
	const wrapperChildren = await screen
		.getByTestId("video-wrapper")
		.evaluate((el) => el.children.length);
	expect(wrapperChildren).toBe(1);
});

test("mousemove brings the button back and resets the countdown", async ({
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

	await screen.waitForTimeout(5_000);
	await waitForHidden(screen);

	await screen.mouse.move(200, 200);
	await waitForVisible(screen);

	// El contador se reinicio de verdad: bastante antes de los 5s desde
	// el mousemove (no desde el arranque original) todavia deberia seguir
	// visible, y bastante despues deberia esconderse otra vez.
	await screen.waitForTimeout(3_500);
	expect(await opacityOf(screen)).toBeGreaterThan(0.95);
	await screen.waitForTimeout(2_500);
	await waitForHidden(screen);
});

test("keydown brings the button back — the webOS remote sends key events, not clicks or touches", async ({
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

	await screen.waitForTimeout(5_000);
	await waitForHidden(screen);

	await screen.keyboard.press("ArrowDown");
	await waitForVisible(screen);
});

test("once hidden, the button stops accepting clicks (pointer-events-none), not just visually faded", async ({
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

	await screen.waitForTimeout(5_200);
	const pointerEvents = await screen
		.getByTestId("fullscreen-button")
		.evaluate((el) => getComputedStyle(el).pointerEvents);
	expect(pointerEvents).toBe("none");
});
