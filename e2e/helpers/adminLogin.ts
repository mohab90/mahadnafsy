import type { Page } from '@playwright/test';
import { generate } from 'otplib';

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
  'منتهي الصلاحية', // رمز/كود غير صحيح أو منتهي الصلاحية
  'تعذر', 'خطأ', 'فشل',
  'invalid', 'failed', 'unauthorized',
];
const refusalIn = (text: string) =>
  LOGIN_REFUSED.find(needle => text.toLowerCase().includes(needle.toLowerCase()));

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
  let mfaAttempts = 0;
  while (Date.now() < deadline) {
    const otp = page.locator('input[placeholder="000000"]').first();
    const invalidOtp = page.getByText(/غير صحيح|منتهي الصلاحية|invalid|expired/i).first();
    const invalidOtpVisible = await invalidOtp.isVisible().catch(() => false);
    if (await otp.isVisible().catch(() => false)
      && mfaAttempts < 2
      && (mfaAttempts === 0 || invalidOtpVisible)) {
      const secret = String(process.env.UAT_TOTP_SECRET || '');
      if (secret.length < 16) throw new Error(`MFA challenge received for ${email} without UAT_TOTP_SECRET`);
      if (mfaAttempts > 0) {
        const untilNextStep = 30_000 - (Date.now() % 30_000) + 500;
        await page.waitForTimeout(untilNextStep);
      }
      await otp.fill(await generate({ secret }));
      await page.getByRole('button', { name: /تأكيد الدخول|verify|confirm/i }).first().click();
      mfaAttempts++;
      await page.waitForTimeout(300);
      if (await invalidOtp.isVisible().catch(() => false)) continue;
    }
    const emailVisible = await page.locator('input[type="email"], input[name="email"]').first()
      .isVisible().catch(() => false);
    const bodyText = ((await page.locator('body').innerText().catch(() => '')) || '').trim();
    // The session is an httpOnly cookie, so the page cannot see it and neither
    // can we — reading localStorage here made this helper permanently unable to
    // report success. Ask the context for the cookie instead.
    const cookies = await page.context().cookies().catch(() => []);
    const signedIn = cookies.some(c => c.name === 'authToken' && Boolean(c.value));
    if (signedIn && !emailVisible && !await otp.isVisible().catch(() => false) && bodyText.length > 80) return;
    const refusal = refusalIn(bodyText);
    if (refusal) {
      throw new Error(`login refused for ${email} (matched "${refusal}"): ${bodyText.slice(0, 240)}`);
    }
    await page.waitForTimeout(250);
  }
  // Say what was actually on screen. "dashboard did not render" on its own sent
  // every diagnosis back to guessing at the network.
  const otpVisible = await page.locator('input[placeholder="000000"]').first().isVisible().catch(() => false);
  const emailStillVisible = await page.locator('input[type="email"], input[name="email"]').first()
    .isVisible().catch(() => false);
  const hasToken = (await page.context().cookies().catch(() => []))
    .some(c => c.name === 'authToken' && Boolean(c.value));
  const seen = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  throw new Error(
    `login did not complete for ${email} after 75s — url=${page.url()} authToken=${hasToken} `
    + `loginFormVisible=${emailStillVisible} otpPromptVisible=${otpVisible} mfaAttempts=${mfaAttempts}`
    + `${otpVisible && !process.env.UAT_TOTP_SECRET ? ' (MFA is on and UAT_TOTP_SECRET is unset)' : ''}`
    + ` — screen: ${seen.slice(0, 240) || '(blank)'}`,
  );
}
