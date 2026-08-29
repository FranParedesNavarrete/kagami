import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Route } from "@playwright/test";

// Fixture diminuta (41KB, 3s, testsrc2+tono) committeada a proposito para
// que `pnpm run e2e` funcione de cero sin depender de ffmpeg en la
// maquina que lo ejecute — ver apps/server/scripts/gen-diag-videos.sh
// para el fixture (con ffmpeg) que SI hace falta para docs/spike-range.md.
// Compartida entre cast.spec.ts y screen-aspect.spec.ts.
export const FIXTURE = readFileSync(
	fileURLToPath(new URL("./fixtures/cast-test.mp4", import.meta.url)),
);

// Dominio inexistente a proposito: Playwright intercepta la peticion del
// <video> de la tele antes de que salga a red real (page.route), asi que
// nunca hace falta resolverlo. Esto prueba el protocolo (WS + <video>
// nativo), no si el server real sirve range requests contra la tele real
// — eso es exactamente lo que docs/spike-range.md cubre aparte.
export const CAST_URL = "http://cast-fixture.invalid/video.mp4";

// Un mock que solo devuelve 200 con el cuerpo entero (sin Accept-Ranges ni
// 206) hizo que Chromium marcara el video como "buffered" pero NO
// "seekable" (`video.seekable` vacio pese a tener todo el fichero en
// buffer) — un salto real necesita que el mock se comporte como un
// servidor de verdad, no solo entregar los bytes.
export function fulfillWithRangeSupport(route: Route): Promise<void> {
	const range = route.request().headers().range;
	if (!range) {
		return route.fulfill({
			status: 200,
			contentType: "video/mp4",
			headers: {
				"accept-ranges": "bytes",
				"content-length": String(FIXTURE.length),
			},
			body: FIXTURE,
		});
	}
	const match = /bytes=(\d*)-(\d*)/.exec(range);
	const start = match?.[1] ? Number(match[1]) : 0;
	const end = match?.[2] ? Number(match[2]) : FIXTURE.length - 1;
	return route.fulfill({
		status: 206,
		contentType: "video/mp4",
		headers: {
			"accept-ranges": "bytes",
			"content-range": `bytes ${start}-${end}/${FIXTURE.length}`,
			"content-length": String(end - start + 1),
		},
		body: FIXTURE.subarray(start, end + 1),
	});
}
