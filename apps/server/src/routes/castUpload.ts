import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { env } from "../lib/env.js";
import {
	ALLOWED_CAST_EXTENSIONS,
	kindForExtension,
	sniffMediaType,
} from "../lib/fileSniff.js";
import { logger } from "../lib/logger.js";
import { needsFaststartRemux } from "../lib/mp4Atoms.js";
import { isFfmpegAvailable, remuxToFaststart } from "../lib/remux.js";
import {
	CAST_UPLOAD_ROOT,
	type CastFile,
	type CastFileService,
} from "../services/castFileService.js";
import type { RoomService } from "../services/roomService.js";

const FILES_PREFIX = "/cast/files/";
// Bytes suficientes para distinguir cualquiera de los formatos de
// fileSniff.ts (el mas largo, RIFF/WEBP, necesita 12).
const SNIFF_HEADER_BYTES = 32;

class UploadTooLargeError extends Error {}

// Cuenta bytes segun pasan por el pipeline y captura la cabecera para
// el sniffing de contenido — nunca bufferiza el fichero entero, y corta
// la subida en cuanto se supera el limite en vez de aceptar el resto
// para descartarlo al final.
class UploadGuard extends Transform {
	private received = 0;
	private headerChunks: Buffer[] = [];
	private headerLen = 0;
	sniffedHeader: Buffer | null = null;

	constructor(private readonly maxBytes: number) {
		super();
	}

	override _transform(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: (error?: Error | null, data?: Buffer) => void,
	): void {
		this.received += chunk.length;
		if (this.received > this.maxBytes) {
			callback(new UploadTooLargeError());
			return;
		}
		if (!this.sniffedHeader) {
			this.headerChunks.push(chunk);
			this.headerLen += chunk.length;
			if (this.headerLen >= SNIFF_HEADER_BYTES) {
				this.sniffedHeader = Buffer.concat(this.headerChunks);
				this.headerChunks = [];
			}
		}
		callback(null, chunk);
	}

	override _flush(callback: (error?: Error | null) => void): void {
		if (!this.sniffedHeader && this.headerChunks.length > 0) {
			this.sniffedHeader = Buffer.concat(this.headerChunks);
		}
		callback();
	}
}

function extensionFromFilename(filename: string): string {
	const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
	return match?.[1]?.toLowerCase() ?? "";
}

// mp4 y mov comparten cabecera ISO-BMFF (fileSniff.ts): se guardan
// siempre como .mp4 en disco, sea cual sea la extension original — es
// lo que de verdad se sirve (`video/mp4`, y es lo que decide
// @fastify/static por la extension del fichero en disco).
async function processVideoAfterUpload(
	rooms: RoomService,
	files: CastFileService,
	file: CastFile,
	originalFilename: string,
): Promise<void> {
	let seekMayNotWork = false;

	if (file.ext === "mp4") {
		const path = files.pathFor(file);
		let needsRemux: boolean | null = null;
		try {
			needsRemux = await needsFaststartRemux(path);
		} catch (err) {
			logger.warn(
				{ err, roomCode: file.roomCode },
				"cast file: moov atom check failed, serving as-is",
			);
		}

		if (needsRemux) {
			const ffmpegOk = await isFfmpegAvailable();
			if (!ffmpegOk) {
				seekMayNotWork = true;
				logger.warn(
					{ roomCode: file.roomCode },
					"cast file needs a faststart remux but ffmpeg is not available — serving as-is, seeking may not work",
				);
			} else {
				rooms.sendToSender(file.roomCode, {
					type: "cast-file-processing",
					percent: 0,
				});
				try {
					await remuxToFaststart(path, (progress) => {
						rooms.sendToSender(file.roomCode, {
							type: "cast-file-processing",
							percent: progress.percent,
						});
					});
				} catch (err) {
					logger.error(
						{ err, roomCode: file.roomCode },
						"faststart remux failed — serving the original, seeking may not work",
					);
					seekMayNotWork = true;
				}
			}
		}
	}

	files.setSeekMayNotWork(file.roomCode, seekMayNotWork);
	announceCastFileReady(rooms, files, file, originalFilename);
}

function announceCastFileReady(
	rooms: RoomService,
	files: CastFileService,
	file: CastFile,
	originalFilename: string,
): void {
	rooms.markCasting(file.roomCode, originalFilename);
	const message = {
		type: "cast-file-ready" as const,
		path: files.urlPathFor(file),
		filename: originalFilename,
		seekMayNotWork: files.getFile(file.roomCode)?.seekMayNotWork ?? false,
	};
	rooms.sendToScreen(file.roomCode, message);
	rooms.sendToSender(file.roomCode, message);
}

export async function registerCastUpload(
	app: FastifyInstance,
	rooms: RoomService,
	files: CastFileService,
): Promise<void> {
	// El handler recibe el stream crudo de la peticion: sin esto, Fastify
	// intenta parsear el body segun Content-Type y no deja pasar un
	// stream binario grande sin bufferizarlo entero primero.
	app.addContentTypeParser("*", (_req, payload, done) => {
		done(null, payload);
	});

	app.post<{
		Params: { roomCode: string };
		Querystring: { filename?: string };
	}>("/cast/upload/:roomCode", async (request, reply) => {
		const { roomCode } = request.params;
		const filename = request.query.filename;

		if (!rooms.has(roomCode)) {
			reply.code(404).send({ error: "room not found" });
			return;
		}
		if (!filename) {
			reply.code(400).send({ error: "missing filename query param" });
			return;
		}
		const claimedExt = extensionFromFilename(filename);
		const expectedKind = kindForExtension(claimedExt);
		if (!expectedKind) {
			reply.code(400).send({
				error: `unsupported extension — only ${[...ALLOWED_CAST_EXTENSIONS].join(", ")} are allowed`,
			});
			return;
		}

		const maxBytes = env.KAGAMI_CAST_MAX_MB * 1024 * 1024;
		const { id, tempPath } = await files.prepareUpload();
		const guard = new UploadGuard(maxBytes);

		try {
			await pipeline(request.raw, guard, createWriteStream(tempPath));
		} catch (err) {
			await rm(tempPath, { force: true });
			if (err instanceof UploadTooLargeError) {
				logger.warn(
					{ roomCode, filename },
					"cast upload rejected: exceeds KAGAMI_CAST_MAX_MB",
				);
				reply.code(413).send({
					error: `file exceeds the ${env.KAGAMI_CAST_MAX_MB}MB limit`,
				});
				return;
			}
			logger.warn({ err, roomCode, filename }, "cast upload stream failed");
			reply.code(400).send({ error: "upload failed" });
			return;
		}

		const sniffed = guard.sniffedHeader
			? sniffMediaType(guard.sniffedHeader)
			: null;
		if (!sniffed || sniffed.kind !== expectedKind) {
			await rm(tempPath, { force: true });
			logger.warn(
				{ roomCode, filename, claimedExt, sniffed },
				"cast upload rejected: content does not match a supported video/image format",
			);
			reply
				.code(400)
				.send({ error: "file content is not a supported video or image" });
			return;
		}

		const file = await files.registerFile(
			roomCode,
			id,
			sniffed.ext,
			sniffed.kind,
			tempPath,
		);
		reply.send({ ok: true });

		if (file.kind === "video") {
			processVideoAfterUpload(rooms, files, file, filename).catch((err) =>
				logger.error(
					{ err, roomCode },
					"cast file post-processing failed unexpectedly",
				),
			);
		} else {
			announceCastFileReady(rooms, files, file, filename);
		}
	});

	// Range requests con Accept-Ranges/206 correctos: el MISMO mecanismo
	// ya verificado en /diag/range (@fastify/static), no una segunda
	// implementacion. La autorizacion ("comprobar la pertenencia a la
	// sala en cada peticion", no solo un id imposible de adivinar) va en
	// un hook aparte, antes de que @fastify/static llegue a servir nada.
	await app.register(fastifyStatic, {
		root: CAST_UPLOAD_ROOT,
		prefix: FILES_PREFIX,
		decorateReply: false,
		index: false,
	});

	app.addHook("onRequest", async (req, reply) => {
		if (!req.url.startsWith(FILES_PREFIX)) return;
		const rest = req.url.slice(FILES_PREFIX.length).split("?")[0] ?? "";
		const [roomCode, filename] = rest.split("/");
		if (!roomCode || !filename || !files.isValidFile(roomCode, filename)) {
			reply.code(404).send({ error: "not found" });
		}
	});
}
