import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

// Sirve el SPA compilado de apps/web. Una sola vista con estado en el
// cliente (no hay rutas de servidor distintas para pantalla/emisor), asi
// que servir el directorio estatico con index.html basta.
export async function registerPages(
	app: FastifyInstance,
	webDistDir: string,
): Promise<void> {
	await app.register(fastifyStatic, { root: webDistDir });
}
