import { z } from "zod";

// Alfabeto sin ambiguas visuales (sin O/0, I/1/L, S/5, B/8) — se lee de
// lejos en una tele. Ver SPECS.md §6.
export const ROOM_CODE_ALPHABET = "234679ACDEFGHJKMNPQRTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;
export const ROOM_TTL_MS = 10 * 60 * 1000;
// SPECS.md §6: mientras la fase sea "casting" y la pantalla siga
// conectada, la sala sobrevive a que el emisor se desconecte (el caso
// real de bloquear el iPhone) — pero no para siempre. 30 min de ventana
// para que el mismo codigo reconecte antes de que la sala muera de verdad.
export const SCREEN_ALONE_TTL_MS = 30 * 60 * 1000;

const roomCodePattern = new RegExp(
	`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`,
);

export const RoomCodeSchema = z
	.string()
	.length(ROOM_CODE_LENGTH)
	.regex(roomCodePattern, "invalid room code");

const sdpSchema = z.object({
	type: z.enum(["offer", "answer", "pranswer", "rollback"]),
	sdp: z.string(),
});

const iceCandidateSchema = z.object({
	candidate: z.string(),
	sdpMid: z.string().nullable().optional(),
	sdpMLineIndex: z.number().nullable().optional(),
	usernameFragment: z.string().nullable().optional(),
});

// Modo de aspecto de la vista pantalla — el control vive en el emisor
// (el mando de la tele es incomodo) y viaja por WS. Puro CSS en el
// receptor, nunca toca la conexion WebRTC.
export const AspectModeSchema = z.enum([
	"auto",
	"expanded",
	"16:9",
	"21:9",
	"4:3",
]);
export type AspectMode = z.infer<typeof AspectModeSchema>;

// Cast de URL (SPECS.md §2): solo http/https, nunca otro esquema
// (javascript:, data:, file:...). z.string().url() valida sintaxis pero
// acepta cualquier esquema absoluto, de ahi el refine explicito con el
// mensaje de rechazo que exige el encargo.
export const CastUrlSchema = z.string().superRefine((value, ctx) => {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid URL" });
		return;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "only http:// and https:// URLs are supported",
		});
	}
});

// Forma compartida entre ClientMessageSchema y ServerMessageSchema — la
// pantalla la manda como "cliente" (informa de su propio estado), el
// server la relaya al emisor como mensaje "de servidor" (SPECS §6: al
// reconectar tras bloquear el telefono, el emisor recibe esto para no
// mostrar datos inventados). volume se anadio para eso — antes no via
// forma de saber que volumen tenia la tele en cada momento.
const castStatusShape = {
	currentTimeSec: z.number().min(0),
	durationSec: z.number().min(0).nullable(),
	paused: z.boolean(),
	ended: z.boolean(),
	volume: z.number().min(0).max(1),
	errorMessage: z.string().nullable(),
};

// Mensajes cliente -> server. Un mensaje que no valida se rechaza con log,
// nunca se procesa "a ver si cuela" (CODESTYLE.md §2).
export const ClientMessageSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("create-room") }),
	z.object({ type: z.literal("join-room"), code: RoomCodeSchema }),
	z.object({ type: z.literal("offer"), sdp: sdpSchema }),
	z.object({ type: z.literal("answer"), sdp: sdpSchema }),
	z.object({ type: z.literal("ice"), candidate: iceCandidateSchema }),
	z.object({ type: z.literal("leave") }),
	z.object({ type: z.literal("restart-ice") }),
	z.object({ type: z.literal("set-aspect-mode"), mode: AspectModeSchema }),
	z.object({ type: z.literal("cast-url"), url: CastUrlSchema }),
	z.object({ type: z.literal("cast-play") }),
	z.object({ type: z.literal("cast-pause") }),
	z.object({ type: z.literal("cast-seek"), positionSec: z.number().min(0) }),
	z.object({
		type: z.literal("cast-volume"),
		volume: z.number().min(0).max(1),
	}),
	z.object({ type: z.literal("cast-status"), ...castStatusShape }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Mensajes server -> cliente. Los mensajes de cast se relayan tal cual
// entre emisor y pantalla (igual que offer/answer/ice), asi que su forma
// se repite identica a la de ClientMessageSchema.
export const ServerMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("room-created"),
		code: RoomCodeSchema,
		expiresInMs: z.number(),
	}),
	z.object({ type: z.literal("room-joined") }),
	z.object({ type: z.literal("peer-joined") }),
	z.object({ type: z.literal("offer"), sdp: sdpSchema }),
	z.object({ type: z.literal("answer"), sdp: sdpSchema }),
	z.object({ type: z.literal("ice"), candidate: iceCandidateSchema }),
	z.object({ type: z.literal("peer-left") }),
	z.object({ type: z.literal("restart-ice") }),
	z.object({ type: z.literal("set-aspect-mode"), mode: AspectModeSchema }),
	z.object({ type: z.literal("cast-url"), url: CastUrlSchema }),
	z.object({ type: z.literal("cast-play") }),
	z.object({ type: z.literal("cast-pause") }),
	z.object({ type: z.literal("cast-seek"), positionSec: z.number().min(0) }),
	z.object({
		type: z.literal("cast-volume"),
		volume: z.number().min(0).max(1),
	}),
	z.object({ type: z.literal("cast-status"), ...castStatusShape }),
	// Cast de fichero (M1 parte 3): solo server -> cliente, nunca al
	// reves — los dispara el propio endpoint HTTP de subida, no un
	// mensaje de WS del emisor. "path" es relativo (nunca una URL
	// absoluta): el emisor sube por un host (posiblemente HTTPS, detras
	// de un dominio distinto), pero la pantalla sirve por HTTP plano en
	// su propio origen (SPECS §4.4) — cada lado resuelve el path contra
	// su propio location.origin, nunca se asume que comparten host.
	z.object({
		type: z.literal("cast-file-processing"),
		percent: z.number().min(0).max(100).nullable(),
	}),
	z.object({
		type: z.literal("cast-file-ready"),
		path: z.string(),
		filename: z.string(),
		seekMayNotWork: z.boolean(),
	}),
	z.object({ type: z.literal("cast-file-error"), message: z.string() }),
	// SPECS §6: al reconectar con el mismo codigo tras que la sala
	// quedara en "pantalla sola" durante un cast, el emisor recibe esto
	// (para saber que hay un cast en marcha y su etiqueta) seguido de un
	// "cast-status" con la posicion/pausa/volumen reales — nunca datos
	// inventados.
	z.object({ type: z.literal("cast-resumed"), label: z.string() }),
	// Se cumplieron los 30 min de "pantalla sola" sin que nadie
	// reconectara: la sala muere de verdad esta vez (a diferencia de
	// "peer-left" durante un cast, que la pantalla ignora a proposito).
	z.object({ type: z.literal("screen-alone-expired") }),
	z.object({
		type: z.literal("error"),
		code: z.enum([
			"room-not-found",
			"room-expired",
			"room-full",
			"invalid-message",
		]),
		message: z.string(),
	}),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const EnvSchema = z.object({
	KAGAMI_PORT: z.coerce.number().int().positive().default(7421),
	KAGAMI_CAST_MAX_MB: z.coerce.number().int().positive().default(4096),
});
export type Env = z.infer<typeof EnvSchema>;
