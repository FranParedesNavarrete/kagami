import { useId } from "react";

// Simbolo de la marca: una pantalla, la costura del espejo, y el
// reflejo desvaneciendose en --glass. Mismo trazado que
// apps/web/src/assets/logo.svg (el fichero vive tambien ahi, y en
// apps/web/public/logo.svg, para referenciarlo fuera de React) —
// inline aqui porque `currentColor` solo hereda el color del texto
// cuando el SVG esta en el propio DOM, no cuando se carga por
// `<img src>`. El id del gradiente se genera por instancia (useId):
// un id fijo chocaria si el logo aparece mas de una vez en la pagina
// (los <defs> de SVG son globales al documento).
interface Props {
	size?: number;
	className?: string;
}

export function Logo({ size = 24, className }: Props) {
	const gradientId = useId();
	return (
		<svg
			viewBox="0 0 48 48"
			width={size}
			height={size}
			fill="none"
			className={className}
			role="img"
			aria-label="kagami"
		>
			<defs>
				<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#6FD9B9" stopOpacity="0.62" />
					<stop offset="1" stopColor="#6FD9B9" stopOpacity="0" />
				</linearGradient>
			</defs>
			<rect x="9" y="7" width="30" height="16" rx="5" fill="currentColor" />
			<rect
				x="6"
				y="24.4"
				width="36"
				height="1.4"
				rx="0.7"
				fill="currentColor"
				opacity="0.38"
			/>
			<rect
				x="9"
				y="27.2"
				width="30"
				height="16"
				rx="5"
				fill={`url(#${gradientId})`}
			/>
		</svg>
	);
}
