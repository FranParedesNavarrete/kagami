import { describe, expect, it } from "vitest";
import {
	ASPECT_MODES,
	containerStyleForAspect,
	videoObjectFitForAspect,
} from "./aspect.js";

describe("videoObjectFitForAspect", () => {
	it("never crops in the four modes that must show the whole frame", () => {
		// Requisito: en cualquier modo salvo "expanded", nada del fotograma
		// se oculta jamas — object-fit "cover" es lo unico que recorta, asi
		// que no puede aparecer fuera de "expanded".
		for (const mode of ASPECT_MODES) {
			if (mode === "expanded") continue;
			expect(videoObjectFitForAspect(mode)).not.toBe("cover");
		}
	});

	it("auto shows everything without deforming (contain)", () => {
		expect(videoObjectFitForAspect("auto")).toBe("contain");
	});

	it("expanded is the only mode allowed to crop (cover)", () => {
		expect(videoObjectFitForAspect("expanded")).toBe("cover");
	});

	it("fixed ratios stretch instead of cropping (fill)", () => {
		for (const mode of ["16:9", "21:9", "4:3"] as const) {
			expect(videoObjectFitForAspect(mode)).toBe("fill");
		}
	});
});

describe("containerStyleForAspect", () => {
	it("auto and expanded fill the whole viewport box", () => {
		for (const mode of ["auto", "expanded"] as const) {
			expect(containerStyleForAspect(mode)).toEqual({
				width: "100%",
				height: "100%",
			});
		}
	});

	it("fixed ratios use dvh/dvw, never plain vh/vw", () => {
		// El bug de scrollbar en webOS: vh incluye area oculta bajo su
		// barra. dvh/dvw es la unidad correcta, ver index.css.
		for (const mode of ["16:9", "21:9", "4:3"] as const) {
			const style = containerStyleForAspect(mode);
			expect(String(style.width)).toContain("dvw");
			expect(String(style.width)).toContain("dvh");
			expect(String(style.width)).not.toMatch(/\bvw\b/);
			expect(String(style.width)).not.toMatch(/\bvh\b/);
			expect(String(style.height)).toContain("dvh");
			expect(String(style.height)).toContain("dvw");
		}
	});

	it("fixed ratios set an explicit aspect-ratio matching the mode", () => {
		expect(containerStyleForAspect("16:9").aspectRatio).toBe(`${16 / 9}`);
		expect(containerStyleForAspect("21:9").aspectRatio).toBe(`${21 / 9}`);
		expect(containerStyleForAspect("4:3").aspectRatio).toBe(`${4 / 3}`);
	});
});
