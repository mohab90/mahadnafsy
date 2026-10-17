import { request, type APIRequestContext } from '@playwright/test';

/**
 * The nginx password in front of staging, for the requests a spec makes outside the browser.
 *
 * playwright.config.ts gives the browser its httpCredentials from E2E_BASIC_AUTH, but a bare
 * `request.newContext()` is a separate client that never sees them — so against a gated staging the
 * API specs answered 401 even with the password set, and the ones that accept a 401 (the checkout
 * must refuse an anonymous charge) passed for the wrong reason. Every spec that talks to the API
 * directly takes its context from here.
 */
const basicAuth = (process.env.E2E_BASIC_AUTH || '').trim();
const split = basicAuth.indexOf(':');

export const httpCredentials = split > 0
  ? { username: basicAuth.slice(0, split), password: basicAuth.slice(split + 1) }
  : undefined;

/** An API client with no session of its own — only the staging gate's credentials, when there are any. */
export const publicApi = (): Promise<APIRequestContext> =>
  request.newContext({ ignoreHTTPSErrors: true, ...(httpCredentials ? { httpCredentials } : {}) });
