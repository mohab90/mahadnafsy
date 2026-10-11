'use strict';

// A rep's WhatsApp link keys were plain JSON files under WA_WEB_DATA_DIR:
// whoever copied the folder held every rep's WhatsApp. They are sealed now
// (lib/whatsappWebAuthState.js), 0600 in 0700 folders, and a file written
// before is sealed the first time it is read — nobody has to re-link.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-secret-0123456789abcdef';
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', { pool: {} });
const { useSealedAuthState } = require('../lib/whatsappWebAuthState');

let baileys;
const load = async () => {
  if (!baileys) {
    const lib = await import('@whiskeysockets/baileys');
    baileys = { BufferJSON: lib.BufferJSON, initAuthCreds: lib.initAuthCreds, proto: lib.proto };
  }
  return baileys;
};
const mode = file => fs.statSync(file).mode & 0o777;
const made = [];
const tmpRoot = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-web-')); made.push(dir); return dir; };
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

test('keys are written sealed and private, and read back whole', async () => {
  const root = tmpRoot();
  const dir = path.join(root, 'tenant', 'rep');
  const { state, saveCreds } = await useSealedAuthState(dir, await load(), { root });
  await saveCreds();
  await state.keys.set({ 'pre-key': { 7: { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) } } });

  const credsText = fs.readFileSync(path.join(dir, 'creds.json'), 'utf8');
  assert.match(credsText, /^v1:/, 'sealed');
  assert.doesNotMatch(credsText, /noiseKey|registrationId/, 'nothing readable');
  assert.equal(mode(path.join(dir, 'creds.json')), 0o600);
  assert.equal(mode(path.join(dir, 'pre-key-7.json')), 0o600);
  for (const folder of [dir, path.dirname(dir), root]) assert.equal(mode(folder), 0o700, folder);

  const again = await useSealedAuthState(dir, await load(), { root });
  assert.equal(again.state.creds.registrationId, state.creds.registrationId);
  const { 7: key } = await again.state.keys.get('pre-key', ['7']);
  assert.deepEqual([...key.public], [1, 2, 3], 'Buffers survive the round trip');

  await again.state.keys.set({ 'pre-key': { 7: null } });
  assert.equal(fs.existsSync(path.join(dir, 'pre-key-7.json')), false);
});

test('a file written before encryption is sealed the first time it is read', async () => {
  const { BufferJSON, initAuthCreds } = await load();
  const root = tmpRoot();
  const dir = path.join(root, 'tenant', 'rep');
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const creds = initAuthCreds();
  fs.writeFileSync(path.join(dir, 'creds.json'), JSON.stringify(creds, BufferJSON.replacer), { mode: 0o644 });
  fs.writeFileSync(path.join(dir, 'session-abc.json'), JSON.stringify({ hello: Buffer.from('x') }, BufferJSON.replacer), { mode: 0o644 });

  const { state } = await useSealedAuthState(dir, await load(), { root });
  assert.equal(state.creds.registrationId, creds.registrationId, 'the rep stays linked');
  assert.match(fs.readFileSync(path.join(dir, 'creds.json'), 'utf8'), /^v1:/);
  assert.equal(mode(path.join(dir, 'creds.json')), 0o600);
  assert.equal(mode(dir), 0o700);

  const { abc } = await state.keys.get('session', ['abc']);
  assert.equal(Buffer.from(abc.hello).toString(), 'x');
  assert.match(fs.readFileSync(path.join(dir, 'session-abc.json'), 'utf8'), /^v1:/);
});

test('a tampered file is unusable, never an altered identity', async () => {
  const root = tmpRoot();
  const dir = path.join(root, 'rep');
  const first = await useSealedAuthState(dir, await load(), { root });
  await first.saveCreds();
  const file = path.join(dir, 'creds.json');
  const sealed = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, `${sealed.slice(0, -4)}AAAA`);
  const second = await useSealedAuthState(dir, await load(), { root });
  assert.notEqual(second.state.creds.registrationId, undefined);
  assert.notDeepEqual(second.state.creds.noiseKey, first.state.creds.noiseKey, 'a fresh link, not the tampered one');
});

test('the per-rep daily cap is 250 unless set', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsappWeb.js'), 'utf8');
  assert.match(source, /Number\(process\.env\.WA_WEB_DAILY_LIMIT \|\| 250\)/);
  assert.match(source, /useSealedAuthState\(dir, \{ BufferJSON, initAuthCreds, proto \}, \{ root: DATA_DIR \}\)/);
  assert.doesNotMatch(source, /useMultiFileAuthState\(/, 'not Baileys\' plaintext adapter');
});
