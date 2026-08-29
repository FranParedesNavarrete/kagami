// Pildora de estado en la barra superior (encargo de rediseño, parte
// 7): punto con pulso suave + texto en lenguaje normal. El pulso
// respeta prefers-reduced-motion via la regla global de index.css
// (transition/animation-duration a 0.01ms), asi que no hace falta
// logica aqui — solo declarar la animacion con Tailwind. "live" pulsa
// en --glass (en directo/reproduciendo), "bad" es un punto fijo en
// --coral (error), "neutral" es un punto fijo en --faint (sala
// abierta sin actividad, o desconectado).
export type StatusTone = "live" | "bad" | "neutral";

interface Props {
	label: string;
	tone?: StatusTone;
}

const DOT_COLOR: Record<StatusTone, string> = {
	live: "bg-glass",
	bad: "bg-coral",
	neutral: "bg-faint",
};

export function StatusPill({ label, tone = "neutral" }: Props) {
	return (
		<div
			data-testid="status-pill"
			className="inline-flex items-center gap-2 rounded-full border border-line bg-ink-2 px-3 py-1.5 text-sm text-silver"
		>
			<span className="relative flex h-2 w-2">
				{tone === "live" && (
					<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-glass opacity-60" />
				)}
				<span
					className={`relative inline-flex h-2 w-2 rounded-full ${DOT_COLOR[tone]}`}
				/>
			</span>
			{label}
		</div>
	);
}
