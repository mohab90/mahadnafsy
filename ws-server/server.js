'use strict';

const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const app = express();
app.use(cors({ origin: process.env.WS_CORS_ORIGIN || '*', credentials: false }));
app.use(express.json({ limit: '256kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.WS_CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';
const INTERNAL_SECRET = process.env.WS_INTERNAL_SECRET || '';

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('Authentication error: token missing'));

  jwt.verify(String(token), JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Authentication error: invalid token'));
    socket.user = decoded || {};
    const tenantId = socket.user.tenant_id || socket.user.tenantId;
    if (tenantId) socket.join(`tenant:${tenantId}`);
    if (socket.user.uid || socket.user.id) socket.join(`user:${socket.user.uid || socket.user.id}`);
    if (socket.user.email) socket.join(`user:${String(socket.user.email).toLowerCase().trim()}`);
    next();
  });
});

io.on('connection', (socket) => {
  socket.emit('connected', {
    socketId: socket.id,
    at: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mahad-ws',
    sockets: io.engine.clientsCount,
    time: new Date().toISOString(),
  });
});

app.post('/emit', (req, res) => {
  if (!INTERNAL_SECRET || req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { event, payload, room } = req.body || {};
  if (!event || typeof event !== 'string') {
    return res.status(400).json({ error: 'event is required' });
  }

  if (room) io.to(String(room)).emit(event, payload || {});
  else io.emit(event, payload || {});

  return res.json({ ok: true });
});

const PORT = Number(process.env.WS_PORT || process.env.PORT || 4002);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Mahad WebSocket server listening on port ${PORT}`);
});
