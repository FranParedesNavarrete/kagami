import { describe, expect, it } from "vitest";
import {
	CastUrlSchema,
	ClientMessageSchema,
	EnvSchema,
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

	it("accepts set-aspect-mode with a valid mode, rejects an unknown one", () => {
		expect(
			ClientMessageSchema.safeParse({ type: "set-aspect-mode", mode: "16:9" })
				.success,
		).toBe(true);
		expect(
			ClientMessageSchema.safeParse({ type: "set-aspect-mode", mode: "32:9" })
				.success,
		).toBe(false);
	});
});

describe("CastUrlSchema", () => {
	it("accepts http and https URLs", () => {
		expect(
			CastUrlSchema.safeParse("https://example.com/video.mp4").success,
		).toBe(true);
		expect(
			CastUrlSchema.safeParse("http://192.168.1.5/video.webm").success,
		).toBe(true);
	});

	it("rejects any scheme other than http/https", () => {
		for (const bad of [
			"javascript:alert(1)",
			"data:text/html,hi",
			"file:///etc/passwd",
			"ftp://example.com/video.mp4",
		]) {
			expect(CastUrlSchema.safeParse(bad).success).toBe(false);
		}
	});

	it("rejects a string that isn't a URL at all", () => {
		expect(CastUrlSchema.safeParse("not a url").success).toBe(false);
	});
});

describe("cast messages in ClientMessageSchema/ServerMessageSchema", () => {
	it("accepts cast-url with a valid scheme, rejects an invalid one", () => {
		expect(
			ClientMessageSchema.safeParse({
				type: "cast-url",
				url: "https://example.com/a.mp4",
			}).success,
		).toBe(true);
		expect(
			ClientMessageSchema.safeParse({
				type: "cast-url",
				url: "javascript:alert(1)",
			}).success,
		).toBe(false);
	});

	it("accepts cast-play/cast-pause with no payload", () => {
		expect(ClientMessageSchema.safeParse({ type: "cast-play" }).success).toBe(
			true,
		);
		expect(ClientMessageSchema.safeParse({ type: "cast-pause" }).success).toBe(
			true,
		);
	});

	it("accepts cast-seek with a non-negative position, rejects a negative one", () => {
		expect(
			ClientMessageSchema.safeParse({ type: "cast-seek", positionSec: 12.5 })
				.success,
		).toBe(true);
		expect(
			ClientMessageSchema.safeParse({ type: "cast-seek", positionSec: -1 })
				.success,
		).toBe(false);
	});

	it("accepts cast-volume within 0..1, rejects out of range", () => {
		expect(
			ClientMessageSchema.safeParse({ type: "cast-volume", volume: 0.5 })
				.success,
		).toBe(true);
		expect(
			ClientMessageSchema.safeParse({ type: "cast-volume", volume: 1.5 })
				.success,
		).toBe(false);
	});

	it("accepts a full cast-status round trip", () => {
		const status = {
			type: "cast-status" as const,
			currentTimeSec: 12.3,
			durationSec: 120,
			paused: false,
			ended: false,
			volume: 0.8,
			errorMessage: null,
		};
		expect(ClientMessageSchema.safeParse(status).success).toBe(true);
		expect(ServerMessageSchema.safeParse(status).success).toBe(true);
	});

	it("rejects cast-status without volume", () => {
		const status = {
			type: "cast-status" as const,
			currentTimeSec: 0,
			durationSec: null,
			paused: true,
			ended: false,
			errorMessage: null,
		};
		expect(ServerMessageSchema.safeParse(status).success).toBe(false);
	});
});

describe("cast-file messages (server -> client only)", () => {
	it("accepts cast-file-processing with a percent or with null (unknown progress)", () => {
		expect(
			ServerMessageSchema.safeParse({
				type: "cast-file-processing",
				percent: 42,
			}).success,
		).toBe(true);
		expect(
			ServerMessageSchema.safeParse({
				type: "cast-file-processing",
				percent: null,
			}).success,
		).toBe(true);
	});

	it("accepts cast-file-ready with path, filename and seekMayNotWork", () => {
		expect(
			ServerMessageSchema.safeParse({
				type: "cast-file-ready",
				path: "/cast/files/A2C4/abc123.mp4",
				filename: "movie.mp4",
				seekMayNotWork: false,
			}).success,
		).toBe(true);
	});

	it("accepts cast-file-error with a message", () => {
		expect(
			ServerMessageSchema.safeParse({
				type: "cast-file-error",
				message: "file too large",
			}).success,
		).toBe(true);
	});

	it("accepts cast-resumed and screen-alone-expired", () => {
		expect(
			ServerMessageSchema.safeParse({
				type: "cast-resumed",
				label: "movie.mp4",
			}).success,
		).toBe(true);
		expect(
			ServerMessageSchema.safeParse({ type: "screen-alone-expired" }).success,
		).toBe(true);
	});

	it("rejects cast-file-ready as a client message (server -> client only)", () => {
		expect(
			ClientMessageSchema.safeParse({
				type: "cast-file-ready",
				path: "/x",
				filename: "x.mp4",
				seekMayNotWork: false,
			}).success,
		).toBe(false);
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

	it("accepts set-aspect-mode with a valid mode", () => {
		expect(
			ServerMessageSchema.safeParse({
				type: "set-aspect-mode",
				mode: "expanded",
			}).success,
		).toBe(true);
	});
});

describe("EnvSchema", () => {
	it("defaults KAGAMI_REMUX_FASTSTART to false when unset", () => {
		expect(EnvSchema.parse({}).KAGAMI_REMUX_FASTSTART).toBe(false);
	});

	it('treats "true" and "1" as enabled', () => {
		expect(
			EnvSchema.parse({ KAGAMI_REMUX_FASTSTART: "true" })
				.KAGAMI_REMUX_FASTSTART,
		).toBe(true);
		expect(
			EnvSchema.parse({ KAGAMI_REMUX_FASTSTART: "1" }).KAGAMI_REMUX_FASTSTART,
		).toBe(true);
	});

	it('treats anything else, including the literal string "false", as disabled', () => {
		for (const value of ["false", "0", "no", "TRUE"]) {
			expect(
				EnvSchema.parse({ KAGAMI_REMUX_FASTSTART: value })
					.KAGAMI_REMUX_FASTSTART,
			).toBe(false);
		}
	});
});
