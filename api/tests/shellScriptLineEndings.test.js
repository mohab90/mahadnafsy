'use strict';

// A shell script with CRLF line endings does not fail loudly on Linux. It fails
// on its first line, in a way that reads like a completely different problem:
//
//   set: usage: set [-abefhkmnptuvxBCEHPT] [-o option-name] [--] [-] [arg ...]
//   /var/www/mahad-api/watchdog.sh: line 3: $'\r': command not found
//   curl: (3) URL rejected: Malformed input to a URL function
//
// That is what api/watchdog.sh had been doing on production every minute since
// it was installed — 1.6 MB of it — so the health check that exists to notice
// the API being down had never once checked it. Four other shipped scripts had
// the same endings, including the nightly database backup.
//
// .gitattributes asks for LF, but the release tarball is packed from the
// working tree rather than from git, so a Windows checkout's line endings reach
// the server as they are. This fails the build instead of trusting that.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'artifacts', 'coverage']);

const walk = (dir, out = []) => {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(sh|bash)$/.test(entry.name)) out.push(full);
  }
  return out;
};

test('no shell script ships with CRLF line endings', () => {
  const scripts = walk(ROOT);
  // Denominator: a walk that found nothing would pass without checking anything.
  assert.ok(scripts.length >= 5, `expected to find the shipped shell scripts, saw ${scripts.length}`);

  const offenders = [];
  for (const file of scripts) {
    const text = fs.readFileSync(file, 'latin1');
    const crlf = (text.match(/\r\n/g) || []).length;
    if (crlf) offenders.push(`${path.relative(ROOT, file).split(path.sep).join('/')} (${crlf} lines)`);
  }
  assert.deepEqual(offenders, [], 'these die on their first line when run on the server');
});

test('the shebang is the very first byte, with nothing before it', () => {
  // A BOM ahead of #! is the same class of failure: the kernel does not
  // recognise the interpreter line and the script runs under the caller's shell
  // or not at all.
  for (const file of walk(ROOT)) {
    const head = fs.readFileSync(file).subarray(0, 3);
    assert.ok(
      !(head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf),
      `${path.relative(ROOT, file)} starts with a UTF-8 BOM`
    );
  }
});

test('.gitattributes pins shell scripts to LF explicitly', () => {
  const attrs = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
  assert.match(attrs, /^\*\.sh\s+text eol=lf$/m);
});

test('the api subtree carries its own rule, because the release archives it alone', () => {
  // tools/prepare-release.mjs builds the API bundle with `git archive
  // <commit>:api`. Git resolves .gitattributes relative to the tree being
  // archived, so the root file is invisible to a subtree archive and
  // core.autocrlf converts on the way out. That is exactly how watchdog.sh
  // reached production with CRLF while the working tree had LF.
  const attrs = fs.readFileSync(path.join(ROOT, 'api', '.gitattributes'), 'utf8');
  assert.match(attrs, /^\*\.sh\s+text eol=lf$/m);
});

test('the bundle the release actually ships has LF, not just the working tree', () => {
  // The check that matters. The working tree was already LF when watchdog.sh
  // shipped broken — asserting on it would have passed and proved nothing.
  const { execFileSync } = require('node:child_process');
  let packed;
  try {
    packed = execFileSync('git', ['archive', 'HEAD:api', 'watchdog.sh'], {
      cwd: ROOT, maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    // No git, or watchdog.sh not committed yet — nothing to assert against.
    return;
  }
  // tar payload: the file content sits after the 512-byte header block.
  const text = packed.toString('latin1');
  const crlf = (text.match(/\r\n/g) || []).length;
  assert.equal(crlf, 0, 'the api bundle ships watchdog.sh with CRLF — it will die on its first line');
});
