'use strict';

// Local-development SSH tunnel. Production connects directly to managed MySQL.
// Authentication is limited to an SSH agent or a private-key file.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { Client } = require('ssh2');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const integer = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid port`);
  return value;
};
const required = name => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const sshHost = required('SSH_HOST');
const sshUser = required('SSH_USER');
const sshPort = integer('SSH_PORT', 22);
const localPort = integer('SSH_TUNNEL_LOCAL_PORT', 3306);
const remoteHost = String(process.env.SSH_TUNNEL_REMOTE_HOST || '127.0.0.1').trim();
const remotePort = integer('SSH_TUNNEL_REMOTE_PORT', 3306);
const privateKeyFile = String(process.env.SSH_PRIVATE_KEY_FILE || '').trim();
const agent = String(process.env.SSH_AUTH_SOCK || '').trim();

if (!privateKeyFile && !agent) throw new Error('SSH_PRIVATE_KEY_FILE or SSH_AUTH_SOCK is required');
if (privateKeyFile && !path.isAbsolute(privateKeyFile)) throw new Error('SSH_PRIVATE_KEY_FILE must be absolute');

const auth = privateKeyFile
  ? { privateKey: fs.readFileSync(privateKeyFile) }
  : { agent };
let connection;
let localServer;
let reconnectTimer;
let shuttingDown = false;

function connect() {
  connection = new Client();
  connection
    .once('ready', () => {
      console.log(`[tunnel] connected to ${sshHost}:${sshPort}`);
      if (localServer) return;
      localServer = net.createServer(localSocket => {
        localSocket.on('error', () => localSocket.destroy());
        connection.forwardOut('127.0.0.1', localPort, remoteHost, remotePort, (error, stream) => {
          if (error) return localSocket.destroy();
          stream.on('error', () => localSocket.destroy());
          localSocket.pipe(stream).pipe(localSocket);
        });
      });
      localServer.on('error', error => {
        console.error(`[tunnel] local listener failed: ${error.message}`);
        process.exitCode = 1;
        shutdown();
      });
      localServer.listen(localPort, '127.0.0.1', () => {
        console.log(`[tunnel] 127.0.0.1:${localPort} -> ${remoteHost}:${remotePort}`);
      });
    })
    .on('error', error => console.error(`[tunnel] SSH error: ${error.message}`))
    .once('close', () => {
      if (!shuttingDown) reconnectTimer = setTimeout(connect, 3000);
    })
    .connect({
      host: sshHost,
      port: sshPort,
      username: sshUser,
      ...auth,
      readyTimeout: 20_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
    });
}

function shutdown() {
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  if (connection) connection.end();
  if (localServer) localServer.close(() => process.exit()); else process.exit();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
connect();
