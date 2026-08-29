import { Pause, Play, RotateCcw, RotateCw, Volume2 } from "lucide-react";

// Fila de controles de reproduccion (encargo de rediseño, parte 12):
// retroceder 10s, reproducir/pausa (el grande, en --silver), avanzar
// 10s, y el volumen recogido junto a su icono. Los iconos de salto son
// flechas circulares con el "10" dentro — RotateCcw/RotateCw de
// lucide, nunca Rewind/FastForward (esas sugieren velocidad continua,
// no un salto de un tamaño fijo). Los tres botones miden 38px, para
// que sigan siendo pulsables desde lejos con el dedo o el mando.
const BUTTON_SIZE = 38;

interface Props {
	paused: boolean;
	onPlayPause: () => void;
	onSkipBack: () => void;
	onSkipForward: () => void;
	volume: number;
	onVolumeChange: (volume: number) => void;
	playPauseTestId?: string;
	volumeTestId?: string;
	volumeLabel: string;
	skipLabels: { back: string; forward: string; playPause: string };
}

export function PlaybackControls({
	paused,
	onPlayPause,
	onSkipBack,
	onSkipForward,
	volume,
	onVolumeChange,
	playPauseTestId,
	volumeTestId,
	volumeLabel,
	skipLabels,
}: Props) {
	return (
		<div className="flex w-full items-center gap-3">
			<button
				type="button"
				onClick={onSkipBack}
				aria-label={skipLabels.back}
				title={skipLabels.back}
				style={{ height: BUTTON_SIZE, width: BUTTON_SIZE }}
				className="relative grid shrink-0 cursor-pointer place-items-center rounded-full text-silver hover:bg-ink-4"
			>
				<RotateCcw size={BUTTON_SIZE} strokeWidth={1.4} />
				<span className="absolute font-mono text-[10px] font-medium">10</span>
			</button>

			<button
				type="button"
				data-testid={playPauseTestId}
				onClick={onPlayPause}
				aria-label={skipLabels.playPause}
				title={skipLabels.playPause}
				style={{ height: BUTTON_SIZE, width: BUTTON_SIZE }}
				className="grid shrink-0 cursor-pointer place-items-center rounded-full bg-silver text-ink hover:bg-white"
			>
				{paused ? (
					<Play size={20} fill="currentColor" />
				) : (
					<Pause size={20} fill="currentColor" />
				)}
			</button>

			<button
				type="button"
				onClick={onSkipForward}
				aria-label={skipLabels.forward}
				title={skipLabels.forward}
				style={{ height: BUTTON_SIZE, width: BUTTON_SIZE }}
				className="relative grid shrink-0 cursor-pointer place-items-center rounded-full text-silver hover:bg-ink-4"
			>
				<RotateCw size={BUTTON_SIZE} strokeWidth={1.4} />
				<span className="absolute font-mono text-[10px] font-medium">10</span>
			</button>

			<div className="ml-auto flex min-w-0 flex-1 items-center gap-2">
				<Volume2 size={18} className="shrink-0 text-muted" />
				<input
					type="range"
					data-testid={volumeTestId}
					aria-label={volumeLabel}
					min={0}
					max={1}
					step={0.01}
					value={volume}
					onChange={(e) => onVolumeChange(Number(e.target.value))}
					className="w-full"
				/>
			</div>
		</div>
	);
}
