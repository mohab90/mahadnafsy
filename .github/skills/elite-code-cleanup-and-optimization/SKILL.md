---
name: elite-code-cleanup-and-optimization
description: 'Elite codebase cleanup, refactoring, and optimization skill. Use when: removing dead/unused code, refactoring complex logic, optimizing frontend/backend performance, reducing bundle size, fixing memory leaks, optimizing database queries, cleaning project structure, reducing server load (503s, high CPU/RAM), or doing a full production-grade code audit. Triggers: "clean up the code", "optimize performance", "remove unused", "refactor", "dead code", "reduce bundle", "slow queries", "memory leak", "cleanup codebase", "production audit", "technical debt".'
argument-hint: 'Optional: specify scope (frontend | backend | database | server | structure | full)'
---

# Elite Code Cleanup & Optimization

## Purpose

Transform the codebase into a cleaner, faster, lighter, and more maintainable production-grade system — **without breaking any existing functionality**.

Operate as: Senior Staff Engineer + Performance Architect + Refactoring Specialist + DevOps Optimization Engineer.

---

## Safety Contract (Read Before Every Action)

> **Never remove active business logic. Always analyze impact before changing anything. Validate all workflows after every optimization pass.**

- [ ] Confirm scope with user before deleting files
- [ ] Check all usages before removing any export/function/component
- [ ] Verify no other module imports what you're removing
- [ ] Test affected workflows after each phase
- [ ] Keep backward compatibility unless explicitly told otherwise

---

## Phase Map

Run phases in order. Each phase is independent and can be scoped individually.

| Phase | Scope | Risk |
|-------|-------|------|
| 1. Audit | Read-only analysis | None |
| 2. Dead Code Removal | Unused imports, functions, files | Low |
| 3. Duplicate Logic Cleanup | Merge repeated utilities | Medium |
| 4. Refactoring | Simplify, split, rename | Medium |
| 5. Frontend Optimization | Rendering, bundle, assets | Medium |
| 6. Backend Optimization | Controllers, middleware, APIs | Medium |
| 7. Database Optimization | Queries, indexes, schema | High |
| 8. Server & Infrastructure | CPU/RAM, processes, scaling | High |
| 9. Validation | Re-test all workflows | Required |
| 10. Report | Output optimization report | None |

---

## Phase 1 — Audit (Always First)

Before touching anything, build a complete picture:

1. List all top-level folders and identify purpose of each.
2. Scan for orphan files (no imports pointing to them).
3. Scan for duplicate utility functions across modules.
4. Identify the largest files (by line count) — candidates for splitting.
5. Identify deeply nested logic (>4 levels) — candidates for simplification.
6. Scan `package.json` / dependency files for unused packages.
7. Check for commented-out legacy code blocks.
8. Identify unused environment variables.
9. Summarize findings in an **Audit Table** before proceeding.

**Audit Table format:**
```
| Category | Item | File/Location | Action |
|----------|------|---------------|--------|
| Dead code | `oldPaymentHandler` | api/server.js:L234 | Remove |
| Duplicate | `formatDate` | utils/date.js + lib/helpers.js | Merge |
| Orphan file | `fix_nav3.cjs` | root | Confirm + delete |
| Large file | `App.tsx` (1200 lines) | client/ | Split |
```

Present the Audit Table to the user and get confirmation before Phase 2.

---

## Phase 2 — Dead Code Removal

### Unused Imports
- Scan all files for imports that are never referenced in the file body.
- Remove silently only when 100% certain; flag ambiguous ones.

### Unused Functions / Components / Classes
- Use symbol reference search to confirm zero usages before removing.
- For exported symbols: check ALL files that could import them.

### Obsolete Files
- Scripts in root (e.g., `fix_*.cjs`, `check_*.cjs`) — confirm with user before deleting.
- Files with no inbound imports and no entry-point reference.

### Unused Dependencies
- Cross-reference `package.json` against actual `import`/`require` statements.
- Flag (don't auto-remove) — dependency removal can break build tools or indirect consumers.

### Commented Legacy Code
- Remove blocks of commented code older than active development (confirm with user if uncertain).

---

## Phase 3 — Duplicate Logic Cleanup

1. Search for functions with identical or near-identical signatures across modules.
2. Identify repeated inline logic that should be a shared utility.
3. Propose consolidation location (e.g., `lib/utils.ts`, `api/helpers.js`).
4. Update all callsites after merging.
5. Run a final grep to confirm no old copies remain.

---

## Phase 4 — Refactoring

### Complexity Reduction
- Functions > 50 lines: split into named sub-functions.
- Nesting > 4 levels: extract early-return guards or sub-functions.
- Long conditionals: extract to named predicates.

### Naming Standardization
- Variables: `camelCase` for JS/TS, match existing project convention.
- Files: match existing casing pattern (kebab-case or camelCase).
- Database columns: match existing snake_case convention.
- Flag any inconsistencies found.

### File Splitting
- Components > 300 lines with multiple responsibilities → split by concern.
- API route files with > 10 endpoints → split by domain.

### Architecture Consistency
- Confirm shared context/hooks/utilities are in canonical locations.
- Detect logic that leaked into the wrong layer (e.g., DB queries in UI components).

---

## Phase 5 — Frontend Optimization

- [ ] Identify components that re-render on every parent update without reason → add `React.memo` / `useMemo` / `useCallback` where appropriate.
- [ ] Audit large static assets (images, fonts) — compress or lazy-load.
- [ ] Identify routes that load heavy components eagerly → convert to `React.lazy` + `Suspense`.
- [ ] Check bundle output — identify largest chunks.
- [ ] Remove unused CSS classes (especially Tailwind purge config).
- [ ] Audit form logic for redundant state or re-renders.
- [ ] Verify no `console.log` / debug statements in production code.

---

## Phase 6 — Backend Optimization

- [ ] Detect N+1 query patterns (loop with DB call inside).
- [ ] Detect synchronous blocking operations in async handlers.
- [ ] Identify missing `await` on async calls.
- [ ] Detect unhandled promise rejections.
- [ ] Identify endpoints that fetch more data than they return (over-fetching).
- [ ] Merge duplicate middleware logic.
- [ ] Check for missing rate limiting on public endpoints.
- [ ] Detect memory leaks: event listeners not cleaned up, large arrays accumulated in scope.
- [ ] Verify error responses are consistent and don't leak stack traces.

---

## Phase 7 — Database Optimization

> **High risk — always confirm before executing schema changes.**

- [ ] Identify queries without indexes on filtered columns.
- [ ] Identify `SELECT *` queries — replace with explicit column lists.
- [ ] Detect redundant tables or columns with no active writes.
- [ ] Detect missing foreign key constraints.
- [ ] Identify large tables that would benefit from pagination enforcement.
- [ ] Review slow query log if accessible.
- [ ] Confirm no duplicate records logic exists in application code.

---

## Phase 8 — Server & Infrastructure Optimization

- [ ] Identify processes that run on every request but could be cached.
- [ ] Detect supervisor/watchdog processes that restart too aggressively.
- [ ] Identify endpoints causing 503s (check server logs for patterns).
- [ ] Confirm static assets are served from CDN or cached at nginx/proxy level.
- [ ] Detect environment variables loaded repeatedly instead of once at startup.
- [ ] Identify missing connection pooling for DB.

---

## Phase 9 — Validation

After each phase, validate:

1. Start the development server — confirm no startup errors.
2. Test critical user flows:
   - [ ] Authentication (login/logout)
   - [ ] CRM workflows (client management, scheduling)
   - [ ] Payment flows
   - [ ] Admin dashboard
   - [ ] Employee/permission system
3. Check browser console for new errors.
4. Check server logs for new errors.
5. Confirm API responses are unchanged for critical endpoints.

---

## Phase 10 — Optimization Report

Generate a structured report after completion:

```markdown
# Optimization Report — [Date]

## Summary
- Files removed: X
- Lines of code removed: ~X
- Duplicate functions merged: X
- Dependencies removed: X
- Performance improvements: X

## Removed
| Item | Location | Reason |
|------|----------|--------|

## Refactored
| Item | Before | After | Impact |
|------|--------|-------|--------|

## Performance Improvements
| Area | Change | Est. Impact |
|------|--------|-------------|

## Risks Detected
| Risk | Severity | Recommendation |
|------|----------|----------------|

## Bottlenecks Fixed
...

## Remaining Technical Debt
...

## Architecture Improvements
...
```

---

## Priority Tiers

| Priority | Focus Area |
|----------|------------|
| P0 | Anything causing crashes / 503s / data loss |
| P1 | Duplicate business logic, N+1 queries, memory leaks |
| P2 | Dead code, unused imports, orphan files |
| P3 | Naming consistency, file splitting, bundle size |

---

## Example Prompts

- `/elite-code-cleanup-and-optimization` — full audit and optimization of the entire codebase
- `/elite-code-cleanup-and-optimization frontend` — frontend-only: rendering, bundle, assets
- `/elite-code-cleanup-and-optimization database` — query optimization and schema cleanup
- `/elite-code-cleanup-and-optimization server` — server crash / 503 / CPU/RAM investigation
- `/elite-code-cleanup-and-optimization backend` — API, middleware, memory leaks
- "Remove all dead code from the project"
- "Optimize database queries"
- "Why is the server crashing with 503?"
- "Reduce the frontend bundle size"
- "Clean up the root folder scripts"
