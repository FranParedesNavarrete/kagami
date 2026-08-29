import { open } from "node:fs/promises";

interface Box {
	type: string;
	offset: number;
	size: number;
}

// Solo las cajas de NIVEL SUPERIOR importan aqui — nunca hace falta
// descender dentro de "moov" o "mdat" para esto. Un mp4/mov real no
// tiene mas de un puñado de cajas de nivel superior (ftyp, moov, mdat,
// free, wide...), asi que un limite generoso basta como red de
// seguridad contra un fichero corrupto con cajas de tamaño invalido.
const MAX_BOXES = 64;

async function readTopLevelBoxes(filePath: string): Promise<Box[]> {
	const handle = await open(filePath, "r");
	try {
		const { size: fileSize } = await handle.stat();
		const boxes: Box[] = [];
		const header = Buffer.alloc(16);
		let offset = 0;

		while (offset < fileSize && boxes.length < MAX_BOXES) {
			const { bytesRead } = await handle.read({
				buffer: header,
				position: offset,
				length: 16,
			});
			if (bytesRead < 8) break;

			const type = header.toString("ascii", 4, 8);
			let size = header.readUInt32BE(0);
			let headerSize = 8;
			if (size === 1) {
				// tamaño extendido de 64 bits en los 8 bytes siguientes
				if (bytesRead < 16) break;
				size = Number(header.readBigUInt64BE(8));
				headerSize = 16;
			} else if (size === 0) {
				// "hasta el final del fichero" — valido solo en la ultima caja
				size = fileSize - offset;
			}
			if (size < headerSize) break; // caja corrupta, no seguir leyendo

			boxes.push({ type, offset, size });
			offset += size;
		}

		return boxes;
	} finally {
		await handle.close();
	}
}

// La causa clasica de que un salto no funcione en un mp4/mov, y no
// tiene nada que ver con las range requests del servidor (ver
// docs/spike-range.md): si la caja "mdat" (los datos de vídeo/audio en
// si) aparece ANTES que "moov" (el indice de tiempos), el reproductor
// tiene que descargarse el fichero casi entero para encontrar el
// indice antes de poder saltar a ningun sitio.
//
// Devuelve null si el fichero no es un mp4/mov reconocible (p. ej. un
// webm, o algo corrupto) — en ese caso no hay nada que remuxear con
// este mecanismo, y quien llama debe servir el fichero tal cual.
export async function needsFaststartRemux(
	filePath: string,
): Promise<boolean | null> {
	const boxes = await readTopLevelBoxes(filePath);
	const moov = boxes.find((b) => b.type === "moov");
	const mdat = boxes.find((b) => b.type === "mdat");
	if (!moov || !mdat) return null;
	return mdat.offset < moov.offset;
}
