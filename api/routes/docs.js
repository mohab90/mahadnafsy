'use strict';
// API documentation — serves the OpenAPI spec + a Swagger UI viewer.
// Spec lives in api/docs/openapi.json (curated: health/auth/catalog/orders).
// Swagger UI is loaded from a CDN, so there is no npm dependency to install.
const express = require('express');
const path = require('path');
const router = express.Router();
const { publicLimiter } = require('../middleware/rateLimits');

const SPEC_PATH = path.join(__dirname, '..', 'docs', 'openapi.json');

// Raw spec (machine-readable — import into Postman/Insomnia/codegen).
router.get('/api/openapi.json', publicLimiter, (_req, res) => {
  res.sendFile(SPEC_PATH, (err) => {
    if (err) res.status(500).json({ error: 'spec not found' });
  });
});

// Human-readable Swagger UI.
router.get('/api/docs', publicLimiter, (_req, res) => {
  // The global CSP sets script-src 'none'; relax it for THIS page only so the
  // Swagger UI bundle (jsdelivr CDN) can load. Scoped to the docs response.
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "img-src 'self' data: https:; font-src 'self' https://cdn.jsdelivr.net; " +
    "worker-src 'self' blob:; connect-src 'self'");
  res.type('html').send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Mahad Nafsy API — التوثيق</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
    });
  </script>
</body>
</html>`);
});

module.exports = router;
