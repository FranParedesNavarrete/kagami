// Comportamiento de los controles de cualquier reproductor de video
// (encargo de cierre de kagami, parte 2): visibles al aparecer, se
// esconden solos tras un tiempo sin interaccion, y cualquier actividad
// los devuelve y reinicia la cuenta. Logica pura y sin DOM aqui a
// proposito — la vista solo la conecta a addEventListener/onFocus, para
// poder probar las transiciones con temporizadores falsos sin montar
// ningun componente (no hay React Testing Library en este repo).
export const FULLSCREEN_BUTTON_HIDE_MS = 5_000;

type TimerId = ReturnType<typeof setTimeout>;
type SetTimeoutFn = (fn: () => void, ms: number) => TimerId;
type ClearTimeoutFn = (id: TimerId) => void;

export interface AutoHideControllerOptions {
	hideAfterMs: number;
	onVisibilityChange: (visible: boolean) => void;
	setTimeoutFn?: SetTimeoutFn;
	clearTimeoutFn?: ClearTimeoutFn;
}

export class AutoHideController {
	private visible = true;
	// El mando de webOS manda eventos de teclado, no toques ni clics — si
	// el boton tiene el foco (llegado por teclado) no se esconde, o se
	// vuelve inalcanzable desde el sofa sin raton.
	private focused = false;
	private timer: TimerId | null = null;
	private readonly hideAfterMs: number;
	private readonly onVisibilityChange: (visible: boolean) => void;
	private readonly setTimeoutFn: SetTimeoutFn;
	private readonly clearTimeoutFn: ClearTimeoutFn;

	constructor(opts: AutoHideControllerOptions) {
		this.hideAfterMs = opts.hideAfterMs;
		this.onVisibilityChange = opts.onVisibilityChange;
		// Nunca guardar `setTimeout`/`clearTimeout` del navegador tal cual:
		// invocarlos luego como `this.setTimeoutFn(...)` los llama con
		// `this` = esta instancia, no `window`, y el navegador real (a
		// diferencia de Node) exige que el receptor sea el objeto global —
		// lanza "Illegal invocation". Encontrado en el propio navegador
		// real durante el e2e (invisible en los tests unitarios, que corren
		// en Node): envolver en una arrow function evita el problema porque
		// la llamada interna a `setTimeout(...)` no pasa por ningun `this`.
		this.setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
		this.clearTimeoutFn = opts.clearTimeoutFn ?? ((id) => clearTimeout(id));
		this.armTimer();
	}

	private setVisible(next: boolean): void {
		if (this.visible === next) return;
		this.visible = next;
		this.onVisibilityChange(next);
	}

	private armTimer(): void {
		if (this.timer !== null) this.clearTimeoutFn(this.timer);
		this.timer = this.setTimeoutFn(() => {
			if (!this.focused) this.setVisible(false);
		}, this.hideAfterMs);
	}

	// Toque, movimiento de raton, o pulsacion de tecla: las tres cuentan
	// igual como actividad.
	noteActivity(): void {
		this.setVisible(true);
		this.armTimer();
	}

	setFocused(focused: boolean): void {
		this.focused = focused;
		if (focused) {
			this.setVisible(true);
			if (this.timer !== null) this.clearTimeoutFn(this.timer);
			this.timer = null;
		} else {
			this.armTimer();
		}
	}

	dispose(): void {
		if (this.timer !== null) this.clearTimeoutFn(this.timer);
		this.timer = null;
	}
}
