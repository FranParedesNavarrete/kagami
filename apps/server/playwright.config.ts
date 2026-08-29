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
		// KAGAMI_REMUX_FASTSTART: "true" — en produccion esta desactivado por
		// defecto (medido en la LG real, docs/spike-range.md), pero el
		// remux sigue siendo codigo mantenido para otros receptores, y el
		// e2e de cast-file.spec.ts que lo ejercita necesita activarlo para
		// probar ese camino de verdad, no solo el que esta activo hoy.
		env: { KAGAMI_PORT: "7421", KAGAMI_REMUX_FASTSTART: "true" },
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
