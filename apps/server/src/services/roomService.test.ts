import { ROOM_TTL_MS, SCREEN_ALONE_TTL_MS } from "@kagami/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Peer, RoomService } from "./roomService.js";

function fakePeer(): Peer & { send: ReturnType<typeof vi.fn> } {
	return { send: vi.fn() };
}

describe("RoomService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates a room and lets a sender join it", () => {
		const rooms = new RoomService();
		const screen = fakePeer();
		const { code } = rooms.createRoom(screen);

		const sender = fakePeer();
		const result = rooms.joinRoom(code, sender);

		expect(result.ok).toBe(true);
		expect(screen.send).toHaveBeenCalledWith({ type: "peer-joined" });
	});

	it("rejects joining a code that does not exist", () => {
		const rooms = new RoomService();
		const result = rooms.joinRoom("ZZZZ", fakePeer());
		expect(result).toEqual({ ok: false, reason: "room-not-found" });
	});

	it("does not admit a second sender once paired", () => {
		const rooms = new RoomService();
		const { code } = rooms.createRoom(fakePeer());
		rooms.joinRoom(code, fakePeer());

		const secondSender = fakePeer();
		const result = rooms.joinRoom(code, secondSender);

		expect(result).toEqual({ ok: false, reason: "room-full" });
		expect(secondSender.send).not.toHaveBeenCalled();
	});

	it("expires an unpaired room after the TTL", () => {
		const rooms = new RoomService();
		const { code } = rooms.createRoom(fakePeer());

		vi.advanceTimersByTime(ROOM_TTL_MS + 1);

		expect(rooms.has(code)).toBe(false);
		expect(rooms.joinRoom(code, fakePeer())).toEqual({
			ok: false,
			reason: "room-not-found",
		});
	});

	it("does not expire a paired room after the TTL", () => {
		const rooms = new RoomService();
		const { code } = rooms.createRoom(fakePeer());
		rooms.joinRoom(code, fakePeer());

		vi.advanceTimersByTime(ROOM_TTL_MS * 3);

		expect(rooms.has(code)).toBe(true);
	});

	it("relays a message from the sender to the screen", () => {
		const rooms = new RoomService();
		const screen = fakePeer();
		const { code } = rooms.createRoom(screen);
		rooms.joinRoom(code, fakePeer());

		rooms.relay(code, "sender", {
			type: "offer",
			sdp: { type: "offer", sdp: "v=0" },
		});

		expect(screen.send).toHaveBeenCalledWith({
			type: "offer",
			sdp: { type: "offer", sdp: "v=0" },
		});
	});

	it("relays a restart-ice request from the screen to the sender", () => {
		const rooms = new RoomService();
		const sender = fakePeer();
		const { code } = rooms.createRoom(fakePeer());
		rooms.joinRoom(code, sender);

		rooms.relay(code, "screen", { type: "restart-ice" });

		expect(sender.send).toHaveBeenCalledWith({ type: "restart-ice" });
	});

	it("relays a message from the screen to the sender", () => {
		const rooms = new RoomService();
		const sender = fakePeer();
		const { code } = rooms.createRoom(fakePeer());
		rooms.joinRoom(code, sender);

		rooms.relay(code, "screen", {
			type: "answer",
			sdp: { type: "answer", sdp: "v=0" },
		});

		expect(sender.send).toHaveBeenCalledWith({
			type: "answer",
			sdp: { type: "answer", sdp: "v=0" },
		});
	});

	it("does nothing when relaying to a room with no peer yet", () => {
		const rooms = new RoomService();
		const { code } = rooms.createRoom(fakePeer());
		expect(() =>
			rooms.relay(code, "screen", {
				type: "answer",
				sdp: { type: "answer", sdp: "v=0" },
			}),
		).not.toThrow();
	});

	it("notifies the other side and deletes the room when the sender leaves", () => {
		const rooms = new RoomService();
		const screen = fakePeer();
		const { code } = rooms.createRoom(screen);
		rooms.joinRoom(code, fakePeer());

		rooms.leave(code, "sender");

		expect(screen.send).toHaveBeenCalledWith({ type: "peer-left" });
		expect(rooms.has(code)).toBe(false);
	});

	it("notifies the other side and deletes the room when the screen leaves", () => {
		const rooms = new RoomService();
		const sender = fakePeer();
		const { code } = rooms.createRoom(fakePeer());
		rooms.joinRoom(code, sender);

		rooms.leave(code, "screen");

		expect(sender.send).toHaveBeenCalledWith({ type: "peer-left" });
		expect(rooms.has(code)).toBe(false);
	});

	it("does not reuse a code after its room is gone", () => {
		const rooms = new RoomService();
		const { code } = rooms.createRoom(fakePeer());
		rooms.joinRoom(code, fakePeer());
		rooms.leave(code, "sender");

		expect(rooms.joinRoom(code, fakePeer())).toEqual({
			ok: false,
			reason: "room-not-found",
		});
	});

	it("calls onRoomClosed with the code whenever a room truly closes", () => {
		const onRoomClosed = vi.fn();
		const rooms = new RoomService(onRoomClosed);
		const { code } = rooms.createRoom(fakePeer());
		rooms.joinRoom(code, fakePeer());
		rooms.leave(code, "sender");

		expect(onRoomClosed).toHaveBeenCalledWith(code);
		expect(onRoomClosed).toHaveBeenCalledTimes(1);
	});

	describe("asimetria del cast (SPECS.md §6)", () => {
		it("el emisor desconectandose durante un cast NO mata la sala", () => {
			const onRoomClosed = vi.fn();
			const rooms = new RoomService(onRoomClosed);
			const screen = fakePeer();
			const { code } = rooms.createRoom(screen);
			rooms.joinRoom(code, fakePeer());
			rooms.markCasting(code, "https://example.com/movie.mp4");

			rooms.leave(code, "sender");

			expect(rooms.has(code)).toBe(true);
			expect(onRoomClosed).not.toHaveBeenCalled();
			// la pantalla SI se entera (ScreenView decide ignorarlo durante
			// el cast, pero el mensaje se manda igual que siempre)
			expect(screen.send).toHaveBeenCalledWith({ type: "peer-left" });
		});

		it("el mismo codigo reconecta y recibe la etiqueta + el ultimo estado real", () => {
			const rooms = new RoomService();
			const screen = fakePeer();
			const { code } = rooms.createRoom(screen);
			rooms.joinRoom(code, fakePeer());
			rooms.markCasting(code, "movie.mp4");
			rooms.relay(code, "screen", {
				type: "cast-status",
				currentTimeSec: 42.5,
				durationSec: 120,
				paused: true,
				ended: false,
				volume: 0.6,
				errorMessage: null,
			});
			rooms.leave(code, "sender");

			const result = rooms.joinRoom(code, fakePeer());

			expect(result.ok).toBe(true);
			expect(result.ok && result.resumed).toEqual({
				label: "movie.mp4",
				status: {
					currentTimeSec: 42.5,
					durationSec: 120,
					paused: true,
					ended: false,
					volume: 0.6,
					errorMessage: null,
				},
			});
		});

		it("sin cast en marcha, reconectar no manda 'resumed' (comportamiento normal de espejo)", () => {
			const rooms = new RoomService();
			const { code } = rooms.createRoom(fakePeer());
			rooms.joinRoom(code, fakePeer());
			// espejo: el emisor yendose mata la sala, no hay "pantalla sola"
			rooms.leave(code, "sender");
			expect(rooms.has(code)).toBe(false);
		});

		it("la pantalla desconectandose SIEMPRE mata la sala, este casteando o no", () => {
			const rooms = new RoomService();
			const sender = fakePeer();
			const { code } = rooms.createRoom(fakePeer());
			rooms.joinRoom(code, sender);
			rooms.markCasting(code, "movie.mp4");

			rooms.leave(code, "screen");

			expect(rooms.has(code)).toBe(false);
			expect(sender.send).toHaveBeenCalledWith({ type: "peer-left" });
		});

		it("pasada la ventana de pantalla sola sin reconectar, la sala muere y la pantalla recibe screen-alone-expired", () => {
			const rooms = new RoomService();
			const screen = fakePeer();
			const { code } = rooms.createRoom(screen);
			rooms.joinRoom(code, fakePeer());
			rooms.markCasting(code, "movie.mp4");
			rooms.leave(code, "sender");

			vi.advanceTimersByTime(SCREEN_ALONE_TTL_MS + 1);

			expect(rooms.has(code)).toBe(false);
			expect(screen.send).toHaveBeenCalledWith({
				type: "screen-alone-expired",
			});
		});

		it("reconectar dentro de la ventana cancela el cierre por tiempo", () => {
			const rooms = new RoomService();
			const screen = fakePeer();
			const { code } = rooms.createRoom(screen);
			rooms.joinRoom(code, fakePeer());
			rooms.markCasting(code, "movie.mp4");
			rooms.leave(code, "sender");

			rooms.joinRoom(code, fakePeer());
			vi.advanceTimersByTime(SCREEN_ALONE_TTL_MS + 1);

			expect(rooms.has(code)).toBe(true);
			expect(screen.send).not.toHaveBeenCalledWith({
				type: "screen-alone-expired",
			});
		});
	});
});
