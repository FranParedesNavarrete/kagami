import { spawn } from "node:child_process";
import { rename } from "node:fs/promises";

// Comprobado una sola vez por proceso: si ffmpeg no esta instalado,
// spawnearlo en cada subida solo para fallar es ruido innecesario en
// los logs. Si alguna vez cambia (instalacion en caliente, poco
// probable), un reinicio del server lo vuelve a comprobar.
let ffmpegAvailableCache: boolean | null = null;

export async function isFfmpegAvailable(): Promise<boolean> {
	if (ffmpegAvailableCache !== null) return ffmpegAvailableCache;
	ffmpegAvailableCache = await new Promise<boolean>((resolve) => {
		const proc = spawn("ffmpeg", ["-version"]);
		proc.on("error", () => resolve(false));
		proc.on("exit", (code) => resolve(code === 0));
	});
	return ffmpegAvailableCache;
}

export interface RemuxProgress {
	percent: number | null;
}

// Remuxea a un fichero temporal al lado del original y solo al terminar
// bien lo renombra ENCIMA del original — nunca deja el fichero servible
// a medio remuxear. "-c copy" no recodifica nada, solo reordena las
// cajas del contenedor (mueve "moov" al principio): por eso es rapido
// incluso para ficheros de varios GB, es trabajo de E/S, no de CPU.
export async function remuxToFaststart(
	inputPath: string,
	onProgress?: (progress: RemuxProgress) => void,
): Promise<void> {
	const outputPath = `${inputPath}.faststart.tmp`;

	await new Promise<void>((resolve, reject) => {
		const proc = spawn("ffmpeg", [
			"-y",
			"-i",
			inputPath,
			"-c",
			"copy",
			"-movflags",
			"+faststart",
			"-progress",
			"pipe:1",
			"-nostats",
			// El fichero final siempre es .mp4, pero el temporal termina en
			// ".faststart.tmp" — sin "-f mp4" explicito, ffmpeg intenta
			// adivinar el contenedor por la extension del fichero de SALIDA
			// y falla con "Unable to choose an output format" (medido:
			// exit code 234). Nunca depender de la extension para esto.
			"-f",
			"mp4",
			outputPath,
		]);

		// ffmpeg imprime "Duration: HH:MM:SS.ss" del fichero de entrada en
		// stderr al arrancar — es la unica forma de calcular un porcentaje
		// sin llamar aparte a ffprobe.
		let durationSec: number | null = null;
		let stderrTail = "";
		proc.stderr?.on("data", (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString()).slice(-4000);
			if (durationSec === null) {
				const match = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderrTail);
				if (match) {
					const [, h, m, s] = match;
					durationSec = Number(h) * 3600 + Number(m) * 60 + Number(s);
				}
			}
		});

		let stdoutTail = "";
		proc.stdout?.on("data", (chunk: Buffer) => {
			stdoutTail = (stdoutTail + chunk.toString()).slice(-256);
			const match = /out_time_ms=(\d+)/.exec(stdoutTail);
			if (match?.[1] && durationSec) {
				const elapsedSec = Number(match[1]) / 1_000_000;
				const percent = Math.max(
					0,
					Math.min(100, Math.round((elapsedSec / durationSec) * 100)),
				);
				onProgress?.({ percent });
			}
		});

		proc.on("error", reject);
		proc.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited with code ${code}`));
		});
	});

	await rename(outputPath, inputPath);
}
