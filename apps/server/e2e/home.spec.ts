import { expect, test } from "@playwright/test";

// Cuatro celdas con avance automatico (encargo de rediseño, parte 10):
// nunca hay un boton "Join" que pulsar — verificado contra el server
// real, no solo argumentado, porque el flujo entero (fetch del room-code
// -> WS join-room -> "ready") depende de que kagami/i18n/React lo disparen
// solos al completar el cuarto caracter.
test("typing the four characters of a real room code joins without pressing any button", async ({
	browser,
}) => {
	const screenCtx = await browser.newContext();
	const senderCtx = await browser.newContext();
	const screen = await screenCtx.newPage();
	const sender = await senderCtx.newPage();

	await screen.goto("/");
	await screen.getByText("Show code").click();
	const code = (await screen.getByTestId("room-code").innerText()).trim();

	await sender.goto("/");
	// Nunca hay un boton "Join" visible en absoluto en este diseño.
	await expect(sender.getByText("Join")).toHaveCount(0);

	// Escribe en la primera celda y deja que el propio componente mueva el
	// foco solo tras cada caracter (pressSequentially en la primera celda
	// no basta: seguiria escribiendo ahi si el foco no avanzara de verdad).
	const cells = sender.getByTestId("home-code-input").locator("input");
	await cells.first().click();
	await sender.keyboard.type(code);

	// Al completar el cuarto caracter entra solo: sin ?code= en la URL
	// (a diferencia del flujo de enlace directo), el emisor llega igual a
	// "ready".
	await expect(sender.getByText("Share screen")).toBeVisible({
		timeout: 10_000,
	});

	await screenCtx.close();
	await senderCtx.close();
});

test("backspace on an empty cell moves focus back and clears the previous character", async ({
	page,
}) => {
	await page.goto("/");
	const cells = page.getByTestId("home-code-input").locator("input");

	await cells.nth(0).pressSequentially("A");
	await cells.nth(1).pressSequentially("2");
	// Borrado sobre una celda YA vacia (la tercera, nunca tecleada):
	// retrocede y borra la segunda, no se queda quieto.
	await cells.nth(2).press("Backspace");
	await expect(cells.nth(1)).toHaveValue("");
	await expect(cells.nth(0)).toHaveValue("A");
});
