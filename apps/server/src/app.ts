import websocketPlugin from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerRangeDiagnostics } from "./routes/diagRange.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerPages } from "./routes/pages.js";
import { RoomService } from "./services/roomService.js";
import { registerSignaling } from "./ws/signaling.js";

export async function buildApp(webDistDir: string): Promise<FastifyInstance> {
	const app = Fastify({ logger: true });

	await app.register(websocketPlugin);

	registerHealthRoute(app);
	registerSignaling(app, new RoomService());
	// Diagnostico de M1 (ROADMAP.md): sirve /diag/range con el mismo
	// mecanismo de servido estatico que el resto de la app, para
	// diagnosticar range requests en la tele real antes de construir el
	// cast de ficheros encima. Quitar cuando la puerta de M1 se cierre y
	// la decision quede tomada en SPECS.md §4.3.
	await registerRangeDiagnostics(app);
	await registerPages(app, webDistDir);

	return app;
}
