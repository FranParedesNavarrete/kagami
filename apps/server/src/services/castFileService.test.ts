import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CastFileService } from "./castFileService.js";

describe("CastFileService", () => {
	let root: string;
	let files: CastFileService;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "kagami-cast-test-"));
		files = new CastFileService(root);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("registra un fichero y lo valida solo para su propia sala", async () => {
		const { id, tempPath } = await files.prepareUpload();
		await writeFile(tempPath, "contenido de prueba");
		const file = await files.registerFile("A2C4", id, "mp4", "video", tempPath);

		expect(files.isValidFile("A2C4", `${id}.mp4`)).toBe(true);
		// Un identificador correcto no basta si la sala no coincide — se
		// comprueba la pertenencia a la sala en cada peticion, no solo al
		// subir.
		expect(files.isValidFile("ZZZZ", `${id}.mp4`)).toBe(false);
		expect(files.isValidFile("A2C4", "otro-id.mp4")).toBe(false);
		expect(files.getFile("A2C4")).toEqual(file);
	});

	it("reemplaza el fichero anterior de la misma sala (uno por sala como máximo)", async () => {
		const first = await files.prepareUpload();
		await writeFile(first.tempPath, "primero");
		await files.registerFile("A2C4", first.id, "mp4", "video", first.tempPath);
		const firstPath = files.pathFor({
			roomCode: "A2C4",
			id: first.id,
			ext: "mp4",
		});

		const second = await files.prepareUpload();
		await writeFile(second.tempPath, "segundo");
		await files.registerFile(
			"A2C4",
			second.id,
			"mp4",
			"video",
			second.tempPath,
		);

		expect(files.isValidFile("A2C4", `${first.id}.mp4`)).toBe(false);
		expect(files.isValidFile("A2C4", `${second.id}.mp4`)).toBe(true);
		await expect(readFile(firstPath)).rejects.toThrow();
	});

	it("camino 1 — borra los ficheros de una sala al cerrarla", async () => {
		const { id, tempPath } = await files.prepareUpload();
		await writeFile(tempPath, "contenido");
		await files.registerFile("A2C4", id, "mp4", "video", tempPath);
		const path = files.pathFor({ roomCode: "A2C4", id, ext: "mp4" });

		await files.deleteRoomFiles("A2C4");

		expect(files.getFile("A2C4")).toBeUndefined();
		expect(files.isValidFile("A2C4", `${id}.mp4`)).toBe(false);
		await expect(readFile(path)).rejects.toThrow();
	});

	it("camino 2 — el barrido de 24h separa lo caducado de lo que aún no", async () => {
		const dayMs = 24 * 60 * 60 * 1000;
		vi.useFakeTimers();
		try {
			vi.setSystemTime(0);
			const older = await files.prepareUpload();
			await writeFile(older.tempPath, "viejo");
			await files.registerFile(
				"OLDR",
				older.id,
				"mp4",
				"video",
				older.tempPath,
			);

			// 23h despues: el "nuevo" se sube bastante mas tarde que el
			// viejo, pero todavia dentro de su propia ventana de 24h.
			vi.setSystemTime(23 * 60 * 60 * 1000);
			const newer = await files.prepareUpload();
			await writeFile(newer.tempPath, "nuevo");
			await files.registerFile(
				"NEWR",
				newer.id,
				"mp4",
				"video",
				newer.tempPath,
			);

			// 24h+1ms tras el viejo (que ya caduca), pero solo 1h+1ms tras
			// el nuevo (que no).
			const now = dayMs + 1;
			const swept = await files.sweepExpired(dayMs, now);

			expect(swept).toEqual(["OLDR"]);
			expect(files.getFile("OLDR")).toBeUndefined();
			expect(files.getFile("NEWR")).toBeDefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it("sweepOrphanedOnStartup borra todo lo que hubiera en disco, huerfano por definición tras un reinicio", async () => {
		const { id, tempPath } = await files.prepareUpload();
		await writeFile(tempPath, "contenido");
		await files.registerFile("A2C4", id, "mp4", "video", tempPath);

		// Simula un reinicio: un CastFileService nuevo (mapa en memoria
		// vacío) sobre el MISMO directorio en disco.
		const afterRestart = new CastFileService(root);
		await afterRestart.sweepOrphanedOnStartup();

		const path = files.pathFor({ roomCode: "A2C4", id, ext: "mp4" });
		await expect(readFile(path)).rejects.toThrow();
	});

	it("sweepOrphanedOnStartup también limpia subidas a medio terminar en el área de staging", async () => {
		const { tempPath } = await files.prepareUpload();
		await writeFile(tempPath, "a medias, nunca se registro");

		const afterRestart = new CastFileService(root);
		await afterRestart.sweepOrphanedOnStartup();

		await expect(readFile(tempPath)).rejects.toThrow();
	});
});
