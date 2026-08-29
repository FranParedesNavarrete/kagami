import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

// <details> con resumen en vivo (encargo de rediseño, parte 6/7): el
// summary no es decorativo — es lo que hoy obliga a abrir seis filas
// de botones (o el desplegable de diagnostico) para saber en que
// configuracion se esta. `liveSummary` se recalcula en cada render con
// el estado actual, en --data (monoespaciada), igual que el resto de
// datos medidos.
interface Props {
	title: string;
	liveSummary: string;
	children: ReactNode;
	defaultOpen?: boolean;
}

export function Disclosure({
	title,
	liveSummary,
	children,
	defaultOpen = false,
}: Props) {
	return (
		<details
			open={defaultOpen}
			className="group rounded-md border border-line bg-ink-2"
		>
			<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
				<span>
					<span className="block text-sm font-semibold text-silver">
						{title}
					</span>
					<span className="block font-mono text-[11.5px] text-muted">
						{liveSummary}
					</span>
				</span>
				<ChevronDown
					size={15}
					className="shrink-0 text-faint transition-transform group-open:rotate-180"
				/>
			</summary>
			<div className="flex flex-col gap-4 border-t border-line px-3.5 py-3">
				{children}
			</div>
		</details>
	);
}
