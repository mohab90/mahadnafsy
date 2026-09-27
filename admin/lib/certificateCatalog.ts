import { useMemo } from 'react';
import { useStaticData } from '../context/siteDataSlices';

/**
 * The certificates on offer: what «تسعير الشهادات» lists (content
 * `extra_cert_pricing`), names and prices together.
 *
 * Every screen that offered a certificate carried its own list of the eight it
 * started with — the booking dialog, the requests board, the online table, the
 * client page — so a certificate customer service added (the Azhar one, the
 * National Council 60/100/180-hour ones, the membership card) could be priced
 * and never booked, and one they deleted was still offered.
 */
export type CertPricingMap = Record<string, {
  label?: string;
  egyptianEGP: number; residentEGP: number; residentSAR: number; foreignUSD: number;
}>;

export const DEFAULT_CERT_TYPES = [
  { key: 'social_solidarity', label: 'شهادة التضامن الاجتماعي' },
  { key: 'ain_shams', label: 'شهادة جامعة عين شمس' },
  { key: 'experience_external', label: 'شهادة الخبرة' },
  { key: 'practice_external', label: 'شهادة التطبيقين' },
  { key: 'national_council', label: 'شهادة المجلس الوطني' },
  { key: 'american_board', label: 'شهادة البورد الأمريكي' },
  { key: 'institute', label: 'شهادة المعهد' },
  { key: 'other', label: 'شهادة أخرى' },
];

export function parseCertPricing(raw: string | undefined | null): CertPricingMap {
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

// The saved map is the list. The defaults seed it only when nothing has been
// saved yet, so deleting one sticks and a custom type keeps its name.
export function certificateTypes(map: CertPricingMap): { key: string; label: string }[] {
  const keys = Object.keys(map || {});
  if (!keys.length) return DEFAULT_CERT_TYPES;
  return keys.map(key => ({
    key,
    label: String(map[key]?.label || '').trim() || DEFAULT_CERT_TYPES.find(d => d.key === key)?.label || key,
  }));
}

/** A request's name: what the client wrote, else the catalogue's, else the code. */
export function certificateLabel(map: CertPricingMap, type?: string | null, customName?: string | null): string {
  if (customName) return customName;
  const code = String(type || '').toLowerCase();
  if (!code) return 'شهادة';
  const key = Object.keys(map || {}).find(item => item.toLowerCase() === code);
  return (key && String(map[key]?.label || '').trim())
    || DEFAULT_CERT_TYPES.find(d => d.key === code)?.label
    || String(type);
}

export function useCertificateCatalog() {
  const { content } = useStaticData();
  return useMemo(() => {
    const map = parseCertPricing(content['extra_cert_pricing']);
    return {
      map,
      types: certificateTypes(map),
      label: (type?: string | null, customName?: string | null) => certificateLabel(map, type, customName),
    };
  }, [content]);
}
