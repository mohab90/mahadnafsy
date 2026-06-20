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
- **admin-login**: login page renders; full sign-in runs only when test credentials are supplied.

Extend with lead→payment→client and Daqqi flows once a seeded test account exists.
