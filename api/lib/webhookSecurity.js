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

module.exports = { assertSafeWebhookUrl, isPrivateAddress };
