import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = join(process.cwd(), "src");

// Clase de fallo que la auditoria de "ningun color fuera de los tokens"
// no puede ver (encargo "el azul del control de volumen"): quitar el
// anillo de foco por defecto sin dar una alternativa visible no deja
// ningun literal de color en el className — deja un elemento invisible
// para quien navega por teclado. `focus-visible:outline-none` (variante
// correcta del pseudo-selector) queda fuera de esta lista: solo se
// prohibe `focus:outline-none`, que ademas de ocultar el anillo pisa la
// regla global de :focus-visible en index.css por especificidad.
const FORBIDDEN_CLASS_FRAGMENT = "focus:outline-none";

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...sourceFiles(full));
		} else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
			files.push(full);
		}
	}
	return files;
}

describe("focus ring never silently suppressed", () => {
	it("no className removes the default focus outline without index.css's :focus-visible ring still applying", () => {
		const offenders = sourceFiles(srcDir)
			.map((f) => ({ f, text: readFileSync(f, "utf-8") }))
			.filter(({ text }) => text.includes(FORBIDDEN_CLASS_FRAGMENT))
			.map(({ f }) => f);

		expect(offenders).toEqual([]);
	});
});
