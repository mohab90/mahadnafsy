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

// The checkout is routes/public-orders.js and the three modules it was split
// into; read together, in the order the code used to stand.
function checkoutSource() {
  return ['routes/public-orders.js', 'lib/orderFields.js', 'lib/paymobGateway.js', 'lib/paymobFinalise.js']
    .map(rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'))
    .join('\n');
}

// «الطلبات والمدفوعات» is admin/pages/dashboard/tabs/OrdersTab.tsx choosing one
// of three views under tabs/orders/; read together.
function ordersScreenSource() {
  const tabs = path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs');
  return ['OrdersTab.tsx', 'orders/ordersTypes.ts', 'orders/useOrderActions.ts',
    'orders/OrdersOnlineManagerView.tsx', 'orders/OrdersDaqqiView.tsx', 'orders/OrdersAdminView.tsx']
    .map(rel => fs.readFileSync(path.join(tabs, rel), 'utf8'))
    .join('\n');
}

// routes/admin/leads.js (and every route file split the same way) is an index
// that lists its parts; the parts live in a folder of the same name, beside a
// _shared.js of their requires and helpers.
const SPLIT_ROUTES = { 'routes/admin/leads.js': 'routes/admin/leads', 'routes/finance.js': 'routes/finance' };
const API = path.join(__dirname, '..');

function splitRouteSource(rel) {
  const index = fs.readFileSync(path.join(API, rel), 'utf8');
  const list = index.match(/const PARTS = \[([\s\S]*?)\]/);
  const parts = list ? [...list[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]) : [];
  return [index, ...['_shared', ...parts]
    .map(part => fs.readFileSync(path.join(API, SPLIT_ROUTES[rel], `${part}.js`), 'utf8'))]
    .join('\n');
}

const leadsRouteSource = () => splitRouteSource('routes/admin/leads.js');

// Any API file as text, whole: the split route files are read with their parts.
// Takes the path from api/ or from the repository root.
function sourceOf(rel) {
  const key = String(rel).replace(/^api\//, '');
  if (key === 'routes/auth.js') return authRouteSource();
  if (SPLIT_ROUTES[key] && fs.existsSync(path.join(API, SPLIT_ROUTES[key]))) return splitRouteSource(key);
  return fs.readFileSync(path.join(API, key), 'utf8');
}

module.exports = { authRouteSource, checkoutSource, leadsRouteSource, ordersScreenSource, sourceOf };
