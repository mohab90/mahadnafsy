import type { Page } from '@playwright/test';

// The messages admin/pages/Auth.tsx actually renders when a sign-in does not go
// through. The previous pattern — تعذر|خطأ|فشل|invalid|failed|unauthorized —
// matched none of them, so a wrong password or a rate-limited account was never
// recognised as a failure: the poll below just spun until the hook was torn
// down, and the run reported "target page has been closed", which says nothing
// about why. Kept as source strings so a reworded notice is a visible mismatch.
const LOGIN_REFUSED = [
  'غير صحيحة',      // البريد الإلكتروني أو كلمة المرور غير صحيحة
  'محاولات كثيرة',  // rate limiter: 15 per account / 50 per network per 15 min
  'غير متاح',       // الخادم غير متاح حالياً
  'منتهي الصلاحية', // كود غير صحيح أو منتهي الصلاحية
  'تعذر', 'خطأ', 'فشل',
  'invalid', 'failed', 'unauthorized',
];
const refusalIn = (text: string) =>
  LOGIN_REFUSED.find(needle => text.toLowerCase().includes(needle.toLowerCase()));

/**
 * An important account is sent a code by email after the password (api/lib/loginEmailCode.js; shared/ui/EmailCodeStep.tsx). A test cannot
 * read a mailbox, so the environment it signs in to runs with the security policy off (الأمان ← سياسة MFA) and this stops with that
 * message instead of waiting for a code that no test can type.
 */
async function failOnEmailCodeStep(page: Page, email: string) {
  const code = page.locator('input[autocomplete="one-time-code"]').first();
  if (await code.isVisible().catch(() => false)) {
    throw new Error(`${email} is asked for an emailed code — a test environment runs with the security policy off (الأمان ← سياسة MFA)`);
  }
}

export async function loginAdmin(page: Page, baseUrl: string, email: string, password: string) {
  // 'commit', not 'domcontentloaded': the admin SPA routes '/' → '/dashboard'
  // from the router the moment it boots, and if that client-side navigation
  // lands while goto is still settling, Chromium aborts the original one and
  // goto throws "net::ERR_ABORTED; maybe frame was detached?". Which of the two
  // wins is a race, so it failed intermittently and only against a real
  // deployment, where the bundle is big enough for the timing to go either way.
  // 'commit' resolves as soon as the response starts, before the app can
  // redirect; the wait below is what actually gates on the form being there.
  await page.goto(baseUrl, { waitUntil: 'commit' });
  await page.locator('input[type="email"], input[name="email"]').first()
    .waitFor({ state: 'visible', timeout: 45_000 });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.getByRole('button', { name: /دخول|تسجيل|login|sign/i }).first().click();

  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    await failOnEmailCodeStep(page, email);
    const emailVisible = await page.locator('input[type="email"], input[name="email"]').first()
      .isVisible().catch(() => false);
    const bodyText = ((await page.locator('body').innerText().catch(() => '')) || '').trim();
    // The session is an httpOnly cookie, so the page cannot see it and neither
    // can we — reading localStorage here made this helper permanently unable to
    // report success. Ask the context for the cookie instead.
    const cookies = await page.context().cookies().catch(() => []);
    const signedIn = cookies.some(c => c.name === 'authToken' && Boolean(c.value));
    if (signedIn && !emailVisible && bodyText.length > 80) return;
    const refusal = refusalIn(bodyText);
    if (refusal) {
      throw new Error(`login refused for ${email} (matched "${refusal}"): ${bodyText.slice(0, 240)}`);
    }
    await page.waitForTimeout(250);
  }
  // Say what was actually on screen. "dashboard did not render" on its own sent
  // every diagnosis back to guessing at the network.
  const emailStillVisible = await page.locator('input[type="email"], input[name="email"]').first()
    .isVisible().catch(() => false);
  const hasToken = (await page.context().cookies().catch(() => []))
    .some(c => c.name === 'authToken' && Boolean(c.value));
  const seen = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  throw new Error(
    `login did not complete for ${email} after 75s — url=${page.url()} authToken=${hasToken} `
    + `loginFormVisible=${emailStillVisible}`
    + ` — screen: ${seen.slice(0, 240) || '(blank)'}`,
  );
}
