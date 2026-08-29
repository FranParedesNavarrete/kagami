import QRCode from "qrcode";
import { useEffect, useRef } from "react";

// El tamaño de pantalla real lo decide quien llama a este componente
// via className/style en el <canvas> (clamp() responsivo al ancho del
// viewport, encargo de rediseño parte 13) — `resolution` es solo la
// resolucion interna del canvas, fija y suficientemente alta para que
// no se vea borroso al tamaño maximo. Nivel de correccion de errores
// POR DEFECTO de la libreria (nunca subido a "H"): sin logo dentro del
// QR no hace falta, y el nivel por defecto genera un codigo menos
// denso — se escanea mejor de lejos (ver docs/registro.md).
export function QrCode({
	value,
	resolution = 300,
	className = "",
}: {
	value: string;
	resolution?: number;
	className?: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		if (!canvasRef.current) return;
		QRCode.toCanvas(canvasRef.current, value, {
			width: resolution,
			margin: 2,
		}).catch((err) => console.warn("qr render failed", err));
	}, [value, resolution]);

	return (
		<canvas
			ref={canvasRef}
			width={resolution}
			height={resolution}
			className={`block h-auto w-full ${className}`}
		/>
	);
}
