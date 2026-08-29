// Control segmentado generico — reemplaza las filas de botones sueltos
// (modo, codec, resolucion, calidad, tipo de contenido, aspecto) por un
// unico componente reutilizable con el mismo estilo en toda la app.
interface Option<T extends string> {
	value: T;
	label: string;
}

interface Props<T extends string> {
	options: readonly Option<T>[];
	value: T;
	onChange: (value: T) => void;
	"aria-label"?: string;
}

export function Segmented<T extends string>({
	options,
	value,
	onChange,
	"aria-label": ariaLabel,
}: Props<T>) {
	return (
		// <fieldset> en vez de role="group" (sugerencia de a11y de biome):
		// un fieldset por defecto trae min-width:auto (rompe flex-wrap) y un
		// margen propio — reseteados con min-w-0/m-0. El <legend> va oculto
		// visualmente (sr-only): la etiqueta ya se ve en el texto de al lado.
		<fieldset className="m-0 inline-flex min-w-0 flex-wrap gap-1 rounded-md border border-line bg-ink-2 p-1">
			{ariaLabel && <legend className="sr-only">{ariaLabel}</legend>}
			{options.map((opt) => (
				<button
					key={opt.value}
					type="button"
					aria-pressed={opt.value === value}
					onClick={() => onChange(opt.value)}
					// bg-silver queda reservado al boton principal de cada
					// pantalla (encargo, parte 1) — el segmento activo se marca
					// con ink-4 + texto silver, nunca con relleno silver/glass.
					className={`cursor-pointer rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
						opt.value === value
							? "bg-ink-4 text-silver"
							: "text-muted hover:bg-ink-4/60 hover:text-silver"
					}`}
				>
					{opt.label}
				</button>
			))}
		</fieldset>
	);
}
