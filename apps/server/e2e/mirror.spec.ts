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

	await expect(screen.locator("video")).not.toHaveClass(/hidden/, {
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

	await sender.getByText("Stop sharing").click();

	await expect(codeLocator).toBeVisible({ timeout: 15_000 });
	const secondCode = (await codeLocator.innerText()).trim();
	expect(secondCode).toMatch(CODE_RE);
	expect(secondCode).not.toBe(firstCode);

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
