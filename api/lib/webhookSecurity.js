'use strict';

const dns = require('dns').promises;
const net = require('net');

function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is that IPv4 address.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return ip === '::1' || ip === '::' || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('::ffff:127.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:192.168.');
  }
  return true;
}

async function assertSafeWebhookUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('Invalid webhook URL'); }
  const developmentHttp = process.env.NODE_ENV !== 'production' && url.protocol === 'http:';
  if (url.protocol !== 'https:' && !developmentHttp) throw new Error('Webhook URL must use HTTPS');
  if (url.username || url.password) throw new Error('Webhook URL credentials are not allowed');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private webhook hosts are not allowed');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new Error('Private webhook addresses are not allowed');
  return url.toString();
}

// The address is checked again when the connection is made, not only when the
// URL was saved: a host can answer a public address to the check and a private
// one a second later (DNS rebinding). Whatever the lookup returns is refused if
// any of it is private.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }).then((addresses) => {
    if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
      return callback(new Error('Private webhook addresses are not allowed'));
    }
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  }, callback);
}

/**
 * POST a JSON body to a tenant's webhook. Redirects are not followed — a 3xx
 * answer is the result — because following one handed the request to whatever
 * address the receiver named, internal ones included (fetch follows by default).
 * Resolves { status }; rejects on a refused address, a network error or the timeout.
 */
async function postWebhook(value, { body, headers = {}, timeoutMs = 8000 } = {}) {
  const url = new URL(await assertSafeWebhookUrl(value));
  const transport = url.protocol === 'https:' ? require('https') : require('http');
  const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}));
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: 'POST',
      lookup: safeLookup,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...headers },
    }, (response) => {
      response.resume();
      resolve({ status: response.statusCode || 0, redirected: response.statusCode >= 300 && response.statusCode < 400 });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Webhook timed out')));
    request.on('error', reject);
    request.end(payload);
  });
}

module.exports = { assertSafeWebhookUrl, isPrivateAddress, postWebhook, safeLookup };
