import { describe, expect, it } from "vitest";
import {
	ClientMessageSchema,
	ROOM_CODE_ALPHABET,
	RoomCodeSchema,
	ServerMessageSchema,
} from "./schemas.js";

describe("RoomCodeSchema", () => {
	it("accepts a 4-char code from the alphabet", () => {
		expect(RoomCodeSchema.safeParse("A2C4").success).toBe(true);
	});

	it("rejects ambiguous characters not in the alphabet", () => {
		for (const bad of ["O2C4", "I2C4", "S2C4", "B2C4", "abcd", "AB1"]) {
			expect(RoomCodeSchema.safeParse(bad).success).toBe(false);
		}
	});

	it("only uses characters from the documented alphabet", () => {
		expect(ROOM_CODE_ALPHABET).toBe("234679ACDEFGHJKMNPQRTUVWXYZ");
	});
});

describe("ClientMessageSchema", () => {
	it("accepts create-room and join-room", () => {
		expect(ClientMessageSchema.safeParse({ type: "create-room" }).success).toBe(
			true,
		);
		expect(
			ClientMessageSchema.safeParse({ type: "join-room", code: "A2C4" })
				.success,
		).toBe(true);
	});

	it("rejects an unknown message type", () => {
		expect(ClientMessageSchema.safeParse({ type: "hack" }).success).toBe(false);
	});

	it("rejects join-room with an invalid code", () => {
		expect(
			ClientMessageSchema.safeParse({ type: "join-room", code: "bad" }).success,
		).toBe(false);
	});

	it("accepts restart-ice with no payload", () => {
		expect(ClientMessageSchema.safeParse({ type: "restart-ice" }).success).toBe(
			true,
		);
	});
});

describe("ServerMessageSchema", () => {
	it("accepts a room-created message", () => {
		expect(
			ServerMessageSchema.safeParse({
				type: "room-created",
				code: "A2C4",
				expiresInMs: 600_000,
			}).success,
		).toBe(true);
	});

	it("accepts a known error code only", () => {
		expect(
			ServerMessageSchema.safeParse({
				type: "error",
				code: "room-not-found",
				message: "nope",
			}).success,
		).toBe(true);
		expect(
			ServerMessageSchema.safeParse({
				type: "error",
				code: "made-up",
				message: "nope",
			}).success,
		).toBe(false);
	});

	it("accepts restart-ice with no payload", () => {
		expect(ServerMessageSchema.safeParse({ type: "restart-ice" }).success).toBe(
			true,
		);
	});
});
