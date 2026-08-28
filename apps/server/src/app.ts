import websocketPlugin from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoute } from "./routes/health.js";
import { registerPages } from "./routes/pages.js";
import { RoomService } from "./services/roomService.js";
import { registerSignaling } from "./ws/signaling.js";

export async function buildApp(webDistDir: string): Promise<FastifyInstance> {
	const app = Fastify({ logger: true });

	await app.register(websocketPlugin);

	registerHealthRoute(app);
	registerSignaling(app, new RoomService());
	await registerPages(app, webDistDir);

	return app;
}
