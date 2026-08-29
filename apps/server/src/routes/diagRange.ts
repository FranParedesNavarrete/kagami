import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { DIAG_RANGE_PAGE_HTML } from "./diagRangePage.js";

const here = fileURLToPath(new URL(".", import.meta.url));
// Dos niveles arriba de src/routes (o dist/routes compilado) es la raiz de
// apps/server, igual que index.ts resuelve apps/web/dist — misma profundidad
// en dev (tsx sobre src) y en produccion (node sobre dist).
const DIAG_MEDIA_DIR = join(here, "../../data/diag-range");

const VIDEO_PREFIX = "/diag/range/video/";

interface DiagLogEntry {
	time: string;
	url: string;
	requestRange: string | null;
	statusCode: number;
	contentRange: string | null;
	acceptRanges: string | null;
	contentType: string | null;
	contentLength: string | null;
}

// Un solo <video> reproduciendo 30s ya dispara decenas de peticiones
// parciales — con un limite bajo, la respuesta 200 inicial (la que dice si
// vino Accept-Ranges) quedaba expulsada del buffer antes de que la propia
// pagina pudiera leerla para armar el resumen.
const MAX_LOG_ENTRIES = 2000;
const log: DiagLogEntry[] = [];

function pushLogEntry(entry: DiagLogEntry): void {
	log.push(entry);
	if (log.length > MAX_LOG_ENTRIES) log.shift();
}

// Diagnostico de M1 (ROADMAP.md, primera tarea, deuda abierta desde el
// spike M-1: docs/spike-tv.md, prueba 4). Sirve dos mp4 identicos salvo
// por la posicion del atomo moov a traves del MISMO mecanismo que ya usa
// apps/server para servir el resto de la app (@fastify/static, no un
// server hecho a mano como el del spike) para poder culpar con datos a
// la tele, al servidor, o a la falta de faststart — no a ojo.
export async function registerRangeDiagnostics(
	app: FastifyInstance,
): Promise<void> {
	app.get("/diag/range", async (_req, reply) => {
		reply.type("text/html; charset=utf-8").send(DIAG_RANGE_PAGE_HTML);
	});

	app.get("/diag/range/log", async () => log);

	await app.register(fastifyStatic, {
		root: DIAG_MEDIA_DIR,
		prefix: VIDEO_PREFIX,
		decorateReply: false,
		index: false,
	});

	// Hook global filtrado por prefijo: @fastify/static no da un punto de
	// enganche propio por ruta, y esto es exactamente lo que exige el
	// encargo — registrar cada cabecera Range recibida y la respuesta real,
	// no solo si el video "parece" reproducirse bien.
	app.addHook("onResponse", async (req, reply) => {
		if (!req.url.startsWith(VIDEO_PREFIX)) return;
		const headers = reply.getHeaders();
		const entry: DiagLogEntry = {
			time: new Date().toISOString(),
			url: req.url,
			requestRange: (req.headers.range as string | undefined) ?? null,
			statusCode: reply.statusCode,
			contentRange: (headers["content-range"] as string | undefined) ?? null,
			acceptRanges: (headers["accept-ranges"] as string | undefined) ?? null,
			contentType: (headers["content-type"] as string | undefined) ?? null,
			contentLength: (headers["content-length"] as string | undefined) ?? null,
		};
		pushLogEntry(entry);
		app.log.info({ diagRange: entry }, "diag-range request");
	});
}
