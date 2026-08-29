import { isFirefox, isSafari } from "./browserDetect.js";

// getDisplayMedia solo captura audio de SISTEMA en navegadores basados en
// Chromium — Safari y Firefox lo ignoran del todo (Safari) o no lo
// soportan (Firefox), y en Linux depende del compositor. La via (b)
// (dispositivo de entrada via getUserMedia) es lo que permite mandar
// audio de sistema en esos casos, apoyandose en un dispositivo virtual
// (BlackHole en macOS, Loopback, o el monitor de PulseAudio en Linux) —
// ver docs/audio-source.md para el montaje.
export type AudioSource = "system" | "input-device" | "none";

export function supportsSystemAudioCapture(): boolean {
	return !isSafari() && !isFirefox();
}

const STORAGE_KEY = "kagami-audio-source";

export function loadAudioSource(): AudioSource {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		if (value === "system" || value === "input-device" || value === "none")
			return value;
	} catch {
		// localStorage puede fallar (modo privado, cuota); usar el valor por defecto.
	}
	return supportsSystemAudioCapture() ? "system" : "none";
}

export function saveAudioSource(source: AudioSource): void {
	try {
		localStorage.setItem(STORAGE_KEY, source);
	} catch {
		// no critico
	}
}

const DEVICE_STORAGE_KEY = "kagami-audio-device-id";

export function loadAudioDeviceId(): string | null {
	try {
		return localStorage.getItem(DEVICE_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function saveAudioDeviceId(deviceId: string): void {
	try {
		localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
	} catch {
		// no critico
	}
}

export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
	const devices = await navigator.mediaDevices.enumerateDevices();
	return devices.filter((d) => d.kind === "audioinput");
}

export type MicrophoneAccessError = "denied" | "not-found" | "other";

// Safari solo revela deviceId/label de enumerateDevices() tras una llamada
// a getUserMedia que resuelva en ESTE documento, y exige que nazca de una
// interaccion real del usuario (por eso esto se llama desde el manejador
// de clic del boton, nunca desde un efecto). Si se concede permiso y no se
// va a usar el stream todavia, se paran las pistas de inmediato.
export async function requestMicrophoneAccess(): Promise<MicrophoneAccessError | null> {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		for (const track of stream.getTracks()) track.stop();
		return null;
	} catch (err) {
		if (err instanceof DOMException && err.name === "NotAllowedError")
			return "denied";
		if (err instanceof DOMException && err.name === "NotFoundError")
			return "not-found";
		return "other";
	}
}

export interface AudioDeviceSelection {
	devices: MediaDeviceInfo[];
	selectedId: string | null;
}

// Sin permiso concedido, el navegador no da una lista vacia: da una unica
// entrada anonima por tipo de dispositivo (deviceId y label vacios). Se
// descarta aqui para no confundirla con un dispositivo real.
function hasUsableId(device: MediaDeviceInfo): boolean {
	return device.deviceId !== "";
}

// "default" y "communications" son alias que Chrome añade sobre un
// dispositivo real, no dispositivos nuevos — preseleccionar uno de ellos
// puede apuntar a lo que el usuario NO eligio a proposito. Se prefiere
// siempre un id concreto.
export function pickDefaultAudioDevice(
	devices: MediaDeviceInfo[],
): string | null {
	const concrete = devices.find(
		(d) => d.deviceId !== "default" && d.deviceId !== "communications",
	);
	return (concrete ?? devices[0])?.deviceId ?? null;
}

export function deriveAudioDeviceSelection(
	rawDevices: MediaDeviceInfo[],
	currentSelectedId: string | null,
): AudioDeviceSelection {
	const devices = rawDevices.filter(hasUsableId);
	if (devices.length === 0) return { devices: [], selectedId: null };
	const keepCurrent =
		currentSelectedId !== null &&
		devices.some((d) => d.deviceId === currentSelectedId);
	return {
		devices,
		selectedId: keepCurrent
			? currentSelectedId
			: pickDefaultAudioDevice(devices),
	};
}

// echoCancellation/noiseSuppression/autoGainControl a false en las dos
// vias: es audio de sistema (musica, un video, un juego), no una voz en
// videollamada — el AGC es precisamente lo que sube y baja el volumen
// solo. Confirmado con el volcado de constraints real: sin esto,
// echoReturnLoss quedaba en -30, senal de que el procesado seguia activo
// pese a pedir audio "en bruto".
export const RAW_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
	echoCancellation: false,
	noiseSuppression: false,
	autoGainControl: false,
};

export interface CapturedMedia {
	stream: MediaStream;
	hasAudio: boolean;
}

// Combina video (siempre por getDisplayMedia) y audio (system: del mismo
// getDisplayMedia; input-device: un getUserMedia aparte sobre el
// dispositivo elegido; none: nada) en un unico MediaStream para que el
// resto del codigo (RTCPeerConnection, limpieza de pistas) no tenga que
// saber de donde vino cada pista.
export async function captureMedia(
	videoConstraints: MediaTrackConstraints,
	audioSource: AudioSource,
	audioDeviceId: string | null,
): Promise<CapturedMedia> {
	const wantsSystemAudio = audioSource === "system";
	const displayStream = await navigator.mediaDevices.getDisplayMedia({
		video: videoConstraints,
		audio: wantsSystemAudio ? RAW_AUDIO_CONSTRAINTS : false,
	});

	const tracks: MediaStreamTrack[] = [...displayStream.getVideoTracks()];

	if (wantsSystemAudio) {
		tracks.push(...displayStream.getAudioTracks());
	} else if (audioSource === "input-device" && audioDeviceId) {
		const micStream = await navigator.mediaDevices.getUserMedia({
			audio: { ...RAW_AUDIO_CONSTRAINTS, deviceId: { exact: audioDeviceId } },
		});
		tracks.push(...micStream.getAudioTracks());
	}

	return {
		stream: new MediaStream(tracks),
		hasAudio: tracks.some((t) => t.kind === "audio"),
	};
}
