// OpenAPI generator (Top20 #17). Scans api/routes/*.js for route declarations
// and emits an OpenAPI 3.0 document covering every endpoint, so the spec can
// never silently fall behind the code. Re-run after adding/removing routes:
//   node tools/gen-openapi.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROUTES = path.resolve('api', 'routes');
const OUT = path.resolve('api', 'docs', 'openapi.json');

const RE = /router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
const paths = {};
let count = 0;

for (const file of fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(ROUTES, file), 'utf8');
  const tag = file.replace(/\.js$/, '');
  let m;
  while ((m = RE.exec(src))) {
    const method = m[1];
    const route = m[3];
    if (!route.startsWith('/')) continue;
    // OpenAPI path params: Express :id → {id}
    const oaPath = route.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    paths[oaPath] = paths[oaPath] || {};
    const isAdmin = oaPath.includes('/admin/');
    paths[oaPath][method] = {
      tags: [tag],
      summary: `${method.toUpperCase()} ${route}`,
      ...(isAdmin ? { security: [{ bearerAuth: [] }] } : {}),
      responses: {
        200: { description: 'OK' },
        ...(isAdmin ? { 401: { description: 'Unauthorized' }, 403: { description: 'Forbidden' } } : {}),
        500: { description: 'Internal server error' },
      },
    };
    count++;
  }
}

const doc = {
  openapi: '3.0.3',
  info: {
    title: 'Mahad Nafsy API',
    version: '2.0.0',
    description: 'Auto-generated from api/routes/*.js by tools/gen-openapi.mjs. Operation bodies are stubs; enrich summaries/schemas as needed.',
  },
  servers: [{ url: 'https://mahadnafsy.com' }, { url: 'http://127.0.0.1:3001' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`OpenAPI written: ${Object.keys(paths).length} paths, ${count} operations → ${path.relative(process.cwd(), OUT)}`);
