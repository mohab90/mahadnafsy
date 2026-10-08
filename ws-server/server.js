'use strict';

// Hardened after the 7 Oct 2026 audit (HIGH-08 / MED-30). It ran — had it been
// deployed — on a published fallback secret, verified tokens under any
// algorithm, never checked that the session was still alive, sent every event
// to every connected account of every tenant, and accepted any origin.

// No secret, no server: a default would be a key anyone can read here.
const JWT_SECRET = process.env.JWT_SECRET;
const INTERNAL_SECRET = process.env.WS_INTERNAL_SECRET;
// Where the session is confirmed: a token that was signed out, or whose device
// was replaced, is refused there and must be refused here too.
const API_URL = String(process.env.MAHAD_API_URL || '').replace(/\/$/, '');
for (const [name, value] of [['JWT_SECRET', JWT_SECRET], ['WS_INTERNAL_SECRET', INTERNAL_SECRET], ['MAHAD_API_URL', API_URL]]) {
  if (!value) {
    // eslint-disable-next-line no-console
    console.error(`[ws] ${name} is not set — refusing to start`);
    process.exit(1);
  }
}

const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

// The sites allowed to connect, comma separated. None set means none allowed.
const ORIGINS = String(process.env.WS_CORS_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: ORIGINS, credentials: true }));
app.use(express.json({ limit: '256kb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGINS, methods: ['GET', 'POST'], credentials: true } });

function tokenOf(handshake) {
  const cookie = String(handshake.headers?.cookie || '').match(/(?:^|;\s*)authToken=([^;]+)/);
  if (cookie) return decodeURIComponent(cookie[1]);
  return handshake.auth?.token || null;
}

async function sessionIsAlive(token) {
  try {
    const response = await fetch(`${API_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

io.use(async (socket, next) => {
  const token = tokenOf(socket.handshake);
  if (!token) return next(new Error('Authentication error: token missing'));
  let claims;
  try {
    claims = jwt.verify(String(token), JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return next(new Error('Authentication error: invalid token'));
  }
  if (!claims.tid || !claims.uid || !(await sessionIsAlive(token))) {
    return next(new Error('Authentication error: session ended'));
  }
  socket.join(`user:${claims.uid}`);
  if (claims.email) socket.join(`user:${String(claims.email).toLowerCase().trim()}`);
  // Staff events are for the tenant's staff, never its students.
  if (claims.stf === true) socket.join(`staff:${claims.tid}`);
  socket.join(`tenant:${claims.tid}`);
  return next();
});

io.on('connection', (socket) => {
  socket.emit('connected', { socketId: socket.id, at: new Date().toISOString() });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mahad-ws', time: new Date().toISOString() });
});

const ROOM = /^(user|staff|tenant):[^\s]{1,190}$/;

app.post('/emit', (req, res) => {
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { event, payload, room } = req.body || {};
  if (!event || typeof event !== 'string') {
    return res.status(400).json({ error: 'event is required' });
  }
  // Every event names who it is for; there is no «everyone».
  if (typeof room !== 'string' || !ROOM.test(room)) {
    return res.status(400).json({ error: 'room is required' });
  }
  io.to(room).emit(event, payload || {});
  return res.json({ ok: true });
});

const PORT = Number(process.env.WS_PORT || process.env.PORT || 4002);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`WebSocket server listening on port ${server.address().port}`);
});

module.exports = { app, io, server };
