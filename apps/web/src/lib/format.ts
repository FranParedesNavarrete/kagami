// Formateo puro compartido entre vistas (encargo de rediseño): nunca
// literales repetidos a mano en cada componente.

export function formatTime(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds)) return "--:--";
	const total = Math.max(0, Math.round(seconds));
	const mins = Math.floor(total / 60);
	const secs = total % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
	if (bytes === 0) return "0 B";
	const exp = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		UNITS.length - 1,
	);
	const value = bytes / 1024 ** exp;
	return `${exp === 0 ? value : value.toFixed(1)} ${UNITS[exp]}`;
}

// Estimacion de tiempo restante a partir de la velocidad REAL medida
// (bytes ya subidos / tiempo transcurrido), nunca del porcentaje solo
// — un porcentaje no dice nada de cuanto queda si la subida se ha
// ralentizado o acelerado por el camino.
export function formatEta(remainingBytes: number, bytesPerSec: number): string {
	if (bytesPerSec <= 0 || !Number.isFinite(bytesPerSec)) return "--";
	const remainingSec = remainingBytes / bytesPerSec;
	if (remainingSec < 60) return `${Math.max(1, Math.round(remainingSec))}s`;
	const mins = Math.round(remainingSec / 60);
	return `${mins} min`;
}
