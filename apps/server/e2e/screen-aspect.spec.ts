import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { CAST_URL, fulfillWithRangeSupport } from "./castFixture.js";

// Regresion real encontrada al investigar un reporte de "los modos de
// aspecto ya no hacen nada" (2026-08-29): el reporte resulto ser falso —
// comparado el commit verificado en la LG (8fa6acb) contra HEAD con un
// worktree, mismo DOM y mismos estilos computados en los cinco modos,
// byte a byte. Pero la INVESTIGACION encontro un fallo real y distinto:
// el viejo test de mirror.spec.ts localizaba el video con
// `document.querySelector("video")`, que coge "el primero en el DOM", no
// "el que se ve". Desde que ScreenView tiene un <video> de espejo
// (siempre en el DOM, oculto con display:none via la clase "hidden"
// cuando no se comparte) y un <video> de cast (solo en el DOM durante la
// fase "casting"), ese selector sigue devolviendo el de espejo aunque no
// sea el visible — coincidencia de orden en el DOM, no verificacion de
// lo que un usuario ve. Una regresion real que cambiara CUAL de los dos
// videos se ve (p. ej. invertir el orden en el JSX, o dejar de ocultar
// el de espejo durante el cast) habria pasado este test en silencio.
// Ver docs/screen-aspect.md para el detalle completo.
const OBJECT_FIT_BY_MODE: Record<string, string> = {
	auto: "contain",
	expanded: "cover",
	"16:9": "fill",
	"21:9": "fill",
	"4:3": "fill",
};

// Localiza el video "como lo haria un usuario": el que esta realmente
// visible (no display:none, con tamaño), nunca "el primero del DOM".
// Falla fuerte si hay cero o mas de uno visibles a la vez.
async function visibleVideo(page: Page): Promise<Locator> {
	const videos = page.locator("video:visible");
	await expect(videos).toHaveCount(1);
	return videos.first();
}

async function assertNoScrollbar(page: Page): Promise<void> {
	const ok = await page.evaluate(() => {
		const el = document.documentElement;
		return (
			el.scrollWidth === el.clientWidth && el.scrollHeight === el.clientHeight
		);
	});
	expect(ok).toBe(true);
}

async function assertFitsViewport(video: Locator): Promise<void> {
	const fits = await video.evaluate((el) => {
		const rect = el.getBoundingClientRect();
		return (
			rect.left >= -0.5 &&
			rect.top >= -0.5 &&
			rect.right <= window.innerWidth + 0.5 &&
			rect.bottom <= window.innerHeight + 0.5
		);
	});
	expect(fits).toBe(true);
}

// Nada solapando el video (ninguna franja simulada por encima): su
// propio padre no tiene mas hijos que el video mismo.
async function assertNoOverlaySiblings(video: Locator): Promise<void> {
	const childCount = await video.evaluate(
		(el) => el.parentElement?.children.length ?? -1,
	);
	expect(childCount).toBe(1);
}

test("mirror: all five aspect modes, located as a user would see them", async ({
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

	// Mientras se espeja, el <video> de cast no existe siquiera en el DOM
	// (la fase nunca es "casting") — no solo "no se ve", no ocupa nada.
	await expect(screen.locator("video")).toHaveCount(1);

	for (const [mode, expectedFit] of Object.entries(OBJECT_FIT_BY_MODE)) {
		if (mode !== "auto") await sender.getByText(mode, { exact: true }).click();

		await assertNoScrollbar(screen);

		const video = await visibleVideo(screen);
		await expect
			.poll(() => video.evaluate((el) => getComputedStyle(el).objectFit))
			.toBe(expectedFit);
		await assertFitsViewport(video);
		await assertNoOverlaySiblings(video);
	}

	await screenCtx.close();
	await senderCtx.close();
});

test("casting: the video fills the screen honestly, and the hidden mirror video takes no space", async ({
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

	// El video de cast aparece en el DOM (a diferencia del espejo, que
	// siempre esta ahi): esperar a que cargue de verdad, no solo a que
	// exista el elemento.
	await expect
		.poll(
			async () =>
				screen.evaluate(
					() =>
						document.querySelector('[data-testid="cast-video"]')?.readyState ??
						0,
				),
			{ timeout: 10_000 },
		)
		.toBeGreaterThanOrEqual(1);

	await assertNoScrollbar(screen);

	// Solo un video visible a la vez — el de espejo sigue en el DOM
	// (nunca se desmonta) pero oculto con display:none.
	const video = await visibleVideo(screen);
	await expect(video).toHaveAttribute("data-testid", "cast-video");

	// cast siempre usa "contain": nunca recorta el contenido del emisor,
	// que puede ser cualquier cosa (no hay un modo de aspecto elegible
	// para cast, a diferencia del espejo).
	await expect
		.poll(() => video.evaluate((el) => getComputedStyle(el).objectFit))
		.toBe("contain");
	await assertFitsViewport(video);
	await assertNoOverlaySiblings(video);

	// El <video> del espejo sigue existiendo (nunca se desmonta) pero no
	// ocupa espacio ni es visible mientras se hace cast.
	const mirrorWrapper = screen.getByTestId("video-wrapper");
	await expect(mirrorWrapper).toHaveClass(/hidden/);
	const mirrorRect = await mirrorWrapper.evaluate((el) => {
		const r = el.getBoundingClientRect();
		return { width: r.width, height: r.height };
	});
	expect(mirrorRect).toEqual({ width: 0, height: 0 });

	await screenCtx.close();
	await senderCtx.close();
});
