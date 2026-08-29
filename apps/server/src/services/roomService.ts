import {
	ROOM_TTL_MS,
	SCREEN_ALONE_TTL_MS,
	type ServerMessage,
	generateRoomCode,
} from "@kagami/shared";

export type Role = "screen" | "sender";

export interface Peer {
	send(message: ServerMessage): void;
}

interface CastStatusSnapshot {
	currentTimeSec: number;
	durationSec: number | null;
	paused: boolean;
	ended: boolean;
	volume: number;
	errorMessage: string | null;
}

interface Room {
	code: string;
	screen: Peer;
	sender: Peer | null;
	expiryTimer: ReturnType<typeof setTimeout> | null;
	// SPECS.md §6: solo el cast necesita esto. El espejo nunca lo marca —
	// ahi el emisor ES la fuente del video, y su marcha sigue matando la
	// sala como siempre. Una vez a true, no vuelve a false: no hay UI que
	// permita "dejar de castear" sin cerrar la sala.
	isCasting: boolean;
	lastCastLabel: string | null;
	lastCastStatus: CastStatusSnapshot | null;
}

export type JoinResult =
	| {
			ok: true;
			resumed: { label: string; status: CastStatusSnapshot | null } | null;
	  }
	| { ok: false; reason: "room-not-found" | "room-full" };

// Salas efimeras en memoria: un reinicio del server las borra y no pasa
// nada (SPECS.md §4.1).
//
// "Emparejada la sala, no admite mas emisores" (SPECS.md §6) sigue
// siendo cierto tal cual para el ESPEJO: si el emisor se va, la sala
// muere entera, un codigo usado no vuelve. Pero para el CAST hay una
// asimetria a proposito: el emisor durante un cast es solo un mando a
// distancia, no la fuente del video (que vive en la propia pantalla,
// sirviendose de una URL o de un fichero subido) — perderlo no tiene
// por que apagar nada. Mientras la fase sea "casting" Y LA PANTALLA
// SIGA CONECTADA, la sala sobrevive a que el emisor se desconecte (el
// caso real: bloquear el iPhone) en un estado de "pantalla sola" hasta
// SCREEN_ALONE_TTL_MS — el MISMO codigo puede reconectar en ese plazo
// y recupera el control con el estado real (nunca datos inventados,
// ver JoinResult.resumed). Si la propia pantalla se va, la sala muere
// siempre, cast o no — sin pantalla no hay donde reproducir nada.
export class RoomService {
	private readonly rooms = new Map<string, Room>();

	constructor(private readonly onRoomClosed?: (code: string) => void) {}

	createRoom(screen: Peer): { code: string; expiresInMs: number } {
		let code = generateRoomCode();
		while (this.rooms.has(code)) {
			code = generateRoomCode();
		}
		const room: Room = {
			code,
			screen,
			sender: null,
			expiryTimer: setTimeout(() => this.expireUnpaired(code), ROOM_TTL_MS),
			isCasting: false,
			lastCastLabel: null,
			lastCastStatus: null,
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
		// Reconexion a una sala que quedo en "pantalla sola" durante un
		// cast: quien se une ahora no tiene forma de saber que ya hay algo
		// en marcha ni en que punto va — se le manda antes de que nada mas.
		const resumed = room.isCasting
			? { label: room.lastCastLabel ?? "", status: room.lastCastStatus }
			: null;
		return { ok: true, resumed };
	}

	relay(code: string, from: Role, message: ServerMessage): void {
		const room = this.rooms.get(code);
		if (!room) return;
		if (message.type === "cast-status") {
			const { type: _type, ...status } = message;
			room.lastCastStatus = status;
		}
		const target = from === "screen" ? room.sender : room.screen;
		target?.send(message);
	}

	// Llamado por quien gestiona el cast (WS "cast-url", o el endpoint
	// HTTP de subida de fichero) en cuanto la pantalla recibe algo que
	// reproducir. Fija la etiqueta para poder reconstruir la UI del
	// emisor si reconecta despues.
	markCasting(code: string, label: string): void {
		const room = this.rooms.get(code);
		if (!room) return;
		room.isCasting = true;
		room.lastCastLabel = label;
	}

	isCasting(code: string): boolean {
		return this.rooms.get(code)?.isCasting ?? false;
	}

	sendToScreen(code: string, message: ServerMessage): void {
		this.rooms.get(code)?.screen.send(message);
	}

	sendToSender(code: string, message: ServerMessage): void {
		this.rooms.get(code)?.sender?.send(message);
	}

	leave(code: string, from: Role): void {
		const room = this.rooms.get(code);
		if (!room) return;
		if (room.expiryTimer) clearTimeout(room.expiryTimer);

		// La pantalla se va: no hay donde reproducir nada, la sala muere
		// siempre, cast o espejo. Es la misma regla de antes.
		if (from === "screen") {
			room.sender?.send({ type: "peer-left" });
			this.closeRoom(code);
			return;
		}

		// El emisor se va durante un espejo: sigue matando la sala, el
		// emisor ES la fuente del video (comportamiento sin cambios).
		if (!room.isCasting) {
			room.screen.send({ type: "peer-left" });
			this.closeRoom(code);
			return;
		}

		// El emisor se va durante un cast: la pantalla sigue reproduciendo
		// (ScreenView ignora "peer-left" mientras la fase sea "casting" —
		// a proposito, es justo la ventaja del cast). La sala NO muere
		// todavia: queda en "pantalla sola" con una ventana para reconectar
		// con el mismo codigo.
		room.sender = null;
		room.screen.send({ type: "peer-left" });
		room.expiryTimer = setTimeout(
			() => this.expireScreenAlone(code),
			SCREEN_ALONE_TTL_MS,
		);
	}

	has(code: string): boolean {
		return this.rooms.has(code);
	}

	private closeRoom(code: string): void {
		this.rooms.delete(code);
		this.onRoomClosed?.(code);
	}

	private expireUnpaired(code: string): void {
		const room = this.rooms.get(code);
		if (!room || room.sender) return; // ya emparejada: no caduca por esta via
		this.closeRoom(code);
	}

	// Se cumplio la ventana de "pantalla sola" sin que nadie reconectara
	// con el mismo codigo: esta vez la sala muere de verdad, y a
	// diferencia de un "peer-left" normal la pantalla debe darse por
	// enterada (volver a un codigo nuevo) — por eso es un mensaje aparte,
	// "screen-alone-expired", no otro "peer-left" que ScreenView
	// ignoraria durante el cast.
	private expireScreenAlone(code: string): void {
		const room = this.rooms.get(code);
		if (!room || room.sender) return; // alguien reconecto ya, nada que hacer
		room.screen.send({ type: "screen-alone-expired" });
		this.closeRoom(code);
	}
}
