import { Logo } from "./Logo.js";

// La marca completa (simbolo + palabra), siempre que haya sitio —
// encargo de rediseño, parte 14. El simbolo suelto (Logo.tsx) queda
// solo para favicon/manifest, donde no cabe la palabra.
interface Props {
	size?: number;
	className?: string;
}

export function Lockup({ size = 22, className = "" }: Props) {
	return (
		<div className={`flex items-center gap-2 text-silver ${className}`}>
			<Logo size={size} />
			<span className="font-display text-lg font-semibold tracking-tight">
				kagami
			</span>
		</div>
	);
}
