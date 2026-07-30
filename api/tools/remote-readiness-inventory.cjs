#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('ssh2');

const required = ['SSH_HOST', 'SSH_USER', 'REMOTE_API_ENV_FILE'];
for (const name of required) {
  if (!String(process.env[name] || '').trim()) {
    throw new Error(`${name} is required for the read-only remote inventory`);
  }
}

const remoteEnv = String(process.env.REMOTE_API_ENV_FILE);
if (!/^\/[a-zA-Z0-9_./-]+$/.test(remoteEnv)) throw new Error('REMOTE_API_ENV_FILE is unsafe');
const remotePaths = String(process.env.REMOTE_APP_DIRS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
if (remotePaths.some(value => !/^\/[a-zA-Z0-9_./-]+$/.test(value))) {
  throw new Error('REMOTE_APP_DIRS contains an unsafe path');
}
const privateKeyFile = String(process.env.SSH_PRIVATE_KEY_FILE || '').trim();
const agent = String(process.env.SSH_AUTH_SOCK || '').trim();
if (!privateKeyFile && !agent) throw new Error('SSH_PRIVATE_KEY_FILE or SSH_AUTH_SOCK is required');
if (privateKeyFile && !path.isAbsolute(privateKeyFile)) throw new Error('SSH_PRIVATE_KEY_FILE must be absolute');
const authentication = privateKeyFile
  ? { privateKey: fs.readFileSync(privateKeyFile) }
  : { agent };

const readinessKeys = [
  'NODE_ENV', 'DB_HOST', 'DB_SSL_MODE', 'JWT_SECRET', 'JWT_SECRET_FILE',
  'SESSION_BINDING_SECRET', 'SESSION_BINDING_SECRET_FILE', 'OTP_HMAC_SECRET',
  'OTP_HMAC_SECRET_FILE', 'AUTH_SECRET_SOURCE', 'AUTH_SECRET_PROVIDER',
  'JWT_SECRET_REFERENCE', 'SESSION_BINDING_SECRET_REFERENCE', 'OTP_HMAC_SECRET_REFERENCE',
  'AUTH_SECRET_ROTATED_AT', 'AUDIT_HMAC_SECRET', 'AUDIT_HMAC_SECRET_FILE',
  'AUDIT_SECRET_PROVIDER', 'AUDIT_SECRET_REFERENCE', 'REDIS_URL',
  'REDIS_PROVIDER', 'REDIS_REGION', 'RATE_LIMIT_REDIS_ENABLED', 'SENTRY_DSN',
  'SENTRY_DSN_FILE', 'ALERT_WEBHOOK_URL', 'ALERT_WEBHOOK_URL_FILE', 'APP_RELEASE',
  'DATA_RESIDENCY_PROVIDER', 'DATA_RESIDENCY_REGION', 'DATA_RESIDENCY_EVIDENCE',
  'DATA_RESIDENCY_EVIDENCE_SHA256', 'DATA_RESIDENCY_VERIFIED_AT', 'SMTP_PASS',
  'SMTP_PASS_FILE', 'WHATSAPP_TOKEN', 'WHATSAPP_TOKEN_FILE', 'WHATSAPP_PHONE_ID',
  'WA_INSTANCE_ID', 'WA_API_TOKEN', 'WA_API_TOKEN_FILE', 'TRUST_PROXY_HOPS',
  'TRUST_GEO_HEADERS', 'GEOIP_API_URL', 'PAYMOB_REVIEW_PENDING',
];

const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const keys = readinessKeys.map(shellQuote).join(' ');
const command = `
set -eu
echo "SECTION system"
printf "hostname="; hostname
printf "kernel="; uname -srm
printf "node="; node --version 2>/dev/null || echo missing
printf "npm="; npm --version 2>/dev/null || echo missing
printf "memory_mb="; awk '/MemTotal/{printf "%d\\n",$2/1024}' /proc/meminfo
printf "disk="; df -P / | awk 'NR==2{print $4"KB_free/"$2"KB_total"}'
echo "SECTION commands"
for cmd in mysql mysqldump redis-cli pm2 systemctl curl openssl; do
  if command -v "$cmd" >/dev/null 2>&1; then echo "$cmd=present"; else echo "$cmd=missing"; fi
done
echo "SECTION listeners"
if command -v ss >/dev/null 2>&1; then
  ss -lntH | awk '{print $4}' | sed 's/.*://' | sort -nu | paste -sd, -
else
  echo unavailable
fi
echo "SECTION processes"
ps -eo comm= | sort | uniq -c | awk '$2 ~ /^(node|mysqld|redis-server|nginx|apache2|httpd)$/ {print $2"="$1}'
echo "SECTION paths"
for p in ${remotePaths.length ? remotePaths.map(shellQuote).join(' ') : shellQuote('/opt/mahad')}; do
  if [ -d "$p" ]; then echo "$p=present"; else echo "$p=missing"; fi
done
echo "SECTION env"
env_file=${shellQuote(remoteEnv)}
if [ ! -f "$env_file" ]; then
  echo "env_file=missing"
  exit 0
fi
echo "env_file=present"
for key in ${keys}; do
  state=$(awk -F= -v key="$key" '
    $1 == key {
      value=substr($0,index($0,"=")+1)
      gsub(/^[[:space:]]+|[[:space:]]+$/,"",value)
      if (value == "") print "empty"; else print "present"
      found=1
      exit
    }
    END { if (!found) print "missing" }
  ' "$env_file")
  echo "$key=$state"
done
redis_scheme=$(awk -F= '$1=="REDIS_URL"{value=substr($0,index($0,"=")+1); if(value ~ /^rediss:\\/\\//) print "rediss"; else if(value ~ /^redis:\\/\\//) print "redis"; else print "invalid"; found=1; exit} END{if(!found) print "missing"}' "$env_file")
echo "REDIS_URL_SCHEME=$redis_scheme"
db_host_class=$(awk -F= '$1=="DB_HOST"{value=substr($0,index($0,"=")+1); if(value ~ /^(127\\.0\\.0\\.1|localhost)$/) print "local"; else if(value=="") print "empty"; else print "remote"; found=1; exit} END{if(!found) print "missing"}' "$env_file")
echo "DB_HOST_CLASS=$db_host_class"
`;

const connection = new Client();
connection
  .on('ready', () => {
    connection.exec(command, (error, stream) => {
      if (error) {
        connection.end();
        throw error;
      }
      let stderr = '';
      stream.on('data', chunk => process.stdout.write(chunk));
      stream.stderr.on('data', chunk => { stderr += chunk.toString(); });
      stream.on('close', code => {
        if (stderr.trim()) process.stderr.write(stderr);
        connection.end();
        if (code !== 0) process.exitCode = code || 1;
      });
    });
  })
  .on('error', error => {
    console.error(`remote_inventory_error=${error.message}`);
    process.exitCode = 1;
  })
  .connect({
    host: process.env.SSH_HOST,
    port: Number(process.env.SSH_PORT || 22),
    username: process.env.SSH_USER,
    ...authentication,
    readyTimeout: Math.min(Math.max(Number(process.env.SSH_READY_TIMEOUT_MS || 30_000), 5_000), 60_000),
    keepaliveInterval: 10_000,
    keepaliveCountMax: 2,
  });
