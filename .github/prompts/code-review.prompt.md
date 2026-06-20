---
name: code-review
description: 'Parameterized code review for a single file or PR diff. Reviews against quality standards: correctness, security (OWASP Top 10), performance, maintainability, naming, dead code, duplication, and architecture fit. Outputs a structured report with severity-rated findings and actionable fixes.'
argument-hint: '<file-path or diff description>'
---

# Code Review

## Target
Review: **${input}**

---

## Review Checklist

### 1. Correctness
- [ ] Logic produces expected output for all edge cases
- [ ] No off-by-one errors, null/undefined access, or type mismatches
- [ ] Async operations properly awaited; no race conditions
- [ ] Error handling covers all failure paths

### 2. Security (OWASP Top 10)
- [ ] No SQL injection (parameterized queries used)
- [ ] No XSS (user input escaped before rendering)
- [ ] No hardcoded secrets, tokens, or passwords
- [ ] Auth/permission checks present on all protected routes
- [ ] No sensitive data logged or exposed in API responses
- [ ] Input validated at all system boundaries

### 3. Performance
- [ ] No N+1 query patterns
- [ ] No blocking synchronous operations in async handlers
- [ ] No unnecessary re-renders (React: missing memo/useMemo/useCallback)
- [ ] No over-fetching (SELECT * or returning unused fields)
- [ ] No uncleared timers, event listeners, or subscriptions

### 4. Maintainability
- [ ] Functions < 50 lines; single responsibility
- [ ] Nesting depth ≤ 4 levels
- [ ] No magic numbers — constants named and extracted
- [ ] Naming is descriptive and follows project conventions
- [ ] No commented-out legacy code

### 5. Dead Code & Duplication
- [ ] All imports are used
- [ ] No unreachable code paths
- [ ] No duplicate logic that exists elsewhere in the codebase
- [ ] No unused variables or parameters

### 6. Architecture Fit
- [ ] Logic is in the correct layer (no DB queries in UI components)
- [ ] Follows existing project patterns (hooks, context, service layer)
- [ ] No circular dependencies introduced
- [ ] Exports are intentional and minimal

---

## Output Format

For each finding, report:

```
[SEVERITY] Category — Short title
File: <path> Line: <N>
Problem: <what is wrong>
Fix: <exact recommendation>
```

Severity levels: `CRITICAL` | `HIGH` | `MEDIUM` | `LOW` | `INFO`

---

## Summary Table

After all findings, output:

| Category | Score /10 | Issues Found |
|----------|-----------|--------------|
| Correctness | | |
| Security | | |
| Performance | | |
| Maintainability | | |
| Dead Code | | |
| Architecture | | |
| **Overall** | | |

---

## Quick Wins

List the top 3 changes that would have the highest positive impact, in order.

---

## Risks If Unaddressed

Flag any `CRITICAL` or `HIGH` findings that, if left unfixed, could cause: data loss, security breach, production crash, or regression in CRM/payment/auth flows.
