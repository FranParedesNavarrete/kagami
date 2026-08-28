import { defineConfig, devices } from "@playwright/test";

// e2e contra el server real (CODESTYLE.md §4): la captura de pantalla se
// finge con flags de Chromium, nunca con mocks del codigo propio.
export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	fullyParallel: false,
	webServer: {
		command: "node dist/index.js",
		url: "http://localhost:7421/health",
		reuseExistingServer: !process.env.CI,
		env: { KAGAMI_PORT: "7421" },
	},
	use: {
		baseURL: "http://localhost:7421",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				launchOptions: {
					args: [
						"--auto-select-desktop-capture-source=Entire screen",
						"--use-fake-device-for-media-stream",
						"--use-fake-ui-for-media-stream",
					],
				},
			},
		},
	],
});
