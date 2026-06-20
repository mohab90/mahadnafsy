/**
 * Brand theme engine — turns the admin/SaaS branding settings (saved in the
 * site_config content blob) into a live theme: a CSS-variable palette consumed by
 * Tailwind's `brand` color, plus the document title and favicon.
 *
 * Keys read from content:
 *   - brand.primary   : base hex color (e.g. "#4f46e5"); a 50→900 scale is derived
 *   - institute.name  : document <title>
 *   - institute.logo  : favicon URL
 *
 * Call applyBrandTheme(content) after content loads and whenever a brand key changes.
 */

const DEFAULT_PRIMARY = '#dc2626'; // red-600 — the system's classic accent (kept by default)

export const BRAND_PRESETS: { label: string; value: string }[] = [
  { label: 'أحمر كلاسيكي', value: '#dc2626' },
  { label: 'إندِيغو', value: '#4f46e5' },
  { label: 'بنفسجي', value: '#7c3aed' },
  { label: 'أزرق', value: '#2563eb' },
  { label: 'سماوي', value: '#0891b2' },
  { label: 'أخضر', value: '#059669' },
  { label: 'وردي', value: '#db2777' },
  { label: 'أحمر', value: '#dc2626' },
  { label: 'برتقالي', value: '#ea580c' },
  { label: 'كهرماني', value: '#d97706' },
  { label: 'رمادي داكن', value: '#334155' },
];

function clamp(n: number) { return Math.max(0, Math.min(255, Math.round(n))); }

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

/** Mix a color toward white (amount>0) or black (amount<0). amount in [-1,1]. */
function mix(rgb: [number, number, number], amount: number): string {
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const [r, g, b] = rgb;
  return rgbToHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t);
}

/** Relative luminance — picks readable foreground (white/dark) over the brand color. */
function readableFg(rgb: [number, number, number]): string {
  const [r, g, b] = rgb.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? '#1e293b' : '#ffffff';
}

/** Build a Tailwind-like 50→900 scale anchored on the base as the 600 step. */
export function buildBrandScale(baseHex: string): Record<string, string> {
  const rgb = hexToRgb(baseHex) || hexToRgb(DEFAULT_PRIMARY)!;
  return {
    '50':  mix(rgb, 0.92),
    '100': mix(rgb, 0.84),
    '200': mix(rgb, 0.68),
    '300': mix(rgb, 0.48),
    '400': mix(rgb, 0.26),
    '500': mix(rgb, 0.10),
    '600': rgbToHex(...rgb),
    '700': mix(rgb, -0.18),
    '800': mix(rgb, -0.32),
    '900': mix(rgb, -0.46),
    fg:    readableFg(rgb),
  };
}

let _lastApplied = '';

/** Apply brand palette + title + favicon from the content blob to the live DOM. */
export function applyBrandTheme(content: Record<string, string> | undefined | null) {
  if (typeof document === 'undefined') return;
  const c = content || {};
  const custom = (c['brand.primary'] || '').trim();
  const name = (c['institute.name'] || '').trim();
  const logo = (c['institute.logo'] || '').trim();

  // Guard: skip redundant DOM writes
  const sig = `${custom}|${name}|${logo}`;
  if (sig === _lastApplied) return;
  _lastApplied = sig;

  const root = document.documentElement;
  const isDefault = !custom || custom.toLowerCase() === DEFAULT_PRIMARY;
  if (isDefault) {
    // Revert to the stylesheet's exact red scale (no inline overrides).
    ['50','100','200','300','400','500','600','700','800','900','fg',''].forEach(k =>
      root.style.removeProperty(k ? `--brand-${k}` : '--brand'));
  } else {
    const scale = buildBrandScale(custom);
    Object.entries(scale).forEach(([k, v]) => root.style.setProperty(`--brand-${k}`, v));
    root.style.setProperty('--brand', scale['600']);
  }

  if (name) document.title = name;

  if (logo) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = logo;
  }
}

/** Keys that should re-trigger applyBrandTheme when changed via setContentValue. */
export const BRAND_KEYS = ['brand.primary', 'institute.name', 'institute.logo'];
