import {
	type ClientMessage,
	type ServerMessage,
	ServerMessageSchema,
} from "@kagami/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export type WsStatus = "connecting" | "open" | "closed";

function wsUrl(): string {
	const proto = location.protocol === "https:" ? "wss" : "ws";
	return `${proto}://${location.host}/ws`;
}

// Capa fina sobre el WebSocket: valida cada mensaje entrante contra el
// esquema compartido (CODESTYLE.md §2 — un mensaje invalido se descarta,
// nunca se procesa "a ver si cuela") y reparte a quien se haya suscrito.
export function useSignaling() {
	const [status, setStatus] = useState<WsStatus>("connecting");
	const wsRef = useRef<WebSocket | null>(null);
	const listenersRef = useRef(new Set<(msg: ServerMessage) => void>());

	useEffect(() => {
		const ws = new WebSocket(wsUrl());
		wsRef.current = ws;

		ws.onopen = () => setStatus("open");
		ws.onclose = () => setStatus("closed");
		ws.onmessage = (ev) => {
			let raw: unknown;
			try {
				raw = JSON.parse(ev.data);
			} catch {
				return;
			}
			const parsed = ServerMessageSchema.safeParse(raw);
			if (!parsed.success) {
				console.warn("dropped invalid server message", parsed.error.issues);
				return;
			}
			for (const listener of listenersRef.current) listener(parsed.data);
		};

		return () => ws.close();
	}, []);

	const send = useCallback((message: ClientMessage) => {
		wsRef.current?.send(JSON.stringify(message));
	}, []);

	const subscribe = useCallback((listener: (msg: ServerMessage) => void) => {
		listenersRef.current.add(listener);
		return () => {
			listenersRef.current.delete(listener);
		};
	}, []);

	return { status, send, subscribe };
}
