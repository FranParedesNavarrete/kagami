import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	server: {
		proxy: {
			"/ws": { target: "ws://localhost:7421", ws: true },
			"/health": "http://localhost:7421",
		},
	},
	build: {
		outDir: "dist",
	},
});
