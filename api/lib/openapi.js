'use strict';

const fs = require('fs');
const path = require('path');

const ROUTE_RE = /\brouter\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;
const APP_ROUTE_RE = /\bapp\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;

function toOpenApiPath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function humanizeOperation(method, routePath) {
  return `${method.toUpperCase()} ${routePath}`;
}

function readRouteFiles(routesDir) {
  return fs.readdirSync(routesDir)
    .filter(name => name.endsWith('.js'))
    .sort()
    .map(name => ({
      name,
      fullPath: path.join(routesDir, name),
      source: fs.readFileSync(path.join(routesDir, name), 'utf8'),
    }));
}

function addOperation(paths, method, routePath, sourceFile) {
  if (!routePath.startsWith('/')) return;
  const openApiPath = toOpenApiPath(routePath);
  paths[openApiPath] = paths[openApiPath] || {};
  paths[openApiPath][method] = {
    summary: humanizeOperation(method, routePath),
    tags: [sourceFile.replace(/\.js$/, '')],
    'x-source-file': sourceFile,
    responses: {
      200: { description: 'Successful response' },
      400: { description: 'Invalid request' },
      401: { description: 'Authentication required' },
      403: { description: 'Forbidden' },
      500: { description: 'Server error' },
    },
  };
}

function collectRoutesFromSource(paths, source, sourceFile, regex) {
  let match;
  while ((match = regex.exec(source)) !== null) {
    const method = match[1].toLowerCase();
    const routePath = match[3];
    addOperation(paths, method, routePath, sourceFile);
  }
}

function sortPaths(paths) {
  return Object.keys(paths).sort().reduce((acc, key) => {
    const methods = paths[key];
    acc[key] = Object.keys(methods).sort().reduce((methodAcc, method) => {
      methodAcc[method] = methods[method];
      return methodAcc;
    }, {});
    return acc;
  }, {});
}

function buildOpenApiSpec(options = {}) {
  const routesDir = options.routesDir || path.join(__dirname, '..', 'routes');
  const title = options.title || 'Institute of Psychological Studies API';
  const version = options.version || process.env.npm_package_version || '1.0.0';
  const paths = {};

  for (const file of readRouteFiles(routesDir)) {
    collectRoutesFromSource(paths, file.source, file.name, new RegExp(ROUTE_RE));
  }

  if (options.serverFile) {
    const source = fs.readFileSync(options.serverFile, 'utf8');
    collectRoutesFromSource(paths, source, path.basename(options.serverFile), new RegExp(APP_ROUTE_RE));
  }

  return {
    openapi: '3.0.0',
    info: {
      title,
      version,
      description: 'Generated from Express route declarations in the Mahad API codebase.',
    },
    servers: [{ url: '/api' }],
    paths: sortPaths(paths),
  };
}

function openApiHtml(jsonUrl = '/api/openapi.json') {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mahad API Docs</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f8fafc; color: #111827; }
    main { max-width: 1100px; margin: 0 auto; padding: 32px 18px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 18px; }
    h1 { font-size: 24px; margin: 0; }
    a { color: #2563eb; text-decoration: none; }
    input { width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; margin-bottom: 16px; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    .route { display: grid; grid-template-columns: 88px 1fr 180px; gap: 12px; padding: 12px 14px; border-top: 1px solid #e5e7eb; align-items: center; direction: ltr; }
    .route:first-child { border-top: 0; }
    .method { font-weight: 700; font-size: 12px; color: #fff; text-align: center; border-radius: 999px; padding: 5px 8px; }
    .get { background: #059669; } .post { background: #2563eb; } .put { background: #7c3aed; } .patch { background: #d97706; } .delete { background: #dc2626; }
    code { color: #111827; }
    small { color: #6b7280; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Mahad API Docs</h1>
      <a href="${jsonUrl}">OpenAPI JSON</a>
    </header>
    <input id="filter" placeholder="ابحث بالمسار أو اسم الملف...">
    <section id="routes"></section>
  </main>
  <script>
    const list = document.getElementById('routes');
    const filter = document.getElementById('filter');
    let items = [];
    function render() {
      const q = filter.value.trim().toLowerCase();
      list.innerHTML = items
        .filter(item => !q || item.path.toLowerCase().includes(q) || item.file.toLowerCase().includes(q))
        .map(item => '<div class="route"><span class="method ' + item.method + '">' + item.method.toUpperCase() + '</span><code>' + item.path + '</code><small>' + item.file + '</small></div>')
        .join('');
    }
    fetch('${jsonUrl}').then(r => r.json()).then(spec => {
      items = Object.entries(spec.paths || {}).flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, op]) => ({ path, method, file: op['x-source-file'] || '' }))
      );
      render();
    });
    filter.addEventListener('input', render);
  </script>
</body>
</html>`;
}

module.exports = {
  buildOpenApiSpec,
  openApiHtml,
};
