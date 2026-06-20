#!/usr/bin/env node

const apiPort = Number(process.env.API_PORT || process.argv[2] || 3101);
const baseUrl = `http://127.0.0.1:${apiPort}`;

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

function assertStatus(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name}: expected HTTP ${expected}, got ${actual}`);
  }
}

const checks = [
  {
    name: 'api live health',
    run: async () => assertStatus('api live health', (await request('/api/health/live')).status, 200),
  },
  {
    name: 'api db health',
    dbBacked: true,
    run: async () => {
      const result = await request('/api/health');
      if (result.status === 503) {
        const error = new Error('DB readiness returned HTTP 503');
        error.blocked = true;
        throw error;
      }
      assertStatus('api db health', result.status, 200);
    },
  },
  {
    name: 'paymob init suspended',
    run: async () => assertStatus('paymob init suspended', (await request('/api/payments/paymob-init', { method: 'POST', body: '{}' })).status, 503),
  },
  {
    name: 'paymob verify suspended',
    run: async () => assertStatus('paymob verify suspended', (await request('/api/paymob/verify', { method: 'POST', body: '{}' })).status, 503),
  },
  {
    name: 'paymob webhook suspended ack',
    run: async () => assertStatus('paymob webhook suspended ack', (await request('/api/webhooks/paymob', { method: 'POST', body: '{}' })).status, 200),
  },
  {
    name: 'order reserve validation',
    run: async () => assertStatus('order reserve validation', (await request('/api/orders/reserve', { method: 'POST', body: '{}' })).status, 400),
  },
  {
    name: 'facebook webhook verification rejects bad token',
    run: async () => assertStatus('facebook webhook verification rejects bad token', (await request('/api/webhooks/facebook-leads?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=x')).status, 403),
  },

  // ── Auth & authorization ────────────────────────────────────────────────
  {
    name: 'register rejects missing credentials',
    run: async () => assertStatus('register rejects missing credentials', (await request('/api/auth/register', { method: 'POST', body: '{}' })).status, 400),
  },
  {
    name: 'register rejects short password',
    run: async () => assertStatus('register rejects short password', (await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'smoke@test.local', password: '123' }) })).status, 400),
  },
  {
    name: 'login rejects unknown user',
    dbBacked: true,
    run: async () => {
      const r = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: `nouser-${Date.now()}@test.local`, password: 'wrong-password-1' }) });
      if (![400, 401, 404].includes(r.status)) throw new Error(`login rejects unknown user: expected 400/401/404, got ${r.status}`);
    },
  },
  {
    name: 'admin endpoint requires auth (401)',
    run: async () => assertStatus('admin endpoint requires auth', (await request('/api/admin/leads')).status, 401),
  },
  {
    name: 'admin endpoint rejects garbage token (401)',
    run: async () => assertStatus('admin endpoint rejects garbage token', (await request('/api/admin/leads', { headers: { Authorization: 'Bearer not-a-real-token' } })).status, 401),
  },
  {
    name: 'hr payroll requires auth (401)',
    run: async () => assertStatus('hr payroll requires auth', (await request('/api/admin/hr/payroll')).status, 401),
  },
  {
    name: 'daqqi rounds require auth (401)',
    run: async () => assertStatus('daqqi rounds require auth', (await request('/api/admin/daqqi-rounds')).status, 401),
  },
  {
    name: 'financial reports require auth (401)',
    run: async () => assertStatus('financial reports require auth', (await request('/api/admin/reports/pl')).status, 401),
  },

  // ── Public catalog (client site data source) ────────────────────────────
  {
    name: 'public courses list',
    dbBacked: true,
    run: async () => {
      const r = await request('/api/courses');
      assertStatus('public courses list', r.status, 200);
      if (!Array.isArray(r.body) && !Array.isArray(r.body?.courses)) throw new Error('public courses list: response is not an array');
    },
  },
  {
    name: 'public bundles list',
    dbBacked: true,
    run: async () => assertStatus('public bundles list', (await request('/api/bundles')).status, 200),
  },
  {
    name: 'public therapists list',
    dbBacked: true,
    run: async () => assertStatus('public therapists list', (await request('/api/therapists')).status, 200),
  },
  {
    name: 'public site content',
    dbBacked: true,
    run: async () => assertStatus('public site content', (await request('/api/content')).status, 200),
  },
  {
    name: 'public lead submit validation',
    run: async () => {
      const r = await request('/api/leads-public', { method: 'POST', body: '{}' });
      if (![400, 422].includes(r.status)) throw new Error(`public lead submit validation: expected 400/422, got ${r.status}`);
    },
  },

  // ── Hardening invariants ────────────────────────────────────────────────
  // ── Course lifecycle (catches the "new course invisible on client site" bug) ─
  // Requires ADMIN_EMAIL + ADMIN_PASSWORD env vars; skipped when absent
  {
    name: 'course lifecycle: create → unpublished invisible → publish → visible → cleanup',
    dbBacked: true,
    run: async () => {
      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminEmail || !adminPassword) {
        const skip = new Error('ADMIN_EMAIL/ADMIN_PASSWORD env vars not set — skipped');
        skip.skipped = true;
        throw skip;
      }

      // 1. Log in as admin
      const loginRes = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      assertStatus('course lifecycle: admin login', loginRes.status, 200);
      const token = loginRes.body?.token;
      if (!token) throw new Error('course lifecycle: login returned no token');
      const auth = { Authorization: `Bearer ${token}` };

      // 2. Create an UNPUBLISHED course via admin API
      const testSlug = `smoke-test-${Date.now()}`;
      const createRes = await request('/api/admin/courses', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          title: 'Smoke Test Course',
          slug: testSlug,
          description: 'automated smoke test',
          shortDescription: 'smoke',
          instructor: 'Test',
          thumbnail: '',
          category: 'General',
          type: 'Recorded',
          price: { EGP: 100, SAR: 0, USD: 0 },
          originalPrice: { EGP: 100, SAR: 0, USD: 0 },
          isPublished: false,       // ← key: starts unpublished
          rating: 4.8,
          students: 0,
          duration: '',
          level: 'مبتدئ',
        }),
      });
      assertStatus('course lifecycle: create unpublished', createRes.status, 200);
      const courseId = createRes.body?.id;
      if (!courseId) throw new Error('course lifecycle: create returned no id');

      try {
        // 3. Public /api/courses must NOT include the unpublished course
        const publicList = await request('/api/courses?limit=500');
        assertStatus('course lifecycle: public list ok', publicList.status, 200);
        if ((publicList.body || []).some(c => c.id === courseId)) {
          throw new Error('course lifecycle: unpublished course appeared in public /api/courses — BUG!');
        }

        // 4. Admin /api/admin/courses MUST include it
        const adminList = await request('/api/admin/courses?limit=500', { headers: auth });
        assertStatus('course lifecycle: admin list ok', adminList.status, 200);
        if (!(adminList.body || []).some(c => c.id === courseId)) {
          throw new Error('course lifecycle: newly created course missing from /api/admin/courses');
        }

        // 5. Direct /api/courses/:id must return it (even unpublished — needed for admin preview)
        const directRes = await request(`/api/courses/${courseId}`);
        assertStatus('course lifecycle: direct fetch by id', directRes.status, 200);
        if (directRes.body?.id !== courseId) {
          throw new Error('course lifecycle: direct /api/courses/:id returned wrong course');
        }

        // 6. PUBLISH the course
        const publishRes = await request('/api/admin/courses', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({
            id: courseId,
            slug: testSlug,
            title: 'Smoke Test Course',
            description: 'automated smoke test',
            shortDescription: 'smoke',
            instructor: 'Test',
            thumbnail: '',
            category: 'General',
            type: 'Recorded',
            price: { EGP: 100, SAR: 0, USD: 0 },
            originalPrice: { EGP: 100, SAR: 0, USD: 0 },
            isPublished: true,       // ← now published
            rating: 4.8,
            students: 0,
            duration: '',
            level: 'مبتدئ',
          }),
        });
        assertStatus('course lifecycle: publish', publishRes.status, 200);

        // 7. Public list must NOW include it
        const publicList2 = await request('/api/courses?limit=500');
        assertStatus('course lifecycle: public list after publish', publicList2.status, 200);
        if (!(publicList2.body || []).some(c => c.id === courseId)) {
          throw new Error('course lifecycle: published course missing from public /api/courses — BUG!');
        }

        // 8. Slug lookup must work too (client site uses slug, not id)
        const slugRes = await request(`/api/courses/${testSlug}`);
        assertStatus('course lifecycle: slug lookup 200', slugRes.status, 200);
        if (slugRes.body?.id !== courseId) {
          throw new Error(`course lifecycle: slug lookup returned wrong course (got ${slugRes.body?.id})`);
        }

      } finally {
        // 9. Cleanup — delete test course regardless of outcome
        await request(`/api/admin/courses/${courseId}`, { method: 'DELETE', headers: auth });
      }
    },
  },

  // ── Input validation (validateBody middleware) ─────────────────────────
  {
    name: 'login rejects invalid email format (400)',
    run: async () => assertStatus('login rejects invalid email format', (await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'not-an-email', password: 'somepassword' }) })).status, 400),
  },
  {
    name: 'register rejects invalid email format (400)',
    run: async () => assertStatus('register rejects invalid email format', (await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: 'not-an-email', password: 'validpass123' }) })).status, 400),
  },
  {
    name: 'public leads rejects missing phone (400)',
    run: async () => assertStatus('public leads rejects missing phone', (await request('/api/leads-public', { method: 'POST', body: JSON.stringify({ name: 'Ahmed' }) })).status, 400),
  },
  {
    name: 'public leads rejects missing name (400)',
    run: async () => assertStatus('public leads rejects missing name', (await request('/api/leads-public', { method: 'POST', body: JSON.stringify({ phone: '01012345678' }) })).status, 400),
  },

  // ── Certificate requests (extracted route) ─────────────────────────────
  {
    name: 'certificate-requests requires auth (401)',
    run: async () => assertStatus('certificate-requests requires auth', (await request('/api/admin/certificate-requests')).status, 401),
  },
  {
    name: 'certificate-requests PATCH requires auth (401)',
    run: async () => assertStatus('certificate-requests PATCH requires auth', (await request('/api/admin/certificate-requests/fake-id', { method: 'PATCH', body: '{}' })).status, 401),
  },
  {
    name: 'certificate-requests DELETE requires auth (401)',
    run: async () => assertStatus('certificate-requests DELETE requires auth', (await request('/api/admin/certificate-requests/fake-id', { method: 'DELETE' })).status, 401),
  },

  // ── Security headers ────────────────────────────────────────────────────
  {
    name: 'CORS: unknown origin is rejected (no Allow-Origin header)',
    run: async () => {
      const res = await fetch(`${baseUrl}/api/health/live`, { headers: { Origin: 'https://evil-hacker.com' } });
      const acao = res.headers.get('access-control-allow-origin');
      if (acao === 'https://evil-hacker.com' || acao === '*') throw new Error(`CORS: evil origin was accepted — ACAO=${acao}`);
    },
  },
  {
    name: 'rate limit header present on admin route',
    run: async () => {
      const res = await fetch(`${baseUrl}/api/admin/leads`);
      const limit = res.headers.get('ratelimit-limit') || res.headers.get('x-ratelimit-limit');
      if (!limit) throw new Error('rate limit headers missing on /api/admin/leads');
    },
  },

  {
    name: 'unknown api route returns 404 json',
    run: async () => {
      const r = await request('/api/definitely-not-a-route');
      assertStatus('unknown api route returns 404 json', r.status, 404);
    },
  },
  {
    name: 'responses carry X-Request-ID',
    run: async () => {
      const res = await fetch(`${baseUrl}/api/health/live`);
      if (!res.headers.get('x-request-id')) throw new Error('missing X-Request-ID header');
    },
  },
  {
    name: 'responses carry CSP header',
    run: async () => {
      const res = await fetch(`${baseUrl}/api/health/live`);
      if (!res.headers.get('content-security-policy')) throw new Error('missing Content-Security-Policy header');
    },
  },
];

const results = [];
let dbBlocked = false;
for (const check of checks) {
  if (dbBlocked && check.dbBacked) {
    results.push({ name: check.name, status: 'BLOCKED', detail: 'Skipped because DB readiness is blocked' });
    continue;
  }
  try {
    await check.run();
    results.push({ name: check.name, status: 'PASS' });
  } catch (error) {
    if (error.blocked) {
      dbBlocked = true;
      results.push({ name: check.name, status: 'BLOCKED', detail: error.message });
      continue;
    }
    if (error.skipped) {
      results.push({ name: check.name, status: 'SKIP', detail: error.message });
      continue;
    }
    results.push({ name: check.name, status: 'FAIL', detail: error.message });
  }
}

for (const result of results) {
  console.log(`${result.status} ${result.name}${result.detail ? ` - ${result.detail}` : ''}`);
}

if (results.some(r => r.status === 'FAIL')) {
  process.exitCode = 1;
} else if (results.some(r => r.status === 'BLOCKED')) {
  process.exitCode = 2;
}
