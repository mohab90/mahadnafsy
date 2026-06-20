import { test, expect, request } from '@playwright/test';

const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001';

test.describe('Public site smoke', () => {
  test('home page renders', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.status(), 'home should not be a server/client error').toBeLessThan(400);
    await expect(page).toHaveTitle(/.+/); // has a non-empty title
  });

  test('courses page lists programs', async ({ page }) => {
    const resp = await page.goto('/courses');
    expect(resp?.status()).toBeLessThan(400);
    // page mounts (root react node present); content is data-driven so we assert no crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('join-us page is reachable (regression: was 404)', async ({ page }) => {
    const resp = await page.goto('/join-us');
    expect(resp?.status(), '/join-us must not 404').toBeLessThan(400);
  });

  test('auth page renders', async ({ page }) => {
    const resp = await page.goto('/auth');
    expect(resp?.status()).toBeLessThan(400);
  });
});

test.describe('API health', () => {
  test('liveness probe returns 200', async () => {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });
    const r = await ctx.get(`${API}/api/health/live`);
    expect(r.status()).toBe(200);
    await ctx.dispose();
  });

  test('public courses endpoint responds with an array', async () => {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });
    const r = await ctx.get(`${API}/api/courses`);
    expect(r.status()).toBeLessThan(400);
    const body = await r.json().catch(() => null);
    expect(Array.isArray(body) || Array.isArray(body?.courses) || body?.data).toBeTruthy();
    await ctx.dispose();
  });

  test('course student counts are never negative (regression guard)', async () => {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });
    const r = await ctx.get(`${API}/api/courses`);
    const body = await r.json().catch(() => []);
    const courses = Array.isArray(body) ? body : (body?.courses || body?.data || []);
    for (const c of courses) {
      if (typeof c?.students === 'number') {
        expect(c.students, `course ${c.id || c.title} has negative students`).toBeGreaterThanOrEqual(0);
      }
    }
    await ctx.dispose();
  });
});
