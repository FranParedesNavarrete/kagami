import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// e2e/ son specs de Playwright, no de Vitest — sin esto, vitest los
		// recoge tambien (mismo sufijo .spec.ts) y choca con el runner.
		exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
	},
});
