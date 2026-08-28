import { describe, expect, it } from "vitest";
import { generateRoomCode } from "./roomCode.js";
import {
	ROOM_CODE_ALPHABET,
	ROOM_CODE_LENGTH,
	RoomCodeSchema,
} from "./schemas.js";

describe("generateRoomCode", () => {
	it("generates a code that passes RoomCodeSchema", () => {
		for (let i = 0; i < 50; i++) {
			expect(RoomCodeSchema.safeParse(generateRoomCode()).success).toBe(true);
		}
	});

	it("only draws from the documented alphabet", () => {
		const code = generateRoomCode();
		expect(code).toHaveLength(ROOM_CODE_LENGTH);
		for (const char of code) {
			expect(ROOM_CODE_ALPHABET.includes(char)).toBe(true);
		}
	});
});
