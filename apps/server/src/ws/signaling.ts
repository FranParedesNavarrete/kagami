import { ClientMessageSchema, type ServerMessage } from "@kagami/shared";
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import type { Role, RoomService } from "../services/roomService.js";

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

// join/offer/answer/ice/leave en un unico socket por conexion. El rol
// (screen/sender) y la sala se fijan en el primer mensaje valido
// (create-room o join-room) y ya no cambian para esa conexion.
export function registerSignaling(
	app: FastifyInstance,
	rooms: RoomService,
): void {
	app.get("/ws", { websocket: true }, (socket) => {
		let code: string | null = null;
		let role: Role | null = null;

		const send = (message: ServerMessage) => {
			if (socket.readyState === socket.OPEN)
				socket.send(JSON.stringify(message));
		};

		socket.on("message", (raw: Buffer) => {
			const parsed = ClientMessageSchema.safeParse(parseJson(raw.toString()));
			if (!parsed.success) {
				logger.warn(
					{ issues: parsed.error.issues },
					"rejected invalid ws message",
				);
				send({
					type: "error",
					code: "invalid-message",
					message: "invalid message",
				});
				return;
			}
			const msg = parsed.data;

			switch (msg.type) {
				case "create-room": {
					const created = rooms.createRoom({ send });
					code = created.code;
					role = "screen";
					send({
						type: "room-created",
						code: created.code,
						expiresInMs: created.expiresInMs,
					});
					break;
				}
				case "join-room": {
					const result = rooms.joinRoom(msg.code, { send });
					if (!result.ok) {
						send({
							type: "error",
							code: result.reason,
							message: `room ${result.reason}`,
						});
						return;
					}
					code = msg.code;
					role = "sender";
					send({ type: "room-joined" });
					break;
				}
				case "offer":
					if (code && role)
						rooms.relay(code, role, { type: "offer", sdp: msg.sdp });
					break;
				case "answer":
					if (code && role)
						rooms.relay(code, role, { type: "answer", sdp: msg.sdp });
					break;
				case "ice":
					if (code && role)
						rooms.relay(code, role, { type: "ice", candidate: msg.candidate });
					break;
				case "restart-ice":
					if (code && role) rooms.relay(code, role, { type: "restart-ice" });
					break;
				case "set-aspect-mode":
					if (code && role)
						rooms.relay(code, role, {
							type: "set-aspect-mode",
							mode: msg.mode,
						});
					break;
				case "leave":
					if (code && role) rooms.leave(code, role);
					code = null;
					role = null;
					break;
			}
		});

		socket.on("close", () => {
			if (code && role) rooms.leave(code, role);
		});
	});
}
