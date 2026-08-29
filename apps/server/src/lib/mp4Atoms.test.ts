import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { needsFaststartRemux } from "./mp4Atoms.js";

// Caja mp4 minima: tamaño (4 bytes big-endian) + tipo (4 bytes ascii) +
// contenido de relleno — no hace falta que sea un mp4 valido de verdad,
// needsFaststartRemux solo mira las cajas de nivel superior.
function box(type: string, contentSize = 8): Buffer {
	const size = 8 + contentSize;
	const header = Buffer.alloc(8);
	header.writeUInt32BE(size, 0);
	header.write(type, 4, "ascii");
	return Buffer.concat([header, Buffer.alloc(contentSize)]);
}

describe("needsFaststartRemux", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "kagami-mp4-test-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("false cuando moov viene antes que mdat (faststart)", async () => {
		const file = join(dir, "faststart.mp4");
		await writeFile(
			file,
			Buffer.concat([box("ftyp"), box("moov", 200), box("mdat", 5000)]),
		);
		expect(await needsFaststartRemux(file)).toBe(false);
	});

	it("true cuando mdat viene antes que moov (plain)", async () => {
		const file = join(dir, "plain.mp4");
		await writeFile(
			file,
			Buffer.concat([box("ftyp"), box("mdat", 5000), box("moov", 200)]),
		);
		expect(await needsFaststartRemux(file)).toBe(true);
	});

	it("null cuando el fichero no tiene moov ni mdat reconocibles (no es mp4/mov)", async () => {
		const file = join(dir, "not-mp4.bin");
		await writeFile(file, Buffer.from("esto no es un contenedor mp4"));
		expect(await needsFaststartRemux(file)).toBe(null);
	});

	it("no revienta con un fichero vacio o truncado a mitad de cabecera", async () => {
		const empty = join(dir, "empty.mp4");
		await writeFile(empty, Buffer.alloc(0));
		expect(await needsFaststartRemux(empty)).toBe(null);

		const truncated = join(dir, "truncated.mp4");
		await writeFile(truncated, Buffer.alloc(4)); // menos de una cabecera de caja
		expect(await needsFaststartRemux(truncated)).toBe(null);
	});
});
