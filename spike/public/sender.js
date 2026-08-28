// Pagina emisora (el Mac). Dibuja un reloj en un canvas, lo captura como
// MediaStream y lo manda por WebRTC forzando el codec elegido, para que la
// tele pueda probar H.264 y VP8 por separado.

const canvas = document.getElementById("clock");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

function log(line) {
	logEl.textContent += `${new Date().toISOString().slice(11, 23)}  ${line}\n`;
	logEl.scrollTop = logEl.scrollHeight;
}

// Reloj + bola rebotando: el numero confirma el instante exacto (para el
// metodo de foto+resta de latencia de M0), la bola confirma visualmente
// que hay movimiento real y no un frame congelado.
let ballX = 0;
let ballDir = 4;
function drawFrame() {
	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.fillStyle = "#fff";
	ctx.font = "64px ui-monospace, monospace";
	ctx.textAlign = "center";
	ctx.fillText(String(Date.now()), canvas.width / 2, canvas.height / 2);

	ballX += ballDir;
	if (ballX < 0 || ballX > canvas.width - 20) ballDir *= -1;
	ctx.fillStyle = "#2563eb";
	ctx.beginPath();
	ctx.arc(ballX + 10, canvas.height - 40, 10, 0, Math.PI * 2);
	ctx.fill();

	requestAnimationFrame(drawFrame);
}
drawFrame();

// ---------------------------------------------------------------- WS
function wsUrl() {
	return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?role=sender`;
}

let ws;
function connectWs() {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(wsUrl());
		socket.onopen = () => resolve(socket);
		socket.onerror = () => reject(new Error("ws error"));
	});
}

// ------------------------------------------------------------- WebRTC
// sessionId identifica cada intento: si el humano lanza H.264 y luego VP8
// sin esperar, un ICE candidate tardio del primero no se debe aplicar al
// RTCPeerConnection del segundo (ver mismo mecanismo en screen.js).
// No usamos crypto.randomUUID(): la Web Crypto API solo existe en contexto
// seguro (HTTPS o localhost), y esta pagina se abre por IP de LAN en HTTP
// plano a proposito (SPECS.md §4.4) — necesitaba solo un id de correlacion,
// no aleatoriedad criptografica.
function genSessionId() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

let activeSession = null; // { id, pc, pending }

function addOrQueueIce(session, candidate) {
	if (session.pc.remoteDescription) {
		session.pc
			.addIceCandidate(candidate)
			.catch((err) => log(`addIceCandidate failed: ${err.message}`));
	} else {
		session.pending.push(candidate);
	}
}

function flushQueuedIce(session) {
	for (const candidate of session.pending.splice(0)) {
		session.pc
			.addIceCandidate(candidate)
			.catch((err) => log(`addIceCandidate failed: ${err.message}`));
	}
}

async function runTest(codec) {
	statusEl.textContent = `${codec}: connecting...`;
	log(`starting ${codec} test`);

	if (!ws || ws.readyState !== WebSocket.OPEN) {
		ws = await connectWs();
		ws.addEventListener("message", onWsMessage);
	}

	if (activeSession) activeSession.pc.close();
	const pc = new RTCPeerConnection({ iceServers: [] });
	const sessionId = genSessionId();
	activeSession = { id: sessionId, pc, pending: [] };

	pc.onconnectionstatechange = () => {
		log(`${codec}: connection state = ${pc.connectionState}`);
		statusEl.textContent = `${codec}: ${pc.connectionState}`;
	};
	pc.onicecandidate = (ev) => {
		if (ev.candidate)
			ws.send(
				JSON.stringify({ type: "ice", sessionId, candidate: ev.candidate }),
			);
	};

	const stream = canvas.captureStream(30);
	const track = stream.getVideoTracks()[0];
	// streams: [stream] es lo que hace que el lado receptor vea ev.streams[0]
	// poblado en ontrack; sin esto llega vacio y no hay nada que asignar a
	// video.srcObject.
	const transceiver = pc.addTransceiver(track, {
		direction: "sendonly",
		streams: [stream],
	});

	if (transceiver.setCodecPreferences && RTCRtpSender.getCapabilities) {
		const caps = RTCRtpSender.getCapabilities("video");
		const mime = `video/${codec}`;
		const preferred = caps.codecs.filter(
			(c) => c.mimeType.toLowerCase() === mime,
		);
		const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== mime);
		if (preferred.length === 0) {
			log(
				`${codec}: not in this browser's getCapabilities() — offer will use default codec order`,
			);
		} else {
			transceiver.setCodecPreferences([...preferred, ...rest]);
		}
	}

	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);
	ws.send(
		JSON.stringify({
			type: "offer",
			codec,
			sessionId,
			sdp: pc.localDescription,
		}),
	);
}

function onWsMessage(ev) {
	const msg = JSON.parse(ev.data);
	if (!activeSession || (msg.sessionId && msg.sessionId !== activeSession.id)) {
		if (msg.type === "answer" || msg.type === "ice") return;
	}
	if (msg.type === "answer") {
		activeSession.pc
			.setRemoteDescription(msg.sdp)
			.then(() => flushQueuedIce(activeSession))
			.catch((err) => log(`setRemoteDescription failed: ${err.message}`));
	} else if (msg.type === "ice") {
		addOrQueueIce(activeSession, msg.candidate);
	} else if (msg.type === "error") {
		log(`server error: ${msg.reason}`);
		statusEl.textContent = msg.reason;
	} else if (msg.type === "peer-left") {
		log("screen disconnected");
	}
}

document
	.getElementById("btn-h264")
	.addEventListener("click", () =>
		runTest("h264").catch((err) => log(`error: ${err.message}`)),
	);
document
	.getElementById("btn-vp8")
	.addEventListener("click", () =>
		runTest("vp8").catch((err) => log(`error: ${err.message}`)),
	);

connectWs()
	.then((socket) => {
		ws = socket;
		ws.addEventListener("message", onWsMessage);
		log("connected to signaling server");
	})
	.catch((err) => log(`ws connect failed: ${err.message}`));
