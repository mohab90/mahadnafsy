'use strict';

// «اول فيديو بس اللي بيشتغل», 29 September: the picture route registered as
// /api/media/:tenant/:file, ahead of routes/lms.js, and took every paid
// lecture's /api/media/lectures/:lectureId — 404 on each. Real routers,
// mounted in the registry's order, over HTTP.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-media-route-secret-0123456789-abcdefghijklmnop';
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { routeModules } = require('../lib/registerRoutes');

test('a lecture link reaches the lecture route, and a picture still reaches the picture route', async () => {
  const mediaIndex = routeModules.findIndex(([, mod]) => mod === '../routes/media');
  const lmsIndex = routeModules.findIndex(([, mod]) => mod === '../routes/lms');
  assert.ok(mediaIndex >= 0 && lmsIndex > mediaIndex, 'the picture route is mounted first — which is what hid the lectures');

  const app = express();
  app.use(require('../routes/media'));
  // Stands in for routes/lms.js, mounted after, as in production.
  app.get('/api/media/lectures/:lectureId', (req, res) => res.redirect(302, `https://youtube.test/${req.params.lectureId}`));
  app.use((_req, res) => res.status(404).end());
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const lecture = await fetch(`${base}/api/media/lectures/lec-1790000000000?ticket=abc`, { redirect: 'manual' });
    assert.equal(lecture.status, 302, 'the lecture route answered');
    const picture = await fetch(`${base}/api/media/tenant-default/${'a'.repeat(24)}.webp`);
    assert.equal(picture.status, 404, 'the picture route answered (no such file here)');
    assert.notEqual(picture.headers.get('cache-control'), null);
  } finally {
    server.close();
  }
});
