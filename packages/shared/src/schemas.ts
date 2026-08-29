import { z } from "zod";

// Alfabeto sin ambiguas visuales (sin O/0, I/1/L, S/5, B/8) — se lee de
// lejos en una tele. Ver SPECS.md §6.
export const ROOM_CODE_ALPHABET = "234679ACDEFGHJKMNPQRTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;
export const ROOM_TTL_MS = 10 * 60 * 1000;

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
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Mensajes server -> cliente.
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
