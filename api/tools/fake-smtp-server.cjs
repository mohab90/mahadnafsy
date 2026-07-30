#!/usr/bin/env node
'use strict';

const net = require('node:net');
const fs = require('node:fs');

if (process.env.NODE_ENV !== 'test') throw new Error('fake SMTP server is test-only');
const port = Number(process.env.FAKE_SMTP_PORT || 2525);
const captureFile = String(process.env.FAKE_SMTP_CAPTURE_FILE || '').trim();
if (captureFile) fs.writeFileSync(captureFile, '', 'utf8');

const server = net.createServer(socket => {
  socket.setEncoding('utf8');
  socket.write('220 localhost ESMTP Mahad test\r\n');
  let buffer = '';
  let dataMode = false;
  let authLoginStep = 0;
  let messageLines = [];

  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index + 1).replace(/\r?\n$/, '');
      buffer = buffer.slice(index + 1);
      if (dataMode) {
        if (line === '.') {
          dataMode = false;
          if (captureFile) {
            fs.appendFileSync(captureFile, `${messageLines.join('\n')}\n---MAHAD-MESSAGE---\n`, 'utf8');
          }
          messageLines = [];
          socket.write('250 2.0.0 queued as mahad-test-message\r\n');
        } else {
          messageLines.push(line);
        }
        continue;
      }
      if (authLoginStep) {
        if (authLoginStep === 1) {
          authLoginStep = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else {
          authLoginStep = 0;
          socket.write('235 2.7.0 Authentication successful\r\n');
        }
      } else if (/^(EHLO|HELO)\b/i.test(line)) {
        socket.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10485760\r\n');
      } else if (/^AUTH PLAIN\b/i.test(line)) {
        socket.write('235 2.7.0 Authentication successful\r\n');
      } else if (/^AUTH LOGIN\b/i.test(line)) {
        authLoginStep = 1;
        socket.write('334 VXNlcm5hbWU6\r\n');
      } else if (/^(MAIL FROM|RCPT TO)\b/i.test(line)) {
        socket.write('250 2.1.5 Accepted\r\n');
      } else if (/^DATA$/i.test(line)) {
        dataMode = true;
        messageLines = [];
        socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
      } else if (/^RSET$/i.test(line)) {
        socket.write('250 2.0.0 Reset\r\n');
      } else if (/^QUIT$/i.test(line)) {
        socket.end('221 2.0.0 Bye\r\n');
      } else {
        socket.write('250 2.0.0 OK\r\n');
      }
    }
  });
});

server.listen(port, '127.0.0.1', () => console.log(`fake_smtp_listening=${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
