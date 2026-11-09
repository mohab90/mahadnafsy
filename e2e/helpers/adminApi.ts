import type { Page } from '@playwright/test';

/**
 * Calls the API as the signed-in page does — from inside the page, with its cookie.
 *
 * `page.request` is a separate client: it will not send the session cookie (it is Secure and the local servers speak http), so a read through it comes back
 * 401 and a spec that treats "no answer" as "nothing to compare" quietly stops checking. From the page it is the same call the screens make.
 */
export async function apiCall<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T | null }> {
  return page.evaluate(async ({ method, path, body }) => {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  }, { method, path, body }) as Promise<{ status: number; body: T | null }>;
}
