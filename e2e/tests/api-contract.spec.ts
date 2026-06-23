import { test, expect, request } from '@playwright/test';

/**
 * API contract / security-boundary suite. Runs WITHOUT credentials (CI-safe) so
 * it always executes — it only needs the API to be up (API_BASE_URL).
 *
 * Purpose: lock the auth boundary on the critical admin/finance/staff endpoints.
 * This is the real safety net behind any admin refactor — if a change ever
 * accidentally drops `requireAuth`/`requirePermission` from one of these routes,
 * the unauthenticated call would start returning 200 and this suite fails.
 */
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001';

test.describe('Health', () => {
  test('liveness endpoint responds 200', async () => {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });
    const r = await ctx.get(`${API}/api/health/live`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe('ok');
    await ctx.dispose();
  });
});

test.describe('Auth boundary — protected endpoints reject anonymous access', () => {
  // Each entry: [method, path] — every one is behind requireAuth (+ role/permission).
  // An unauthenticated call must NEVER return 2xx. 401/403 expected; 404/429 also
  // acceptable (route-shape / rate-limit) — the invariant is simply "not authorized".
  const PROTECTED: Array<['get' | 'post' | 'patch' | 'delete', string]> = [
    ['get',   '/api/staff/subscribers'],
    ['get',   '/api/admin/refund-requests'],
    ['get',   '/api/admin/funnel'],
    ['get',   '/api/admin/hr/payroll'],
    ['get',   '/api/admin/accounting-periods'],
    ['post',  '/api/admin/accounting-periods/does-not-exist/close'],
    ['get',   '/api/me/subscriber'],
    ['get',   '/api/admin/monitoring'],
  ];

  for (const [method, path] of PROTECTED) {
    test(`${method.toUpperCase()} ${path} is not reachable without a token`, async () => {
      const ctx = await request.newContext({ ignoreHTTPSErrors: true });
      const r = await ctx[method](`${API}${path}`, { data: {} });
      expect(r.status(), `${method} ${path} must require auth`).not.toBeLessThan(400);
      expect([401, 403, 404, 429]).toContain(r.status());
      await ctx.dispose();
    });
  }
});

test.describe('Money endpoints never act without auth', () => {
  test('checkout-intent rejects anonymous calls (no anonymous lead/charge)', async () => {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });
    const r = await ctx.post(`${API}/api/public/checkout-intent`, { data: { courseId: 'x' } });
    expect([401, 403, 400, 429]).toContain(r.status());
    await ctx.dispose();
  });

  test('payment-proof upload requires auth', async () => {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });
    const r = await ctx.post(`${API}/api/me/payment-proof`, { data: {} });
    expect(r.status()).not.toBeLessThan(400);
    await ctx.dispose();
  });
});
