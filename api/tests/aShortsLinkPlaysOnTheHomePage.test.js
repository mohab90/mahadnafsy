'use strict';

// «حطيت فيديو في الصفحة الرئيسية جزء لماذا نختار معهد الدراسات النفسية؟ للأسف مش شغال» (19 Oct 2026).
//
// The video address the marketing team stored is a YouTube Short, https://youtube.com/shorts/<id>?feature=share.
// The control panel accepts it (admin/pages/dashboard/content-editor/youtube.ts knows /shorts/, /live/, /embed/),
// but the site's embed builder only found an id in watch?v=, youtu.be/ and /embed/ links. With no id it returned the
// link untouched, the frame loaded youtube.com/shorts/…, which YouTube refuses to frame, and the square stayed blank.
// The lecture server (playableRedirect) had the same gap for a paid lecture stored as a Short or a live link.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function bundle(entry) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)], bundle: true, write: false, format: 'cjs', platform: 'node',
    logLevel: 'silent', nodePaths: [path.join(ROOT, 'admin', 'node_modules'), path.join(ROOT, 'client', 'node_modules')],
    define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

test('every YouTube link shape the control panel accepts becomes an embed on the site', () => {
  const lib = bundle('client/lib/lectureVideo.ts');
  if (!lib) return;
  const id = 'bjuJ0EtJa18';
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtube.com/shorts/${id}?feature=share`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ]) {
    assert.match(lib.youtubeEmbedUrl(link), new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${id}\\?`), link);
  }
  assert.equal(lib.youtubeEmbedUrl('https://vimeo.com/123'), 'https://vimeo.com/123', 'another host is left as it is');
});

test('a paid lecture stored as a Short or a live link plays like any other', () => {
  const { playableRedirect } = require('../lib/mediaAccess');
  const id = 'bjuJ0EtJa18';
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtube.com/shorts/${id}?feature=share`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
  ]) {
    assert.match(playableRedirect(link, { autoplay: true }), new RegExp(`/embed/${id}\\?`), link);
  }
});
