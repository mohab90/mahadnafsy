/**
 * Runtime-safety lint for the API.
 *
 * Not a style config — every rule here catches something that only fails when
 * the code actually runs, which is exactly the gap the test suite and tsc leave
 * open in plain JS route files. The gate earned its keep on the day it was
 * widened: `no-undef` alone had been hiding a ReferenceError on every quiz
 * submission and another on every payroll run.
 *
 * Rules are added only after being run clean across the whole API, so a failure
 * here always means a new defect rather than pre-existing noise.
 *
 * Deliberately NOT enabled: `require-atomic-updates`. It flags 24 sites in this
 * codebase and every one is a false positive — assigning to `req.*` after an
 * await is safe because each request owns its object, and the one real mutex
 * (gsheets auto-sync) does its check-and-set synchronously before any await,
 * which is atomic on a single-threaded event loop. A rule that is wrong 24 times
 * out of 24 trains people to ignore the gate.
 */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
  rules: {
    // ── The original rule, and the one that has caught the most ──────────────
    // A free variable is a ReferenceError the moment that branch is reached.
    'no-undef': 'error',

    // ── Silently wrong data ─────────────────────────────────────────────────
    // A duplicate key drops the earlier value without a word — in a SQL params
    // object or an API response that is corrupted data, not a typo.
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-duplicate-case': 'error',
    // `[1, , 2]` is almost always a mistyped list, and its hole reads as
    // undefined downstream.
    'no-sparse-arrays': 'error',
    // `x = x` and `x === x` are always a mistake — usually a wrong variable name
    // in what was meant to be a real assignment or comparison.
    'no-self-assign': 'error',
    'no-self-compare': 'error',

    // ── Conditions that do not mean what they look like ─────────────────────
    // `if (x = y)` assigns and always passes.
    'no-cond-assign': 'error',
    // `!key in obj` negates the wrong operand.
    'no-unsafe-negation': 'error',
    // `x === NaN` is never true; only Number.isNaN works.
    'use-isnan': 'error',
    // `typeof x === 'strng'` silently never matches.
    'valid-typeof': 'error',
    // `x === -0` does not distinguish -0 from 0 the way it appears to.
    'no-compare-neg-zero': 'error',
    // A condition whose result is fixed at author time — a guard that never
    // guards, which is worse than no guard because it reads as one.
    'no-constant-binary-expression': 'error',
    // `(a ?? b).c` still throws when the chain short-circuits.
    'no-unsafe-optional-chaining': 'error',

    // ── Code that cannot run, or runs when it should not ────────────────────
    'no-unreachable': 'error',
    'no-const-assign': 'error',
    // A missing `break` runs the next case too — in a status or role switch
    // that is a permissions bug.
    'no-fallthrough': 'error',

    // ── Async correctness ───────────────────────────────────────────────────
    // `new Promise(async () => ...)` swallows every rejection inside it.
    'no-async-promise-executor': 'error',

    // ── Things that look like they work ─────────────────────────────────────
    // "${x}" in a plain string is literal text, not interpolation — a mistake
    // made in this repo before and invisible to tsc.
    'no-template-curly-in-string': 'error',
    // A regex that cannot compile throws on load; one with a broken class or
    // backreference silently matches nothing.
    'no-invalid-regexp': 'error',
    'no-empty-character-class': 'error',
    'no-useless-backreference': 'error',
    'no-misleading-character-class': 'error',
    // A pasted zero-width or non-breaking space inside code — the file looks
    // right and does not parse, or worse, parses differently.
    'no-irregular-whitespace': 'error',
    // A number literal that cannot be represented, so it is not the value that
    // was written. In money code that matters.
    'no-loss-of-precision': 'error',
    // obj.hasOwnProperty(k) throws on a null-prototype object.
    'no-prototype-builtins': 'error',
  },
};
