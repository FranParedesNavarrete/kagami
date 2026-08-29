import { ROOM_CODE_ALPHABET } from "@kagami/shared";
import { useRef, useState } from "react";

const LENGTH = 4;

// Cuatro celdas de un caracter (encargo de rediseño, parte 10):
// avance automatico al escribir, retroceso al borrar sobre un campo
// vacio, mayusculas automaticas, filtrado al alfabeto de salas ya
// existente, y entra solo al completar el cuarto caracter — un boton
// que solo se pulsa cuando ya has terminado de escribir es un paso de
// mas.
interface Props {
	onComplete: (code: string) => void;
}

export function CodeInput({ onComplete }: Props) {
	const [cells, setCells] = useState<string[]>(["", "", "", ""]);
	const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

	function setCell(index: number, char: string) {
		const next = [...cells];
		next[index] = char;
		setCells(next);
		if (char && index < LENGTH - 1) {
			inputRefs.current[index + 1]?.focus();
		}
		if (next.every((c) => c !== "")) {
			onComplete(next.join(""));
		}
	}

	function handleChange(index: number, raw: string) {
		// El navegador puede entregar mas de un caracter (pegar, o el
		// propio input aceptando varios antes de aplicar maxLength) —
		// quedarse siempre con el ULTIMO caracter tecleado de verdad.
		const upper = raw.toUpperCase();
		const char = upper.slice(-1);
		if (char && !ROOM_CODE_ALPHABET.includes(char)) return;
		setCell(index, char);
	}

	function handleKeyDown(
		index: number,
		e: React.KeyboardEvent<HTMLInputElement>,
	) {
		if (e.key === "Backspace" && cells[index] === "" && index > 0) {
			e.preventDefault();
			const next = [...cells];
			next[index - 1] = "";
			setCells(next);
			inputRefs.current[index - 1]?.focus();
		}
	}

	function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
		const text = e.clipboardData
			.getData("text")
			.toUpperCase()
			.split("")
			.filter((c) => ROOM_CODE_ALPHABET.includes(c));
		if (text.length === 0) return;
		e.preventDefault();
		const next = ["", "", "", ""];
		for (let i = 0; i < LENGTH; i++) next[i] = text[i] ?? "";
		setCells(next);
		const lastFilled = Math.min(text.length, LENGTH) - 1;
		inputRefs.current[Math.max(lastFilled, 0)]?.focus();
		if (next.every((c) => c !== "")) onComplete(next.join(""));
	}

	return (
		<div className="flex gap-2" data-testid="home-code-input">
			{cells.map((char, i) => (
				<input
					// biome-ignore lint/suspicious/noArrayIndexKey: el indice es la identidad de cada celda (posicion fija, nunca se reordenan)
					key={i}
					ref={(el) => {
						inputRefs.current[i] = el;
					}}
					value={char}
					onChange={(e) => handleChange(i, e.target.value)}
					onKeyDown={(e) => handleKeyDown(i, e)}
					onPaste={handlePaste}
					maxLength={1}
					inputMode="text"
					autoCapitalize="characters"
					aria-label={`Room code character ${i + 1}`}
					className="h-14 w-12 cursor-text rounded-md border border-line bg-ink-3 text-center font-mono text-2xl font-medium uppercase text-silver focus:border-glass"
				/>
			))}
		</div>
	);
}
