# Production QA Report - 2026-06-09

## Scope

Production admin tested on `https://admin.mahadnafsy.com` after fixing the bad `/new/admin` deployment path and stale assets.

## Fixes Applied

- Fixed admin deployment target from `/public_html/new/admin` to `/public_html/admin`.
- Added deployment backup before every admin upload.
- Removed unsafe hard-coded asset cleanup from deploy script.
- Cleaned old timestamped admin JS assets after verifying the current build.
- Fixed leads creation crash when old production records have `phone = null`.
- Hardened additional phone duplicate checks in consultation, join-us, and import flows.

## Verified Production Build

- Active build: `202606091934`.
- Current admin JS assets after cleanup: 74 files.
- `index.html` references current entry/vendor assets only.
- Final reload checks passed for leads and online clients with no ErrorBoundary, no preload error, and no `Cannot read` crash.

## Section QA Results

| Section | Result | Evidence | Score |
|---|---:|---|---:|
| API health | PASS | `/api/health/live` and `/api/health` previously returned 200 during production check | 9.0 |
| Dashboard overview | PASS | Revenue, clients, 9190 leads, sales table rendered after full load | 8.7 |
| Leads / CRM | PASS after fix | 9171 active leads, 100 rows, lead creation succeeded, DB confirmed write, QA row deleted | 8.8 |
| Online clients | PASS | 948 total clients, 113 rows, 1478 table cells | 9.0 |
| Daqqi schedule | PASS | `عملاء فرع الدقي (4 / 4)`, 14 rows, 122 cells | 8.8 |
| HR | PASS | 17 employees rendered after full load | 8.5 |
| Financial | PASS | Revenue/expenses/profit panels rendered, financial data visible | 8.4 |
| Orders/payments | PASS with filter note | 149 orders, 144 confirmed payments, filtered table can show empty state | 8.5 |
| Deployment hygiene | PASS after fix | Wrong path fixed, stale timestamped assets cleaned safely | 8.8 |
| Code maintainability | RISK | Largest files still exceed healthy targets | 7.8 |

## Customer Flow Tested

1. Admin CRM opens and loads production leads.
2. Add lead modal opens.
3. Required fields filled: name, phone, email, source, branch, notes.
4. Save succeeds from UI.
5. UI count increased from 9171 to 9172.
6. DB confirmed row with source `Google Sheet` and branch `ONLINE_EGYPT`.
7. QA test row deleted from `leads`; remaining matching rows = 0.

## Main Weak Points

- `SiteDataContext.tsx` still contains too much CRM write logic and optimistic persistence.
- Some admin saves are not awaited, so API failures can be hidden from the UI.
- Dashboard and Leads remain too large for fast safe changes.
- Production schema still has drift from local assumptions; runtime migrations remain a reliability risk.
- No full automated Playwright/API regression suite for production-like data yet.

## Current Large File Sizes

| File | Current lines | Healthy target |
|---|---:|---:|
| `admin/pages/Dashboard.tsx` | 11239 | 3500-4500 |
| `admin/pages/dashboard/tabs/LeadsTab.tsx` | 5133 | 2000-2800 |
| `admin/pages/UnifiedClientPage.tsx` | 4054 | 1800-2400 |
| `api/routes/core.js` | 2935 | 1200-1800 |
| `admin/pages/dashboard/tabs/FinancialTab.tsx` | 2614 | 1300-1800 |
| `client/pages/UserDashboard.tsx` | 2407 | 1300-1800 |
| `admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx` | 2609 | 1300-1700 |
| `admin/context/SiteDataContext.tsx` | 2253 | 800-1200 |
| `api/server.js` | 813 | 800-1200 |

## Overall Score

Current production functionality: **8.7/10**.

Current engineering quality: **8.2/10**.

The project is operational and materially healthier than before, but it is not honestly 10/10 until the remaining large-file splits, awaited API writes, schema migration cleanup, and automated regression suite are complete.

