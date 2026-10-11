#!/usr/bin/env node
/**
 * Puts the institute's logo and share image on its own domain, once.
 *
 *   node tools/fetch-brand-assets.mjs [--logo <url>] [--og <url>] [--force]
 *
 * «صفحات الكورسات في جوجل» (11 Oct 2026). The logo, the og:image every shared
 * link previews with, and the logo in the search result's structured data were
 * all served from h.top4top.io — a free image host the institute does not
 * control. The site now names /brand/logo.png and /brand/og.jpg; this writes
 * them into client/public/brand/, from where every build carries them. Commit
 * the two files it writes.
 *
 * It is a script rather than files in the commit because the machine the change
 * was made on could not reach the image host. Until it has been run, nginx
 * answers /brand/ with the old address and the pages swap a logo that does not
 * load for it, so nothing is missing in the meantime.
 *
 * og.jpg is the 1200×630 card Facebook and WhatsApp show: given --og, that
 * image fitted to the card; otherwise the logo centred on white.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'client', 'public', 'brand');
const LEGACY_LOGO = 'https://h.top4top.io/p_3734xfq501.png';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const force = process.argv.includes('--force');

// sharp is the API's own dependency; the root has no node_modules of its own.
let sharp;
try {
  sharp = createRequire(join(ROOT, 'api', 'package.json'))('sharp');
} catch {
  console.error('sharp is not installed — run `npm --prefix api install` first');
  process.exit(1);
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  // A host that answers with an HTML error page must not become the logo.
  await sharp(bytes).metadata().catch(() => { throw new Error(`${url} is not an image`); });
  return bytes;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const logoPath = join(OUT, 'logo.png');
  const ogPath = join(OUT, 'og.jpg');
  if (!force && existsSync(logoPath) && existsSync(ogPath)) {
    console.log('brand: logo.png and og.jpg are already there (--force to fetch again)');
    return;
  }

  const logo = await download(arg('logo', LEGACY_LOGO));
  // Capped, so an 8 MB original does not become the header image of every page.
  const logoPng = await sharp(logo).resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  writeFileSync(logoPath, logoPng);

  const ogSource = arg('og', '');
  const og = ogSource
    ? await sharp(await download(ogSource)).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer()
    : await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#ffffff' } })
      .composite([{ input: await sharp(logo).resize(520, 520, { fit: 'inside' }).png().toBuffer(), gravity: 'center' }])
      .jpeg({ quality: 88 })
      .toBuffer();
  writeFileSync(ogPath, og);

  console.log(`brand: wrote ${logoPath} (${logoPng.length} bytes) and ${ogPath} (${og.length} bytes) — commit them`);
}

main().catch(error => {
  console.error(`brand: ${error.message}`);
  process.exit(1);
});
