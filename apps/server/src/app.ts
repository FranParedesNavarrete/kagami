import websocketPlugin from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { logger } from "./lib/logger.js";
import { registerCastUpload } from "./routes/castUpload.js";
import { registerRangeDiagnostics } from "./routes/diagRange.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerPages } from "./routes/pages.js";
import {
	CAST_FILE_MAX_AGE_MS,
	CAST_SWEEP_INTERVAL_MS,
	CastFileService,
} from "./services/castFileService.js";
import { RoomService } from "./services/roomService.js";
import { registerSignaling } from "./ws/signaling.js";

export async function buildApp(webDistDir: string): Promise<FastifyInstance> {
	const app = Fastify({ logger: true });

	const castFiles = new CastFileService();
	// Un reinicio del server borra todas las salas de memoria (SPECS.md
	// §4.1): cualquier fichero de cast que sobreviva en disco es huerfano
	// por definicion — "el barrido debe sobrevivir a un reinicio del
	// servidor" significa exactamente esto, no una promesa vacia.
	await castFiles.sweepOrphanedOnStartup();
	// Barrido de las 24h (SPECS.md §4.3) — camino 2 de limpieza
	// garantizada, independiente de que la sala se cierre o no.
	// `.unref()`: que este intervalo no sea motivo por si solo para que
	// el proceso (o un test) siga vivo.
	setInterval(() => {
		castFiles
			.sweepExpired(CAST_FILE_MAX_AGE_MS)
			.then((swept) => {
				if (swept.length > 0)
					logger.info({ rooms: swept }, "swept expired cast files (24h)");
			})
			.catch((err) => logger.error({ err }, "cast file sweep failed"));
	}, CAST_SWEEP_INTERVAL_MS).unref();

	const rooms = new RoomService((code) => {
		castFiles
			.deleteRoomFiles(code)
			.catch((err) =>
				logger.error(
					{ err, code },
					"failed to clean up cast files on room close",
				),
			);
	});

	await app.register(websocketPlugin);

	registerHealthRoute(app);
	registerSignaling(app, rooms);
	await registerCastUpload(app, rooms, castFiles);
	// Diagnostico de M1 (ROADMAP.md): sirve /diag/range con el mismo
	// mecanismo de servido estatico que el resto de la app, para
	// diagnosticar range requests en la tele real antes de construir el
	// cast de ficheros encima. Quitar cuando la puerta de M1 se cierre y
	// la decision quede tomada en SPECS.md §4.3 — es lo PRIMERO a retirar
	// una vez la tabla de la LG este rellena.
	await registerRangeDiagnostics(app);
	await registerPages(app, webDistDir);

	return app;
}
