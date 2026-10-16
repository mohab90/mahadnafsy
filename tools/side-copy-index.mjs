#!/usr/bin/env node
// Turns the built client's index.html into the side copy's (deploy/side-copy.sh):
//   - no Google tag and no Meta Pixel — a test copy must not count visits, page views or
//     leads as if they were the real site's
//   - robots: noindex, nofollow — so it is never listed next to the real site
//   - the canonical and share URLs are left alone: they name the real pages, which is what
//     a search engine should keep.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function sideCopyIndex(html) {
  let out = String(html);
  out = out.replace(/\s*<!-- Google tag \(gtag\.js\) -->[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/, '\n');
  out = out.replace(/\s*<!-- Meta Pixel Code -->[\s\S]*?<!-- End Meta Pixel Code -->/, '\n');
  out = out.replace(/\s*<noscript><img[^>]*facebook\.com\/tr[^>]*><\/noscript>/g, '');
  out = out.replace(/<meta name="robots" content="[^"]*"\s*\/?>/i, '<meta name="robots" content="noindex, nofollow" />');
  if (!/name="robots"/i.test(out)) out = out.replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>');
  return out;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node tools/side-copy-index.mjs <dist/index.html>'); process.exit(64); }
  const before = fs.readFileSync(file, 'utf8');
  const after = sideCopyIndex(before);
  fs.writeFileSync(file, after);
  const left = /googletagmanager|fbevents|facebook\.com\/tr/i.test(after);
  console.log(`side copy index: ${before.length} → ${after.length} bytes, tracking ${left ? 'STILL PRESENT' : 'removed'}, noindex set`);
  if (left) process.exit(1);
}
