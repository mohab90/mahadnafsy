#!/usr/bin/env node
/**
 * Can the release's staging end-to-end run reach staging at all?
 *
 * Staging sits behind an nginx password. deploy/release-all.sh found that out at step 9 — after
 * building, uploading and deploying to staging — when every spec answered 401 (17 Oct 2026), and
 * the release stopped with staging already switched. This asks the one question first, before
 * anything is built: does staging answer, with the credentials in E2E_BASIC_AUTH if there are any?
 *
 *   node tools/check-staging-gate.mjs https://staging.mahadnafsy.com
 *
 * The credentials are read from the environment and sent as a header; they are never put on a command
 * line and never printed.
 *
 * Exit 0  staging answers (or cannot be reached — it may be about to be deployed; said so)
 * Exit 81 staging asks for a password and E2E_BASIC_AUTH is not set
 * Exit 82 staging refused the password in E2E_BASIC_AUTH
 */
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

/** One GET, answering the status. Certificate errors are ignored, as the E2E's own clients do (ignoreHTTPSErrors). */
function get(url, headers) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { method: 'GET', headers, rejectUnauthorized: false, timeout: 20_000 }, res => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

export async function checkStagingGate(origin, { credentials = process.env.E2E_BASIC_AUTH, fetchImpl = get } = {}) {
  const headers = {};
  const given = String(credentials || '').trim();
  if (given) headers.authorization = `Basic ${Buffer.from(given).toString('base64')}`;
  let response;
  try {
    response = await fetchImpl(new URL('/api/health/live', origin), headers);
  } catch (error) {
    return { code: 0, state: 'unreachable', message: `staging did not answer (${error.code || error.name}); the E2E checks it again after the deploy` };
  }
  if (response.status !== 401) return { code: 0, state: 'open', message: `staging answers (${response.status})${given ? ' with the gate credentials' : ''}` };
  if (!given) {
    return {
      code: 81, state: 'needs-credentials',
      message: 'staging asks for a password (nginx basic auth) and E2E_BASIC_AUTH is not set — the E2E would answer 401 to everything.\n'
        + 'Put it once in deploy/release.local.env (git-ignored; see deploy/release.local.env.example):\n  E2E_BASIC_AUTH=user:password',
    };
  }
  return { code: 82, state: 'wrong-credentials', message: 'staging refused the password in E2E_BASIC_AUTH — check deploy/release.local.env' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.argv[2] || 'https://staging.mahadnafsy.com';
  const result = await checkStagingGate(origin);
  (result.code ? console.error : console.log)(`[staging-gate] ${result.message}`);
  process.exit(result.code);
}
