import { formatBytes, formatEta } from "../lib/format.js";
import { Button } from "./Button.js";

// Subida con barra, tiempo restante y cancelar (encargo de rediseño,
// parte 11): nombre, tamaño, barra, porcentaje, ETA calculada de la
// velocidad real (no del porcentaje solo), y el aviso de que se puede
// bloquear el telefono justo donde surge la duda.
interface Props {
	filename: string;
	sizeBytes: number;
	percent: number;
	bytesPerSec: number | null;
	onCancel: () => void;
	uploadingLabel: string;
	// Recibe el ETA ya calculado y devuelve la frase completa traducida
	// (p. ej. `(eta) => t("sender.uploadRemaining", { eta })`) — nunca
	// una etiqueta suelta a concatenar a mano: el orden de "queda(n)" y
	// el tiempo cambia entre idiomas.
	formatRemaining: (eta: string) => string;
	lockPhoneNotice: string;
	cancelLabel: string;
}

export function UploadProgress({
	filename,
	sizeBytes,
	percent,
	bytesPerSec,
	onCancel,
	uploadingLabel,
	formatRemaining,
	lockPhoneNotice,
	cancelLabel,
}: Props) {
	const remainingBytes = Math.max(0, sizeBytes * (1 - percent / 100));
	const eta =
		bytesPerSec !== null ? formatEta(remainingBytes, bytesPerSec) : "--";

	return (
		<div
			className="flex w-full flex-col gap-3"
			data-testid="cast-upload-status"
		>
			<div className="flex items-center justify-between gap-3">
				<p className="truncate text-sm font-medium text-silver">{filename}</p>
				<p className="shrink-0 font-mono text-xs text-muted">
					{formatBytes(sizeBytes)}
				</p>
			</div>
			<div className="h-1.5 overflow-hidden rounded-full bg-ink-3">
				<div
					className="h-full rounded-full bg-glass transition-[width] duration-300"
					style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
				/>
			</div>
			<div className="flex items-center justify-between text-xs text-muted">
				<span>{uploadingLabel}</span>
				<span className="font-mono">{formatRemaining(eta)}</span>
			</div>
			<p className="text-xs text-faint">{lockPhoneNotice}</p>
			<Button variant="secondary" onClick={onCancel} className="self-start">
				{cancelLabel}
			</Button>
		</div>
	);
}
