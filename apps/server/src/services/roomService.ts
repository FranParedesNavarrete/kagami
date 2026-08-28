import {
	ROOM_TTL_MS,
	type ServerMessage,
	generateRoomCode,
} from "@kagami/shared";

export type Role = "screen" | "sender";

export interface Peer {
	send(message: ServerMessage): void;
}

interface Room {
	code: string;
	screen: Peer;
	sender: Peer | null;
	expiryTimer: ReturnType<typeof setTimeout> | null;
}

export type JoinResult =
	| { ok: true }
	| { ok: false; reason: "room-not-found" | "room-full" };

// Salas efimeras en memoria: un reinicio del server las borra y no pasa
// nada (SPECS.md §4.1). "Emparejada la sala, no admite mas emisores"
// (SPECS.md §6) significa tambien que si el emisor se va, la sala muere
// entera — no se reutiliza el mismo codigo para un segundo emisor.
export class RoomService {
	private readonly rooms = new Map<string, Room>();

	createRoom(screen: Peer): { code: string; expiresInMs: number } {
		let code = generateRoomCode();
		while (this.rooms.has(code)) {
			code = generateRoomCode();
		}
		const room: Room = {
			code,
			screen,
			sender: null,
			expiryTimer: setTimeout(() => this.expire(code), ROOM_TTL_MS),
		};
		this.rooms.set(code, room);
		return { code, expiresInMs: ROOM_TTL_MS };
	}

	joinRoom(code: string, sender: Peer): JoinResult {
		const room = this.rooms.get(code);
		if (!room) return { ok: false, reason: "room-not-found" };
		if (room.sender) return { ok: false, reason: "room-full" };

		room.sender = sender;
		if (room.expiryTimer) {
			clearTimeout(room.expiryTimer);
			room.expiryTimer = null;
		}
		room.screen.send({ type: "peer-joined" });
		return { ok: true };
	}

	relay(code: string, from: Role, message: ServerMessage): void {
		const room = this.rooms.get(code);
		if (!room) return;
		const target = from === "screen" ? room.sender : room.screen;
		target?.send(message);
	}

	leave(code: string, from: Role): void {
		const room = this.rooms.get(code);
		if (!room) return;
		if (room.expiryTimer) clearTimeout(room.expiryTimer);
		const other = from === "screen" ? room.sender : room.screen;
		other?.send({ type: "peer-left" });
		this.rooms.delete(code);
	}

	has(code: string): boolean {
		return this.rooms.has(code);
	}

	private expire(code: string): void {
		const room = this.rooms.get(code);
		if (!room || room.sender) return; // ya emparejada: no caduca
		this.rooms.delete(code);
	}
}
