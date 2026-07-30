#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
const requiredBuilds = ['admin', 'client'].map(name => ({
  name,
  directory: path.join(root, name, 'dist'),
}));
for (const build of requiredBuilds) {
  if (!fs.existsSync(path.join(build.directory, 'index.html'))) {
    throw new Error(`${build.name}/dist is missing; run the reviewed production build before packaging`);
  }
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
  const packed = spawnSync('tar', ['-czf', target, '-C', build.directory, '.'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  if (packed.error) throw packed.error;
  if (packed.status !== 0) throw new Error(packed.stderr.trim() || `${build.name} archive failed`);
  artifacts.push({ component: build.name, path: target });
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
