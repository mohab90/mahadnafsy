---
name: extreme-token-conservation
description: 'Maximum token-efficiency operating mode for any task in this repo. Use when: the user asks to "save tokens", "توفير التوكين", "اشتغل باقتصاد", work cheaply/fast, minimize context usage, reduce cost, or whenever a task is large and context budget matters. Triggers: "save tokens", "توفير التوكين", "اقتصاد توكين", "minimize tokens", "cheap mode", "low context", "don''t waste tokens", "be efficient".'
argument-hint: 'Optional: aggressiveness (normal | aggressive | extreme)'
---

# Extreme Token Conservation

## Purpose

Complete the task correctly while spending the **minimum possible tokens** — input (reading) and output (writing). Quality and correctness are never sacrificed; waste is.

Operate as: a senior engineer who already knows the codebase and refuses to re-read, re-explain, or over-produce.

---

## The One Rule

> **Every token read or written must change the outcome. If it doesn't, don't.**

---

## Reading Budget (input tokens)

The biggest token cost is re-reading files. Control it hard:

- **Search before read.** Use `Grep`/`Glob` to locate the exact line range, then `Read` with `offset`+`limit`. Never read a whole file to find one function.
- **Never re-read a file you just edited.** `Edit`/`Write` already validated the change. Re-reading to "verify" is pure waste.
- **Don't re-derive known facts.** Project facts, prior decisions, report contents, and anything already in this conversation are free — reuse them, don't re-fetch.
- **Big files (>800 lines):** read only the targeted slice. `Dashboard.tsx`, `LeadsTab.tsx`, `UnifiedClientPage.tsx`, `core.js` must never be read whole.
- **Prefer one precise `Grep` over many broad ones.** A regex with `-n` + small `-C` beats reading files.
- **No spawning sub-agents** unless the user explicitly asks — each spawn re-reads context cold (the expensive path).

## Writing Budget (output tokens)

- **No preamble, no postamble.** Skip "Sure, I'll…", "Let me…", "In summary…". Answer, then stop.
- **No narration of tool calls.** Don't say "Now I'll read X" — just read it.
- **Edits, not rewrites.** Use `Edit` with the smallest unique `old_string`. Never `Write` a whole file to change a few lines.
- **Code over prose.** Show the diff/snippet; don't describe what the code does line by line.
- **One short confirmation per task**, not a phase-by-phase essay. A table or 3 bullets beats 3 paragraphs.
- **Match the user's language** (Arabic here) but keep it terse.
- **No unsolicited reports/docs.** Only produce a report file if explicitly requested.

## Tool-Call Budget

- **Batch independent calls** in one message (parallel) — fewer round-trips.
- **Don't poll.** Background work re-notifies you; sleeping/checking burns tokens.
- **Reuse results.** Don't run the same `git diff`/`grep` twice in a session.
- **Skip redundant verification** the harness already does (file-state tracking, edit validation).

---

## Aggressiveness Levels

| Level | Behavior |
|-------|----------|
| `normal` (default) | Terse answers, targeted reads, no re-reads. Brief confirmations allowed. |
| `aggressive` | Bullet-only output. No explanations unless asked. Minimal-slice reads only. |
| `extreme` | One-line answers. Code/diff only, near-zero prose. Ask nothing that has a sensible default — pick it and note it in ≤1 line. |

---

## Anti-Patterns (never do these)

- ❌ Reading a file right after editing it "to confirm".
- ❌ Reading an entire large file to find one symbol.
- ❌ Re-explaining the plan after the user approved it.
- ❌ Restating tool output back to the user verbatim.
- ❌ Writing a summary longer than the change itself.
- ❌ Spawning agents for work you can do inline.
- ❌ Producing a markdown report nobody asked for.

---

## Pre-Send Checklist

Before every response, drop anything that fails:
- [ ] Did I read only what I needed (slices, not whole files)?
- [ ] Did I avoid re-reading edited/known content?
- [ ] Is every sentence load-bearing?
- [ ] Could a table/bullets replace this paragraph?
- [ ] Did I batch independent tool calls?
