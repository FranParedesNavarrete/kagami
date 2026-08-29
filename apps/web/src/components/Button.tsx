import type { ButtonHTMLAttributes, ReactNode } from "react";

// Botones consistentes en toda la app (encargo de rediseño): el azul
// desaparece, el boton principal pasa a ser --silver con texto --ink
// ("un espejo no tiene color propio, devuelve luz"). --glass se
// reserva a estado/foco/detalles, nunca a fondo de boton.
export type ButtonVariant = "primary" | "secondary" | "link" | "danger";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
	primary:
		"bg-silver text-ink hover:bg-white disabled:bg-ink-4 disabled:text-faint",
	secondary:
		"bg-ink-3 text-silver border border-line hover:bg-ink-4 hover:border-line-2 disabled:text-faint disabled:border-line",
	danger:
		"bg-ink-3 text-coral border border-coral/30 hover:bg-ink-4 hover:border-coral/50",
	// "Back to start"/"Cast a different URL" eran enlaces subrayados —
	// pasan a botones reales (encargo, parte 3), pero visualmente
	// discretos: sin fondo, color --glass, --silver al pasar por encima.
	link: "bg-transparent text-glass hover:text-silver px-0 py-0",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	icon?: ReactNode;
}

export function Button({
	variant = "secondary",
	icon,
	className = "",
	children,
	...rest
}: Props) {
	const sizing = variant === "link" ? "" : "rounded-md px-4 py-2.5 text-sm";
	return (
		<button
			type="button"
			className={`inline-flex cursor-pointer items-center justify-center gap-2 font-medium transition-colors ${sizing} ${VARIANT_CLASSES[variant]} ${className}`}
			{...rest}
		>
			{icon}
			{children}
		</button>
	);
}
