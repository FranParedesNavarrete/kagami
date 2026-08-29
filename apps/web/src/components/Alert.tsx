import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

// Componente de alerta unico para toda la app (encargo de rediseño,
// parte 9): borde e interior teñidos del color semantico al 30%/7% de
// opacidad, icono, titular en --silver, explicacion debajo, y siempre
// una accion de salida cuando la hay. "error" es --coral (fallos de
// reproduccion, subida, union a sala); "warning" es --amber (el aviso
// de DRM usa esta variante).
export type AlertVariant = "error" | "warning";

const VARIANT_STYLES: Record<
	AlertVariant,
	{ border: string; bg: string; icon: string }
> = {
	error: {
		border: "border-coral/30",
		bg: "bg-coral/[0.07]",
		icon: "text-coral",
	},
	warning: {
		border: "border-amber/30",
		bg: "bg-amber/[0.07]",
		icon: "text-amber",
	},
};

interface Props {
	variant: AlertVariant;
	title: string;
	children?: ReactNode;
	actions?: ReactNode;
}

export function Alert({ variant, title, children, actions }: Props) {
	const styles = VARIANT_STYLES[variant];
	const Icon = variant === "warning" ? TriangleAlert : CircleAlert;
	return (
		<div
			role="alert"
			className={`w-full rounded-lg border ${styles.border} ${styles.bg} p-4`}
		>
			<div className="flex gap-3">
				<Icon size={20} className={`mt-0.5 shrink-0 ${styles.icon}`} />
				<div className="flex flex-col gap-1 text-left">
					<p className="font-medium text-silver">{title}</p>
					{children && <p className="text-sm text-muted">{children}</p>}
					{actions && (
						<div className="mt-2 flex flex-wrap gap-2">{actions}</div>
					)}
				</div>
			</div>
		</div>
	);
}
