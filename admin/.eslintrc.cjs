/**
 * Runtime-safety lint for the admin app.
 *
 * `tsc --noEmit` was the only check here, and it does not catch this class at
 * all: a duplicate key in an object literal, a `typeof x === 'strng'` that never
 * matches, or "${x}" written inside a plain string instead of a template — all
 * type-check clean and all wrong at runtime. That last one was a real mistake in
 * this repo, in a payment page, and tsc said nothing.
 *
 * Same philosophy as api/.eslintrc.cjs: no style rules, only defects. Every rule
 * was run clean over the whole app before being added, so a failure here means a
 * new bug rather than a backlog.
 *
 * Type-aware rules (no-floating-promises and friends) are deliberately not on:
 * they need a full type graph per lint run, which turns a two-second check into
 * a slow one, and tsc already covers what they would add here.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  env: { browser: true, es2022: true },
  // react-hooks/exhaustive-deps is enabled in the rules below — see the note
  // there. @typescript-eslint is still registered with none of its rules on:
  // the app carries `eslint-disable-next-line` comments naming
  // @typescript-eslint/no-unused-vars, and without the plugin loaded ESLint
  // treats every one of those as an error for referencing a rule it does not
  // know. Turning that one on is a separate decision with its own backlog.
  plugins: ['react-hooks', '@typescript-eslint', 'jsx-a11y'],
  rules: {
    // A hook that reads something it does not declare silently stops updating.
    // JoinUsAdminTab's applicant list gained branch and experience filters that
    // were never added to the memo's dependency array, so choosing a filter
    // changed the dropdown and nothing else — worse than a missing filter,
    // because the screen looks broken. It shipped, and the owner reported it.
    //
    // The backlog this rule was held off for is gone: 44 findings in admin and 8
    // in client were each decided individually rather than silenced. Where the
    // narrower list is the correct one — an effect keyed on an id instead of the
    // object rebuilt around it, a mount-only fetch — the exception is an
    // `eslint-disable-next-line` with the reason written directly above it.
    'react-hooks/exhaustive-deps': 'error',

    // Silently wrong data
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-duplicate-case': 'error',
    'no-sparse-arrays': 'error',
    'no-self-assign': 'error',
    'no-self-compare': 'error',

    // Conditions that do not mean what they look like
    'no-cond-assign': 'error',
    'no-unsafe-negation': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    'no-compare-neg-zero': 'error',
    'no-constant-binary-expression': 'error',
    'no-unsafe-optional-chaining': 'error',

    // Code that cannot run
    'no-unreachable': 'error',
    'no-const-assign': 'error',
    'no-fallthrough': 'error',

    // Async correctness
    'no-async-promise-executor': 'error',

    // Looks like it works but does not — "${x}" in a plain string is literal
    // text. This exact mistake shipped in PaymentSuccess.tsx and only surfaced
    // because someone read the diff.
    'no-template-curly-in-string': 'error',
    'no-invalid-regexp': 'error',
    'no-empty-character-class': 'error',
    'no-useless-backreference': 'error',
    'no-misleading-character-class': 'error',
    'no-irregular-whitespace': 'error',
    'no-loss-of-precision': 'error',

    // Accessibility — basic mechanical checks (not a substitute for manual review)
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/aria-proptypes': 'error',
    'jsx-a11y/aria-unsupported-elements': 'error',
    'jsx-a11y/role-has-required-aria-props': 'error',
    'jsx-a11y/role-supports-aria-props': 'error',
    'jsx-a11y/img-redundant-alt': 'error',
    'jsx-a11y/no-redundant-roles': 'error',
  },
};
