'use strict';
// routes/auth.js is assembled from routes/auth/*.js. The tests that read the
// sign-in code as text read all of it, in the order the routes are matched:
// the shared requires, then each part as routes/auth.js lists it.
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = path.join(__dirname, '..', 'routes');

function authRouteSource() {
  const index = fs.readFileSync(path.join(ROUTES, 'auth.js'), 'utf8');
  const list = index.match(/const PARTS = \[([\s\S]*?)\]/);
  const parts = list ? [...list[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]) : [];
  return [index, '_shared', ...parts]
    .map(part => (part === index ? part : fs.readFileSync(path.join(ROUTES, 'auth', `${part}.js`), 'utf8')))
    .join('\n');
}

module.exports = { authRouteSource };
