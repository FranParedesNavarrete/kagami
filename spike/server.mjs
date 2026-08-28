// Servidor minimo del spike M-1: HTTP plano (estatico + range requests) y
// señalizacion WS para las pruebas de la pagina de la tele. No es apps/server
// (eso llega en M0): aqui solo hace falta lo justo para que la tele decida.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.KAGAMI_SPIKE_PORT ?? 7421);
const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".mp4": "video/mp4",
};

const ROUTES = {
	"/": "screen.html",
	"/screen": "screen.html",
	"/sender": "sender.html",
};

function resolvePath(urlPath) {
	const relative = ROUTES[urlPath] ?? urlPath.replace(/^\/+/, "");
	const resolved = normalize(join(PUBLIC_DIR, relative));
	if (!resolved.startsWith(PUBLIC_DIR)) return null;
	return resolved;
}

function serveStatic(req, res) {
	const urlPath = decodeURIComponent(req.url.split("?")[0]);
	const filePath = resolvePath(urlPath);
	if (!filePath) {
		res.writeHead(400).end("bad path");
		return;
	}

	let stat;
	try {
		stat = statSync(filePath);
	} catch {
		res.writeHead(404).end("not found");
		return;
	}

	const contentType =
		MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
	const range = req.headers.range;

	// El test M-1 "video por HTTP con range requests" depende de esto: sin
	// soportar Range, el <video> de la tele no puede saltar a mitad.
	if (range) {
		const match = /bytes=(\d*)-(\d*)/.exec(range);
		const start = match[1] ? Number(match[1]) : 0;
		const end = match[2] ? Number(match[2]) : stat.size - 1;
		if (start >= stat.size || end >= stat.size || start > end) {
			res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
			return;
		}
		res.writeHead(206, {
			"Content-Type": contentType,
			"Content-Range": `bytes ${start}-${end}/${stat.size}`,
			"Accept-Ranges": "bytes",
			"Content-Length": end - start + 1,
		});
		createReadStream(filePath, { start, end }).pipe(res);
		return;
	}

	res.writeHead(200, {
		"Content-Type": contentType,
		"Accept-Ranges": "bytes",
		"Content-Length": stat.size,
	});
	createReadStream(filePath).pipe(res);
}

const server = createServer(serveStatic);

// Señalizacion: solo dos papeles a la vez (spike, no salas reales). El
// server unicamente reenvia offer/answer/ice al otro lado y responde a los
// eco de prueba de WS.
const peers = { screen: null, sender: null };
const other = (role) => (role === "sender" ? "screen" : "sender");

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
	const role = new URL(req.url, "http://localhost").searchParams.get("role");
	if (role !== "screen" && role !== "sender") {
		ws.close(1008, "role invalido");
		return;
	}

	peers[role] = ws;
	console.log(`[ws] ${role} conectado`);

	ws.on("message", (raw) => {
		let msg;
		try {
			msg = JSON.parse(raw.toString());
		} catch {
			console.warn("[ws] mensaje no-json rechazado");
			return;
		}

		if (msg.type === "echo") {
			ws.send(JSON.stringify({ type: "echo", t: msg.t }));
			return;
		}

		if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
			const target = peers[other(role)];
			if (!target) {
				ws.send(
					JSON.stringify({ type: "error", reason: "peer-not-connected" }),
				);
				return;
			}
			target.send(JSON.stringify({ ...msg, from: role }));
			return;
		}

		console.warn(`[ws] tipo de mensaje desconocido: ${msg.type}`);
	});

	ws.on("close", () => {
		if (peers[role] === ws) peers[role] = null;
		console.log(`[ws] ${role} desconectado`);
		const target = peers[other(role)];
		if (target) target.send(JSON.stringify({ type: "peer-left", role }));
	});
});

server.listen(PORT, () => {
	console.log(`kagami spike M-1 escuchando en http://0.0.0.0:${PORT}`);
	console.log(`  tele:   http://<esta-maquina>:${PORT}/`);
	console.log(`  emisor: http://<esta-maquina>:${PORT}/sender`);
});
