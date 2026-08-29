import { describe, expect, it } from "vitest";
import {
	deriveAudioDeviceSelection,
	pickDefaultAudioDevice,
} from "./audioSource.js";

function device(deviceId: string, label = ""): MediaDeviceInfo {
	return {
		deviceId,
		label,
		kind: "audioinput",
		groupId: "g",
		toJSON: () => ({}),
	} as MediaDeviceInfo;
}

describe("deriveAudioDeviceSelection", () => {
	it("descarta entradas anonimas (deviceId vacio) sin permiso concedido", () => {
		const result = deriveAudioDeviceSelection([device("")], null);
		expect(result.devices).toEqual([]);
		expect(result.selectedId).toBeNull();
	});

	it("muestra ambos dispositivos etiquetados y preselecciona el que no es default", () => {
		const defaultDevice = device("default", "Default — MacBook Pro Microphone");
		const blackhole = device("abc123", "BlackHole 2ch");
		const result = deriveAudioDeviceSelection([defaultDevice, blackhole], null);
		expect(result.devices).toEqual([defaultDevice, blackhole]);
		expect(result.selectedId).toBe("abc123");
	});

	it("mantiene la seleccion actual si sigue en la lista", () => {
		const a = device("aaa", "A");
		const b = device("bbb", "B");
		const result = deriveAudioDeviceSelection([a, b], "bbb");
		expect(result.selectedId).toBe("bbb");
	});

	it("recalcula la seleccion si el dispositivo elegido desaparecio", () => {
		const a = device("aaa", "A");
		const result = deriveAudioDeviceSelection([a], "ya-no-existe");
		expect(result.selectedId).toBe("aaa");
	});
});

describe("pickDefaultAudioDevice", () => {
	it("devuelve null sin dispositivos", () => {
		expect(pickDefaultAudioDevice([])).toBeNull();
	});

	it("evita default y communications si hay un dispositivo concreto", () => {
		const devices = [
			device("default", "Default"),
			device("communications", "Communications"),
			device("real-id", "BlackHole 2ch"),
		];
		expect(pickDefaultAudioDevice(devices)).toBe("real-id");
	});

	it("cae en el primero si todos son default/communications", () => {
		const devices = [device("default", "Default")];
		expect(pickDefaultAudioDevice(devices)).toBe("default");
	});
});
