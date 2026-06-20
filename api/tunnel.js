'use strict';
// Local dev SSH tunnel: forwards 127.0.0.1:3306 → remote MySQL via SSH
// Usage: node tunnel.js
const net    = require('net');
const Client = require('ssh2').Client;
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const SSH_HOST = process.env.SSH_HOST;
const SSH_PORT = parseInt(process.env.SSH_PORT || '22');
const SSH_USER = process.env.SSH_USER;
const SSH_PASS = process.env.SSH_PASS;

const LOCAL_PORT  = 3306;
const REMOTE_HOST = '127.0.0.1';
const REMOTE_PORT = 3306;

console.log(`[tunnel] Connecting SSH → ${SSH_USER}@${SSH_HOST}:${SSH_PORT}`);

// Defense-in-depth: a stray error must NEVER kill the tunnel process. The supervisor
// restarts it on exit, but that leaves a ~3s window where the DB is unreachable.
// Keeping the process alive here avoids that window for non-fatal errors.
process.on('uncaughtException', (e) => {
  if (e && e.code === 'EADDRINUSE') return; // handled by server.on('error')
  console.error('[tunnel] uncaughtException (keeping alive):', e && e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('[tunnel] unhandledRejection (keeping alive):', e && (e.message || e));
});

// Keep track of active SSH connections
const sshClients = new Set();

const server = net.createServer((localSocket) => {
  const conn = new Client();
  sshClients.add(conn);

  // A per-connection reset (idle MySQL/SSH drop) must NOT crash the whole tunnel.
  // Without these handlers an 'error' event on the socket/stream is unhandled → process exit.
  localSocket.on('error', (err) => {
    if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') console.warn('[tunnel] local socket error:', err.message);
    conn.end();
    sshClients.delete(conn);
  });

  conn.on('ready', () => {
    conn.forwardOut('127.0.0.1', LOCAL_PORT, REMOTE_HOST, REMOTE_PORT, (err, stream) => {
      if (err) {
        console.error('[tunnel] forwardOut error:', err.message);
        localSocket.destroy();
        conn.end();
        return;
      }
      stream.on('error', (e) => {
        if (e.code !== 'ECONNRESET' && e.code !== 'EPIPE') console.warn('[tunnel] stream error:', e.message);
        localSocket.destroy();
      });
      localSocket.pipe(stream).pipe(localSocket);
      localSocket.on('close', () => { conn.end(); sshClients.delete(conn); });
      stream.on('close', () => { localSocket.destroy(); });
    });
  });

  conn.on('error', (err) => {
    console.error('[tunnel] SSH error:', err.message);
    localSocket.destroy();
    sshClients.delete(conn);
  });

  conn.connect({
    host:     SSH_HOST,
    port:     SSH_PORT,
    username: SSH_USER,
    password: SSH_PASS,
    readyTimeout: 15000,
  });
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`[tunnel] Listening on 127.0.0.1:${LOCAL_PORT} → ${REMOTE_HOST}:${REMOTE_PORT} via SSH`);
  console.log('[tunnel] Ready — now start the API: node server.js');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[tunnel] Port ${LOCAL_PORT} already in use — MySQL might already be available locally. Exiting tunnel.`);
    process.exit(0);
  } else {
    console.error('[tunnel] Server error:', err.message);
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  console.log('\n[tunnel] Shutting down...');
  sshClients.forEach(c => c.end());
  server.close(() => process.exit(0));
});
