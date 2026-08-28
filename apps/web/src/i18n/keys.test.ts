import { describe, expect, it } from "vitest";
import en from "./en.json";
import es from "./es.json";
import pt from "./pt.json";

describe("i18n key parity", () => {
	it("en, es and pt have exactly the same keys", () => {
		const enKeys = Object.keys(en).sort();
		expect(Object.keys(es).sort()).toEqual(enKeys);
		expect(Object.keys(pt).sort()).toEqual(enKeys);
	});
});
