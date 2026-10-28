# E2E — Playwright smoke suite

End-to-end smoke tests for the public site, API health, and admin login.
They run against a **running** deployment (local dev servers or production).

## Setup (once)

```bash
cd e2e
npm install
npm run install:browsers   # downloads Chromium
```

## Run

Against local dev (start the apps first: `npm run start:api`, `start:client`, `start:admin` from repo root):

```bash
npm test
```

Against production:

```bash
BASE_URL=https://mahadnafsy.com \
ADMIN_BASE_URL=https://admin.mahadnafsy.com \
API_BASE_URL=https://mahadnafsy.com \
npm test
```

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `BASE_URL` | `http://127.0.0.1:3000` | public site |
| `ADMIN_BASE_URL` | `http://127.0.0.1:4000` | admin dashboard |
| `API_BASE_URL` | `http://127.0.0.1:3001` | REST API |
| `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` | — | enable the real admin-login spec (use a disposable test account) |

## Coverage

- **public-smoke**: home, courses, `/join-us` (404 regression), `/auth`, API liveness, `/api/courses` shape, and a **negative-student-count regression guard**.
- **admin-login**: login page renders; authenticated Admin and every employee role render in `admin-permissions`.

- **ci-journeys** (needs the seed, `E2E_SEEDED=1`): a course page; checkout up to
  the redirect to Paymob (the Paymob call is answered by the spec); a paid
  student opening a paid lecture from the dashboard; an administrator's leads list.

## Against a local build, as CI runs it (the `browser-e2e` job)

```bash
# a throwaway database, migrated and seeded (the seed refuses a name without ci/e2e/test/local)
mysql -e 'CREATE DATABASE mahad_e2e_local'
DB_NAME=mahad_e2e_local npm run migrate
DB_NAME=mahad_e2e_local node api/tools/e2e-seed.cjs
# the API, then the built site and admin with /api proxied to it
DB_NAME=mahad_e2e_local PORT=3105 CUSTOMER_MAX_DEVICES=50 ACCOUNT_MAX_DISTINCT_DEVICES=50 WA_WEB_DISABLED=1 RUN_MIGRATIONS_ON_STARTUP=false node api/server.js &
npm --prefix client run build && (cd client && VITE_API_PROXY_TARGET=http://127.0.0.1:3105 npx vite preview --port 3000 &)
npm --prefix admin run build && (cd admin && VITE_API_PROXY_TARGET=http://127.0.0.1:3105 npx vite preview --port 4000 &)
cd e2e && E2E_SEEDED=1 API_BASE_URL=http://127.0.0.1:3105 npx playwright test \
  tests/public-smoke.spec.ts tests/admin-login.spec.ts tests/payment-flow.spec.ts tests/ci-journeys.spec.ts
```

With a Chromium already installed (no download), point Playwright at it with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`. The seeded accounts are
`e2e.admin@mahad.test` / `MahadE2e#Admin2026` and `uat.student@mahad.test` /
`MahadUat#2026` (override with `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` and
`TEST_STUDENT_EMAIL`/`TEST_STUDENT_PASSWORD`, for the seed and the specs alike).
