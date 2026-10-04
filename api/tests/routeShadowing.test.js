'use strict';
// A route like GET /x/:id registered before GET /x/summary answers for it:
// «summary» is read as an id. That is how the monthly attendance table read
// empty for as long as it existed — /api/admin/hr/attendance/:staffId came
// first. Every such pair must be one whose :param handler deliberately hands
// the fixed word on with next(), and is listed here with the reason.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = new Map([
  ['GET /api/admin/hr/attendance/summary', "routes/hr/attendance.js passes «summary» on with next()"],
]);

// Requiring every router opens the pools and timers they hold; nothing here
// needs them, so the file ends once its test has.
after(() => setTimeout(() => process.exit(), 300).unref());

test('no fixed route is swallowed by a :param route registered before it', () => {
  const { routeModules } = require('../lib/registerRoutes');
  const all = [];
  const walk = (stack, mod) => {
    for (const layer of stack || []) {
      if (layer.route) for (const method of Object.keys(layer.route.methods)) all.push({ method, path: layer.route.path, mod });
      else if (layer.handle?.stack) walk(layer.handle.stack, mod);
    }
  };
  for (const [, mod] of routeModules) walk(require(path.join(__dirname, '..', 'lib', mod)).stack, mod);
  assert.ok(all.length > 500, 'the walk reaches the routers');
  const found = [];
  all.forEach((a, i) => {
    if (typeof a.path !== 'string' || !a.path.includes(':')) return;
    const re = new RegExp(`^${a.path.replace(/:[A-Za-z_]+/g, '[^/]+')}$`);
    for (const b of all.slice(i + 1)) {
      if (b.method === a.method && typeof b.path === 'string' && !b.path.includes(':') && re.test(b.path)) {
        found.push(`${b.method.toUpperCase()} ${b.path}`);
      }
    }
  });
  assert.deepEqual(found.filter(key => !ALLOWED.has(key)), [], 'shadowed by an earlier :param route');
  const attendance = fs.readFileSync(path.join(__dirname, '..', 'routes', 'hr', 'attendance.js'), 'utf8');
  assert.match(attendance, /if \(req\.params\.staffId === 'summary'\) return next\(\);/);
});
