import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import es from "./es.json";
import pt from "./pt.json";

const srcDir = join(process.cwd(), "src");

// Prefijos de claves que solo se construyen dinamicamente (con un
// backtick o una funcion `xKey(...)`) a partir de un tipo/enum ya
// cerrado (MediaErrorKind, los codigos de error de union de sala, o
// AspectMode) — nunca aparecen como literal completo en el codigo, asi
// que el escaner de uso no las ve. Antes de anadir un prefijo aqui,
// confirma que hay un tipo cerrado detras: si no lo hay, la clave
// puede estar realmente huerfana.
const DYNAMIC_KEY_PREFIXES = [
	"mediaError.",
	"sender.joinError.",
	"sender.aspectHint.",
	"lang.",
];

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...sourceFiles(full));
		} else if (
			/\.(ts|tsx)$/.test(entry.name) &&
			!/\.test\.(ts|tsx)$/.test(entry.name)
		) {
			files.push(full);
		}
	}
	return files;
}

function isUsed(key: string, allSource: string): boolean {
	if (allSource.includes(`"${key}"`) || allSource.includes(`'${key}'`)) {
		return true;
	}
	return DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

describe("i18n key parity", () => {
	it("en, es and pt have exactly the same keys", () => {
		const enKeys = Object.keys(en).sort();
		expect(Object.keys(es).sort()).toEqual(enKeys);
		expect(Object.keys(pt).sort()).toEqual(enKeys);
	});

	it("no en.json key is orphaned (unused outside of literal or documented dynamic construction)", () => {
		const allSource = sourceFiles(srcDir)
			.map((f) => readFileSync(f, "utf-8"))
			.join("\n");

		const orphans = Object.keys(en).filter((key) => !isUsed(key, allSource));

		expect(orphans).toEqual([]);
	});
});
