// Pagina receptora (la tele). Corre las seis pruebas de M-1 y pinta el
// resultado en grande. Lo que necesita al emisor (H.264/VP8, estabilidad)
// se queda en "esperando" hasta que se abra /sender en el Mac: no falla
// por timeout, porque abrir el emisor es un paso humano.

const TESTS = [
  { id: 'ws', name: 'WebSocket: connect + echo + reconnect (30s)' },
  { id: 'rtc-h264', name: 'RTCPeerConnection recvonly — H.264' },
  { id: 'rtc-vp8', name: 'RTCPeerConnection recvonly — VP8' },
  { id: 'video-range', name: '<video> HTTP range requests (seek to middle)' },
  { id: 'autoplay', name: 'Autoplay without interaction' },
  { id: 'stability', name: 'Stability, 10 min of connected video' },
];

const rows = {};
const testsEl = document.getElementById('tests');
for (const t of TESTS) {
  const row = document.createElement('div');
  row.className = 'test-row';
  row.innerHTML = `<div class="dot" id="dot-${t.id}"></div>
    <div class="test-name">${t.name}<div class="test-detail" id="detail-${t.id}">pending</div></div>`;
  testsEl.appendChild(row);
  rows[t.id] = row;
}

function setStatus(id, status, detail) {
  document.getElementById(`dot-${id}`).className = `dot ${status}`;
  if (detail !== undefined) document.getElementById(`detail-${id}`).textContent = detail;
}

document.getElementById('ua').textContent = navigator.userAgent;

// ---------------------------------------------------------------- WebSocket
let ws;
let stabilityStarted = false;

function wsUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=screen`;
}

function echoOnce(socket, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = performance.now();
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'echo' && msg.t === t) {
        clearTimeout(timer);
        socket.removeEventListener('message', onMsg);
        resolve(performance.now() - t);
      }
    };
    socket.addEventListener('message', onMsg);
    socket.send(JSON.stringify({ type: 'echo', t }));
  });
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl());
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error('ws error'));
  });
}

async function runWsTest() {
  setStatus('ws', 'running', 'connecting...');
  try {
    ws = await connectWs();
    setupSignalingHandlers(ws);
    const rtt1 = await echoOnce(ws);
    setStatus('ws', 'running', `echo ok (${rtt1.toFixed(0)}ms) — waiting 30s to test reconnect`);

    await new Promise((r) => setTimeout(r, 30_000));
    ws.close();
    ws = await connectWs();
    setupSignalingHandlers(ws);
    const rtt2 = await echoOnce(ws);
    setStatus('ws', 'pass', `connect ${rtt1.toFixed(0)}ms, reconnect+echo ${rtt2.toFixed(0)}ms`);
  } catch (err) {
    setStatus('ws', 'fail', err.message);
  }
}

// -------------------------------------------------------- WebRTC recvonly
// sessionId identifica cada intento (H.264 y VP8 son intentos distintos):
// evita que un ICE candidate tardio de una prueba ya cerrada se aplique al
// RTCPeerConnection de la siguiente.
let activeSession = null; // { id, pc }

function setupSignalingHandlers(socket) {
  socket.addEventListener('message', async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'offer') await handleOffer(msg);
    else if (msg.type === 'ice' && activeSession && msg.sessionId === activeSession.id) {
      addOrQueueIce(activeSession, msg.candidate);
    } else if (msg.type === 'peer-left' && msg.role === 'sender') {
      console.log('sender disconnected');
    }
  });
}

function addOrQueueIce(session, candidate) {
  if (session.pc.remoteDescription) {
    session.pc.addIceCandidate(candidate).catch((err) => console.warn('ice add failed', err));
  } else {
    session.pending.push(candidate);
  }
}

function flushQueuedIce(session) {
  for (const candidate of session.pending.splice(0)) {
    session.pc.addIceCandidate(candidate).catch((err) => console.warn('ice add failed', err));
  }
}

async function handleOffer(msg) {
  const codec = msg.codec; // 'h264' | 'vp8'
  const testId = codec === 'h264' ? 'rtc-h264' : 'rtc-vp8';
  setStatus(testId, 'running', 'received offer, connecting...');

  if (activeSession) {
    activeSession.pc.close();
  }

  const pc = new RTCPeerConnection({ iceServers: [] });
  activeSession = { id: msg.sessionId, pc, pending: [] };

  const video = document.getElementById('rtcVideo');
  let framesConfirmed = false;

  pc.ontrack = (ev) => {
    // ev.streams puede llegar vacio segun como el emisor asocie el track;
    // construir el MediaStream a mano es la via robusta.
    video.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
    // El atributo autoplay del HTML no siempre basta cuando srcObject se
    // asigna por JS despues de la carga: play() explicito es lo fiable.
    video.play().catch((err) => console.warn(`[${testId}] video.play() rechazado`, err));
    const start = video.currentTime;
    setTimeout(() => {
      if (video.currentTime > start) {
        framesConfirmed = true;
        setStatus(testId, 'pass', `frames playing (${pc.connectionState})`);
        if (!stabilityStarted) startStabilityTest(video);
      } else {
        setStatus(testId, 'fail', 'track received but no frames advanced');
      }
    }, 2000);
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate) ws.send(JSON.stringify({ type: 'ice', sessionId: msg.sessionId, candidate: ev.candidate }));
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState) && !framesConfirmed) {
      setStatus(testId, 'fail', pc.connectionState);
    }
  };

  try {
    await pc.setRemoteDescription(msg.sdp);
    flushQueuedIce(activeSession);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', sessionId: msg.sessionId, sdp: pc.localDescription }));
  } catch (err) {
    setStatus(testId, 'fail', err.message);
  }
}

// --------------------------------------------------------- video (range)
async function runVideoRangeTest() {
  setStatus('video-range', 'running', 'loading...');
  const video = document.createElement('video');
  video.src = '/test-video.mp4';
  video.muted = true;
  video.preload = 'auto';

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 15_000);
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = video.duration / 2;
    });
    video.addEventListener('seeked', () => {
      clearTimeout(timer);
      const mid = video.duration / 2;
      const ok = Math.abs(video.currentTime - mid) < 1 && video.readyState >= 2;
      resolve({ ok, reason: ok ? `seeked to ${video.currentTime.toFixed(1)}s` : 'seek landed off-target' });
    });
    video.addEventListener('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'load error' });
    });
  });

  setStatus('video-range', result.ok ? 'pass' : 'fail', result.reason);
}

// ------------------------------------------------------------- autoplay
async function runAutoplayTest() {
  setStatus('autoplay', 'running', 'attempting play()...');
  const video = document.createElement('video');
  video.src = '/test-video.mp4';
  video.muted = true;
  video.playsInline = true;

  try {
    await video.play();
    await new Promise((r) => setTimeout(r, 500));
    const ok = video.currentTime > 0;
    setStatus('autoplay', ok ? 'pass' : 'fail', ok ? 'played without interaction' : 'play() resolved but no progress');
  } catch (err) {
    setStatus('autoplay', 'fail', `blocked: ${err.message}`);
  }
}

// ------------------------------------------------------------ stability
function startStabilityTest(video) {
  stabilityStarted = true;
  setStatus('stability', 'running', 'monitoring for 10 min...');
  const startedAt = performance.now();
  const durationMs = 10 * 60 * 1000;
  const rtts = [];
  let spikes = 0;

  const pingInterval = setInterval(async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const rtt = await echoOnce(ws, 5000);
      rtts.push(rtt);
      if (rtt > 200) spikes++;
    } catch {
      spikes++;
    }
  }, 1000);

  const uiInterval = setInterval(() => {
    const elapsedMs = performance.now() - startedAt;
    document.getElementById('st-elapsed').textContent = `${(elapsedMs / 1000).toFixed(0)}s / 600s`;

    if (video.getVideoPlaybackQuality) {
      const q = video.getVideoPlaybackQuality();
      document.getElementById('st-dropped').textContent = `${q.droppedVideoFrames} / ${q.totalVideoFrames}`;
    }

    if (rtts.length) {
      const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
      const max = Math.max(...rtts);
      document.getElementById('st-rtt').textContent = `${avg.toFixed(0)}ms / ${max.toFixed(0)}ms`;
    }
    document.getElementById('st-spikes').textContent = String(spikes);

    if (elapsedMs >= durationMs) {
      clearInterval(pingInterval);
      clearInterval(uiInterval);
      const dropped = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality().droppedVideoFrames : 0;
      setStatus(
        'stability',
        'pass',
        `done — see detail panel above (dropped=${dropped}, rtt spikes=${spikes}); judge acceptability by eye per ROADMAP`,
      );
    }
  }, 1000);
}

// ------------------------------------------------------------------ boot
runWsTest();
runVideoRangeTest();
runAutoplayTest();
