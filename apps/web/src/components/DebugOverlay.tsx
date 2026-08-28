// Panel de diagnostico tras ?debug=1 (ver docs/webrtc-quality.md).
// Deliberadamente sin i18n: es una herramienta de diagnostico tecnico,
// no UI de cara al usuario.
export function DebugOverlay({
	title,
	rows,
}: { title: string; rows: Record<string, string> }) {
	return (
		<div className="fixed bottom-4 left-4 z-50 rounded-lg bg-black/85 p-3 font-mono text-xs text-lime-400 shadow-lg">
			<div className="mb-1 font-bold text-white">{title}</div>
			{Object.entries(rows).map(([key, value]) => (
				<div key={key}>
					{key}: {value}
				</div>
			))}
		</div>
	);
}
