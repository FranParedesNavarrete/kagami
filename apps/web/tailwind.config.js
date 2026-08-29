/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {
		extend: {
			// Tokens del rediseño visual (encargo "rediseño visual de kagami"):
			// un único sitio donde están definidos, el resto del código usa
			// siempre el token (bg-ink, text-silver, etc.), nunca el literal.
			colors: {
				ink: {
					DEFAULT: "#0A0E0D",
					2: "#111716",
					3: "#182120",
					4: "#1F2A28",
				},
				line: {
					DEFAULT: "#253230",
					2: "#33423F",
				},
				silver: "#E9EFEC",
				muted: "#7A8B86",
				faint: "#4E5C58",
				glass: "#6FD9B9",
				"glass-dim": "#2A4B42",
				coral: "#E8877A",
				amber: "#E8C57A",
			},
			borderRadius: {
				sm: "6px",
				md: "10px",
				lg: "16px",
				xl: "22px",
			},
			spacing: {
				// Tailwind ya trae la mayoria de estos por defecto (4=1rem/4,
				// etc.) — declarados explicitos igualmente para que la escala
				// completa (4/8/12/16/24/32/48/64px) quede documentada en un
				// solo sitio, no repartida entre "lo que Tailwind trae de
				// serie" y "lo que añadimos".
				1: "4px",
				2: "8px",
				3: "12px",
				4: "16px",
				6: "24px",
				8: "32px",
				12: "48px",
				16: "64px",
			},
			fontFamily: {
				display: [
					"Archivo",
					"system-ui",
					"-apple-system",
					"Segoe UI",
					"sans-serif",
				],
				sans: [
					"IBM Plex Sans",
					"system-ui",
					"-apple-system",
					"Segoe UI",
					"sans-serif",
				],
				mono: [
					"IBM Plex Mono",
					"ui-monospace",
					"SFMono-Regular",
					"Menlo",
					"monospace",
				],
			},
		},
	},
	plugins: [],
};
