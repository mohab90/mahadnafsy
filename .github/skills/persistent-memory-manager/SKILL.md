---
name: persistent-memory-manager
description: 'Persistent long-term memory manager for AI assistants. Use when: starting a new session, onboarding to a project, tracking bugs/fixes, recording architecture decisions, updating CRM/payment/permission logic, remembering naming conventions, maintaining development roadmap, or any time project context must survive across conversations. Triggers: "remember this", "update memory", "recall context", "what do we know about", "store this decision", "new session", "project context".'
argument-hint: 'Optional: specify memory domain (technical | business | workflow | bugs | infrastructure | ui)'
---

# Persistent Memory Manager

## Purpose

Act as a **senior technical co-founder** with complete, always-on memory of the project. Never lose context between sessions. Connect new information to existing knowledge. Detect conflicts and keep the memory coherent.

---

## Memory Store Layout

All memory lives under `/memories/repo/` (workspace-scoped) and `/memories/` (user-scoped).

| File | Domain | Content |
|------|--------|---------|
| `/memories/repo/architecture.md` | Technical | System topology, tech stack, module map |
| `/memories/repo/business-logic.md` | Business | CRM workflows, payment logic, pricing rules |
| `/memories/repo/workflows.md` | Workflow | User flows, onboarding, scheduling |
| `/memories/repo/bugs.md` | Bug Tracking | Open bugs, root causes, workarounds |
| `/memories/repo/infrastructure.md` | Infrastructure | Server config, env vars, deployment |
| `/memories/repo/ui-ux.md` | UI/UX | Design patterns, component conventions |
| `/memories/repo/decisions.md` | Decisions | Architecture decisions, rationale, trade-offs |
| `/memories/repo/database.md` | Database | Schema, relationships, indexes, migrations |
| `/memories/repo/api.md` | API | Endpoints, integrations, auth patterns |
| `/memories/repo/permissions.md` | Permissions | Role definitions, access rules, employee scopes |

---

## Procedure

### 1. Session Start — Recall

At the beginning of every session or when context is needed:

1. Run `memory view /memories/repo/` to list existing memory files.
2. Load each relevant file with `memory view <path>`.
3. Synthesize into a working mental model — do **not** re-ask the user for already-known facts.
4. Announce a brief "context loaded" summary if the session is starting fresh.

### 2. Receiving New Information — Merge

When the user shares new context (bug report, architecture change, decision, fix):

1. Identify which memory domain it belongs to (see table above).
2. Load the target file: `memory view /memories/repo/<file>.md`.
3. Check for **conflicts** with existing entries — flag if found.
4. Write the update:
   - New file → `memory create`
   - Existing file → `memory str_replace` (targeted update, not full rewrite)
5. Confirm what was stored and which file was updated.

### 3. Bug / Fix Tracking

For every bug reported or fix applied:

```
## [BUG-ID] Short Title
- **Status**: open | resolved | regressed
- **Module**: <module name>
- **Root cause**: <one sentence>
- **Fix applied**: <what was changed>
- **Date**: YYYY-MM-DD
- **Notes**: <edge cases, related issues>
```

Append to `/memories/repo/bugs.md`. Update `Status` when resolved.

### 4. Architecture Decisions

For every significant decision (library choice, API design, DB schema change):

```
## [ADR-ID] Decision Title
- **Date**: YYYY-MM-DD
- **Status**: accepted | superseded | deprecated
- **Context**: why this decision was needed
- **Decision**: what was chosen
- **Consequences**: trade-offs and implications
```

Append to `/memories/repo/decisions.md`.

### 5. Consistency Check

When adding new information, cross-reference:
- Does the new module name match naming conventions in `architecture.md`?
- Does the new payment logic conflict with `business-logic.md`?
- Does the new permission rule contradict `permissions.md`?

If conflict detected: surface it to the user before writing.

### 6. Memory Quality Rules

- **Concise**: bullet points over prose; no redundant sentences.
- **Dated**: every entry carries a date.
- **Linked**: reference related files when relevant (`see database.md`).
- **Actionable**: favor facts over opinions; record what IS, not what might be.
- **No stale data**: mark superseded entries as `[SUPERSEDED]` rather than deleting.

---

## Priority Tiers

| Priority | Topics |
|----------|--------|
| P0 — Critical | Active bugs, payment logic, auth/permissions |
| P1 — High | Architecture, database schema, API contracts |
| P2 — Medium | Workflows, CRM logic, UI conventions |
| P3 — Low | Naming conventions, tooling preferences, roadmap |

Always load P0 and P1 memory files first when context window is constrained.

---

## Behavioral Rules

- **Never ask for known information.** If it's in memory, use it.
- **Always connect new info to old context.** Think: "how does this affect what we already know?"
- **Surface conflicts proactively.** Don't silently overwrite — flag and resolve.
- **Think in systems.** A change in payment logic may ripple into permissions, workflows, and UI.
- **Maintain roadmap awareness.** Know what's done, what's in progress, what's planned.

---

## Example Prompts

- `/persistent-memory-manager` — Load all project context for this session
- `/persistent-memory-manager bugs` — Review and update bug tracking memory
- `/persistent-memory-manager technical` — Load and summarize technical architecture
- "Remember this decision: we switched from REST to tRPC for admin API"
- "What do we know about the payment system?"
- "Update memory: bug #42 is now resolved"
- "Store this: employee permissions use role-based access with 4 tiers"
