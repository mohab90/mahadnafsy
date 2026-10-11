'use strict';

// A rep's WhatsApp link keys (lib/whatsappWeb.js), encrypted at rest.
//
// Baileys' own useMultiFileAuthState keeps them as plain JSON files under
// WA_WEB_DATA_DIR. Those files are the rep's WhatsApp: whoever copies the
// folder — a backup, a stray tarball, another account on the server — can open
// a linked device on every rep's number and read and send as them. They are now
// sealed with the same helper as the channel credentials (lib/secretBox.js,
// AES-256-GCM under CHANNEL_SECRET_KEY, else JWT_SECRET), written 0600 in 0700
// folders.
//
// Same files, same names, same layout as Baileys' adapter, so nobody has to
// re-link: a file written before this is read as plain JSON once and rewritten
// sealed on the spot. Without a key configured nothing can be sealed — the
// files are still written private (0600/0700), and a warning says so.

const fs = require('fs/promises');
const path = require('path');
const secretBox = require('./secretBox');
const logger = require('./logger').child({ module: 'whatsapp-web-auth' });

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const SEALED_PREFIX = 'v1:';

// Baileys' own file naming, so existing folders keep working.
const fixFileName = file => String(file || '').replace(/\//g, '__').replace(/:/g, '-');

// One read or write per file at a time: Baileys saves the same key from several
// events at once, and two writers racing on one file leave half of each.
const chains = new Map();
function serialised(file, fn) {
  const previous = chains.get(file) || Promise.resolve();
  const next = previous.then(fn, fn);
  const tail = next.then(() => {}, () => {});
  chains.set(file, tail);
  tail.then(() => { if (chains.get(file) === tail) chains.delete(file); });
  return next;
}

// Written whole or not at all: a crash halfway through a write must not leave
// a truncated creds.json, which would unlink the rep.
async function writePrivate(filePath, content) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, { mode: FILE_MODE });
  await fs.chmod(tmp, FILE_MODE); // the umask may have taken bits off
  await fs.rename(tmp, filePath);
}

/** Tighten a folder made before this, and the ones above it up to the data root. */
async function makePrivateDir(dir, root = null) {
  await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
  const stop = root ? path.resolve(root) : path.resolve(dir);
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    await fs.chmod(current, DIR_MODE).catch(() => {});
    if (current === stop || path.dirname(current) === current || !current.startsWith(stop)) break;
  }
}

function codec(BufferJSON, sealed) {
  return {
    encode(value) {
      const json = JSON.stringify(value, BufferJSON.replacer);
      return sealed ? secretBox.seal(json) : json;
    },
    decode(text) {
      const raw = String(text || '');
      if (raw.startsWith(SEALED_PREFIX)) {
        return { value: JSON.parse(secretBox.open(raw), BufferJSON.reviver), plaintext: false };
      }
      return { value: JSON.parse(raw, BufferJSON.reviver), plaintext: true };
    },
  };
}

/**
 * Drop-in for Baileys' useMultiFileAuthState(folder). The Baileys pieces are
 * passed in because the library is an ES module loaded on first use.
 *
 * @param {string} folder  the rep's folder under WA_WEB_DATA_DIR
 * @param {{BufferJSON: object, initAuthCreds: Function, proto: object}} baileys
 * @param {{sealed?: boolean, root?: string}} options
 */
async function useSealedAuthState(folder, { BufferJSON, initAuthCreds, proto }, options = {}) {
  const sealed = options.sealed ?? secretBox.isConfigured();
  if (!sealed) {
    logger.warn('[wa-web] no CHANNEL_SECRET_KEY / JWT_SECRET — link keys are stored unencrypted (files are still private)');
  }
  const info = await fs.stat(folder).catch(() => null);
  if (info && !info.isDirectory()) throw new Error(`found something that is not a directory at ${folder}`);
  await makePrivateDir(folder, options.root || null);
  const { encode, decode } = codec(BufferJSON, sealed);
  const fileOf = name => path.join(folder, fixFileName(name));

  const writeData = (value, name) => {
    const file = fileOf(name);
    return serialised(file, () => writePrivate(file, encode(value)));
  };
  const readData = name => {
    const file = fileOf(name);
    return serialised(file, async () => {
      let text;
      try { text = await fs.readFile(file, 'utf8'); } catch { return null; }
      try {
        const { value, plaintext } = decode(text);
        // Written before encryption: sealed now, the first time it is read.
        if (plaintext && sealed) await writePrivate(file, encode(value));
        else await fs.chmod(file, FILE_MODE).catch(() => {});
        return value;
      } catch (error) {
        // Tampered with, or the key changed: unusable, which for creds.json
        // means a fresh QR — never a silently altered identity.
        logger.warn('[wa-web] a link key could not be read', { file: path.basename(file), error: error.message });
        return null;
      }
    });
  };
  const removeData = name => {
    const file = fileOf(name);
    return serialised(file, () => fs.unlink(file).catch(() => {}));
  };

  const creds = (await readData('creds.json')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async id => {
            let value = await readData(`${type}-${id}.json`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }));
          return data;
        },
        set: async data => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const name = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, name) : removeData(name));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, 'creds.json'),
  };
}

module.exports = { useSealedAuthState, makePrivateDir, FILE_MODE, DIR_MODE };
