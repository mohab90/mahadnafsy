#!/usr/bin/env bash
# Single source of truth for "is the tree green". Run locally before trusting an
# "it builds" claim, and in CI on every push/PR. Any step failing fails the whole
# gate (set -e) — including type errors, which the `lint:*` npm scripts swallow by
# piping tsc into `head`. This calls tsc directly so a type error actually blocks.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;35m== %s ==\033[0m\n' "$1"; }

step "1/7 · api lint (no-undef)"
npm run lint:api

step "2/7 · api unit tests"
npm --prefix api run test:unit

step "3/7 · api module require-resolution"
# node --check is syntax-only; this actually require()s every route/lib/middleware
# file, catching missing headers / broken exports that syntax checks miss.
( cd api && node -e "
  const fs=require('fs'); let bad=0;
  for (const d of ['routes','lib','middleware']) for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.js')) continue;
    try { require('./'+d+'/'+f); }
    catch(e){ if(!/Cannot find module|ECONNREFUSED|ER_|connect /.test(e.message)){ console.error('LOAD FAIL',d+'/'+f,e.message); bad++; } }
  }
  process.exit(bad? 1:0);
" )

step "4/7 · client typecheck"
( cd client && npx tsc --noEmit )

step "5/7 · admin typecheck"
( cd admin && npx tsc --noEmit )

step "6/7 · client build"
npm --prefix client run build

step "7/7 · admin build"
npm --prefix admin run build

printf '\n\033[1;32m✓ ALL GREEN\033[0m\n'
