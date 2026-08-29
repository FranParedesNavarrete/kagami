import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
// Directorio TEMPORAL propio (SPECS.md §4.3), aislado por sala: cada
// codigo de sala tiene su propio subdirectorio, nunca se listan entre
// salas. Dos niveles arriba de src/services (o dist/services) es la
// raiz de apps/server, funciona igual en dev y en produccion.
export const CAST_UPLOAD_ROOT = join(here, "../../data/cast-uploads");

// SPECS.md §4.3: "se borran... a las 24h como maximo". El intervalo de
// comprobacion no necesita ser fino — una hora de margen sobre 24h no
// importa para un fichero de cast.
export const CAST_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CAST_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export type CastFileKind = "video" | "image";

export interface CastFile {
	id: string;
	roomCode: string;
	ext: string;
	kind: CastFileKind;
	uploadedAt: number;
	// true solo si es un mp4/mov que necesitaba remux para faststart y
	// ffmpeg no estaba disponible (o el remux fallo) — nunca en silencio,
	// se lo decimos al emisor para que avise en su UI.
	seekMayNotWork: boolean;
}

function filenameFor(file: Pick<CastFile, "id" | "ext">): string {
	return `${file.id}.${file.ext}`;
}

// Un fichero por sala como maximo — nunca acumular huerfanos de casts
// previos en la misma sala. "Un identificador imposible de adivinar no
// basta" (encargo): isValidFile comprueba la pertenencia a la sala en
// cada peticion, no solo al subir.
export class CastFileService {
	private readonly files = new Map<string, CastFile>(); // roomCode -> fichero activo

	constructor(private readonly uploadRoot: string = CAST_UPLOAD_ROOT) {}

	private stagingDir(): string {
		// Fuera de cualquier roomDir a proposito: registerFile() limpia el
		// cast anterior de la sala borrando su directorio entero, y eso no
		// puede llevarse por delante el fichero que se acaba de subir
		// mientras todavia esta en trafico.
		return join(this.uploadRoot, ".staging");
	}

	roomDir(roomCode: string): string {
		return join(this.uploadRoot, roomCode);
	}

	pathFor(file: Pick<CastFile, "roomCode" | "id" | "ext">): string {
		return join(this.roomDir(file.roomCode), filenameFor(file));
	}

	urlPathFor(file: Pick<CastFile, "roomCode" | "id" | "ext">): string {
		return `/cast/files/${file.roomCode}/${filenameFor(file)}`;
	}

	async prepareUpload(): Promise<{ id: string; tempPath: string }> {
		await mkdir(this.stagingDir(), { recursive: true });
		const id = randomUUID();
		return { id, tempPath: join(this.stagingDir(), `${id}.part`) };
	}

	// Mueve el fichero ya validado (subido y comprobado por contenido) de
	// staging a su sitio final, reemplazando cualquier cast anterior de
	// esta misma sala.
	async registerFile(
		roomCode: string,
		id: string,
		ext: string,
		kind: CastFileKind,
		tempPath: string,
	): Promise<CastFile> {
		await this.deleteRoomFiles(roomCode);
		const file: CastFile = {
			id,
			roomCode,
			ext,
			kind,
			uploadedAt: Date.now(),
			seekMayNotWork: false,
		};
		await mkdir(this.roomDir(roomCode), { recursive: true });
		await rename(tempPath, this.pathFor(file));
		this.files.set(roomCode, file);
		return file;
	}

	getFile(roomCode: string): CastFile | undefined {
		return this.files.get(roomCode);
	}

	isValidFile(roomCode: string, filename: string): boolean {
		const file = this.files.get(roomCode);
		return !!file && filenameFor(file) === filename;
	}

	setSeekMayNotWork(roomCode: string, value: boolean): void {
		const file = this.files.get(roomCode);
		if (file) file.seekMayNotWork = value;
	}

	// Camino 1 de limpieza garantizada: al cerrar la sala.
	async deleteRoomFiles(roomCode: string): Promise<void> {
		this.files.delete(roomCode);
		await rm(this.roomDir(roomCode), { recursive: true, force: true });
	}

	// Un reinicio del server borra TODAS las salas de memoria (SPECS.md
	// §4.1) — cualquier fichero que sobreviva en disco es, por
	// definicion, huerfano: ninguna sala en memoria lo reclama ya. Se
	// limpia entero al arrancar (incluida el area de staging, para
	// cualquier subida que se quedara a medias), no solo lo mas viejo de
	// 24h — es lo que hace que el barrido "sobreviva a un reinicio del
	// servidor".
	async sweepOrphanedOnStartup(): Promise<void> {
		await rm(this.uploadRoot, { recursive: true, force: true });
		await mkdir(this.uploadRoot, { recursive: true });
	}

	// Camino 2 de limpieza garantizada: barrido de las 24h. La edad es la
	// del fichero (desde que se subio), no la de la sala — una sala puede
	// llevar reproduciendo el mismo cast mas de 24h sin haberse cerrado
	// nunca, y el limite sigue aplicando (SPECS.md §4.3: "24h como maximo").
	async sweepExpired(maxAgeMs: number, now = Date.now()): Promise<string[]> {
		const expired = [...this.files.entries()].filter(
			([, file]) => now - file.uploadedAt > maxAgeMs,
		);
		const swept: string[] = [];
		for (const [roomCode] of expired) {
			await this.deleteRoomFiles(roomCode);
			swept.push(roomCode);
		}
		return swept;
	}
}
