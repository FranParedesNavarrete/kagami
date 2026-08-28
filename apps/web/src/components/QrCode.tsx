import QRCode from "qrcode";
import { useEffect, useRef } from "react";

export function QrCode({
	value,
	size = 200,
}: { value: string; size?: number }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		if (!canvasRef.current) return;
		QRCode.toCanvas(canvasRef.current, value, { width: size, margin: 1 }).catch(
			(err) => console.warn("qr render failed", err),
		);
	}, [value, size]);

	return (
		<canvas
			ref={canvasRef}
			width={size}
			height={size}
			className="rounded-lg bg-white p-2"
		/>
	);
}
