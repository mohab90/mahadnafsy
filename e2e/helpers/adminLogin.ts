import type { Page } from '@playwright/test';
import { generate } from 'otplib';

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
    if (/تعذر|خطأ|فشل|invalid|failed|unauthorized/i.test(bodyText)) {
      throw new Error(`login failed for ${email}: ${bodyText.slice(0, 240)}`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`dashboard did not render after login for ${email}`);
}
