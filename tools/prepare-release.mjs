#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describeMissing, findMissingPages } from './verifyPrerender.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const artifactDir = path.join(root, 'artifacts', 'releases');

function git(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

const dirty = git(['status', '--porcelain', '--untracked-files=all']);
if (dirty) {
  console.error('[release] worktree is not clean; commit the reviewed source before packaging');
  process.exit(2);
}

const commit = git(['rev-parse', 'HEAD']);
const shortCommit = commit.slice(0, 12);
const release = String(process.env.APP_RELEASE || `mahad-${shortCommit}`);
if (!/^[a-z0-9][a-z0-9._-]{5,79}$/i.test(release)) {
  throw new Error('APP_RELEASE must be a safe 6-80 character release identifier');
}

fs.mkdirSync(artifactDir, { recursive: true });

// `--only admin` (or `--only client`) packages one front end instead of both.
//
// Not a shortcut: the component left out is not packaged at all, so the caller
// has to supply its archive from a release whose source is provably identical —
// which is what release-gate.mjs proves with `git diff` before it passes this
// flag. The API is always taken from the commit either way.
const onlyAt = process.argv.indexOf('--only');
const ONLY = onlyAt >= 0
  ? String(process.argv[onlyAt + 1] || '').split(',').map(part => part.trim()).filter(Boolean)
  : null;
const unknown = (ONLY || []).filter(name => !['admin', 'client'].includes(name));
if (unknown.length) {
  console.error(`[release] --only takes admin and/or client, not ${unknown.join(', ')}`);
  process.exit(2);
}
const requiredBuilds = ['admin', 'client']
  .filter(name => !ONLY || ONLY.includes(name))
  .map(name => ({ name, directory: path.join(root, name, 'dist') }));
if (ONLY) console.log(`[release] building ${requiredBuilds.map(b => b.name).join(' and ')} only — the rest must come from a release with identical source`);

// The frontends are rebuilt here rather than packaged from whatever dist/
// happens to be on disk.
//
// Checking only that index.html existed meant a release could pair an API taken
// from `git archive <commit>` — always exactly the commit — with a bundle built
// hours earlier from different source. That shipped silently: the API carried
// the fix, the UI did not, and the release id said both were the same commit.
for (const build of requiredBuilds) {
  console.log(`[release] building ${build.name}…`);
  fs.rmSync(build.directory, { recursive: true, force: true });
  const built = spawnSync('npm', ['--prefix', build.name, 'run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (built.error) throw built.error;
  if (built.status !== 0) {
    throw new Error(`${build.name} build failed:\n${(built.stderr || built.stdout || '').slice(-1500)}`);
  }
  if (!fs.existsSync(path.join(build.directory, 'index.html'))) {
    throw new Error(`${build.name} build produced no index.html`);
  }
}

// Per-page SEO, written into the client build before it is packed.
//
// Every URL used to serve the same shell, so each course page carried the
// homepage's title, its og:* tags, and a canonical pointing at the front page —
// which tells Google the 31 product pages are duplicates, and shows the generic
// institute card whenever anyone shares a course link. The generator writes
// dist/c/<slug>/index.html per product; nginx's existing
// `try_files $uri $uri/ /index.html` serves the directory before the SPA
// fallback, so no server configuration changes. It also rewrites sitemap.xml,
// which listed twelve static pages and none of the things being sold.
//
// A failure here is fatal on purpose: shipping a build whose product pages all
// canonicalise to the homepage is the bug this exists to prevent.
// Only meaningful when the client was just built — it writes into that build.
if (requiredBuilds.some(build => build.name === 'client')) {
console.log('[release] generating per-page SEO…');
const seo = spawnSync('node', [path.join(root, 'tools', 'generate-seo.mjs')], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  shell: false,
});
if (seo.error) throw seo.error;
if (seo.status !== 0) {
  throw new Error(`SEO generation failed:\n${(seo.stderr || seo.stdout || '').slice(-800)}`);
}
process.stdout.write(seo.stdout);
}

const artifact = path.join(artifactDir, `${release}-api.tgz`);
const archive = spawnSync('git', [
  'archive',
  '--format=tar.gz',
  '--prefix=mahad-api/',
  `--output=${artifact}`,
  `${commit}:api`,
], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  shell: false,
});
if (archive.error) throw archive.error;
if (archive.status !== 0) throw new Error(archive.stderr.trim() || 'git archive failed');

const artifacts = [{ component: 'api', path: artifact }];
for (const build of requiredBuilds) {
  const target = path.join(artifactDir, `${release}-${build.name}.tgz`);
  // --force-local: without it tar reads the colon in an absolute Windows path
  // (D:\...) as a host:path remote spec and tries to open a network connection,
  // so packaging a release fails outright on a Windows machine. No effect on
  // POSIX paths, which contain no colon.
  const packed = spawnSync('tar', ['--force-local', '-czf', target, '-C', build.directory, '.'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (packed.error) throw packed.error;
  if (packed.status !== 0) throw new Error(packed.stderr.trim() || `${build.name} archive failed`);
  if (build.name === 'client') verifyClientArchive(target);
  artifacts.push({ component: build.name, path: target });
}

// Read back what was actually packed. See tools/verifyPrerender.mjs for the
// release that shipped two empty page directories and a 403.
function verifyClientArchive(target) {
  const tarArgs = ['--force-local'];
  const listed = spawnSync('tar', [...tarArgs, '-tzf', target], {
    cwd: root, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) throw new Error(`could not list ${path.basename(target)}: ${listed.stderr.trim()}`);
  const sitemap = spawnSync('tar', [...tarArgs, '-xzOf', target, './sitemap.xml'], {
    cwd: root, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024,
  });
  if (sitemap.status !== 0 || !sitemap.stdout.includes('<urlset')) {
    throw new Error(`${path.basename(target)} has no readable sitemap.xml — refusing to ship it`);
  }
  const result = findMissingPages(listed.stdout.split(/\r?\n/), sitemap.stdout);
  if (result.emptyDirectories.length || result.missingFromSitemap.length) {
    throw new Error(`client archive is incomplete — not releasing.\n${describeMissing(result)}`);
  }
  const pages = listed.stdout.split(/\r?\n/).filter(n => /^(?:\.\/)?(?:c|course|bundle)\/[^/]+\/index\.html$/.test(n)).length;
  console.log(`[release] client archive carries all ${pages} prerendered page(s)`);
}

const artifactEvidence = artifacts.map(item => ({
  component: item.component,
  file: path.basename(item.path),
  sha256: crypto.createHash('sha256').update(fs.readFileSync(item.path)).digest('hex'),
}));
const manifest = {
  schemaVersion: 1,
  release,
  commit,
  artifacts: artifactEvidence,
  createdAt: new Date().toISOString(),
  nodeRuntime: '22.x',
  source: 'clean-git-commit',
};
const manifestPath = path.join(artifactDir, `${release}.json`);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
for (const item of artifactEvidence) {
  fs.writeFileSync(
    path.join(artifactDir, `${item.file}.sha256`),
    `${item.sha256}  ${item.file}\n`,
    { mode: 0o600 }
  );
}

console.log(JSON.stringify({ ok: true, artifacts: artifactEvidence, manifest: manifestPath }, null, 2));
