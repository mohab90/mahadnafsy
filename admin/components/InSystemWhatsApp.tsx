import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toDialable } from '../lib/whatsappLink';
import { canUseChannel, type PermissionKey, type RoleKey } from '../constants/permissions';
import { useSiteData } from '../context/SiteDataContext';

// «لما بضغط زر واتس اب مش بيفتح واتس اب اللى داخل السيستم» (19 Oct 2026). (The floating «واتساب» button beside «بحث» that was
// added with it was taken away on 20 Oct: «الغي زر واتس اللى تحت».)
//
// Every «واتساب» button in the admin was a plain link to wa.me, which opens WhatsApp Web or the phone app — outside the
// system, with nothing recorded. For an employee whose own WhatsApp is linked to the system (tabs/whatsapp/WhatsAppWebTab),
// those links now open that chat instead, and a message written in the system goes out from the system.

export const IN_SYSTEM_WHATSAPP_PATH = '/dashboard/whatsapp_web';

/** The in-system chat for a number, with the message to start from. */
export function inSystemChatUrl({ phone, name, text }: { phone: string; name?: string; text?: string }): string {
  const params = new URLSearchParams();
  params.set('phone', toDialable(phone) || phone.replace(/\D/g, ''));
  if (name) params.set('name', name);
  if (text) params.set('text', text);
  return `${IN_SYSTEM_WHATSAPP_PATH}?${params.toString()}`;
}

/** The number and the prefilled text of a link that opens WhatsApp outside the system, or null for any other link. */
export function parseWhatsAppHref(href: string): { phone: string; text: string } | null {
  let url: URL;
  try { url = new URL(href, window.location.origin); } catch { return null; }
  const host = url.hostname.replace(/^www\./, '');
  let phone = '';
  if (host === 'wa.me') phone = url.pathname.replace(/\D/g, '');
  else if (host === 'api.whatsapp.com' || host === 'web.whatsapp.com') phone = (url.searchParams.get('phone') || '').replace(/\D/g, '');
  else if (url.protocol === 'whatsapp:') phone = (url.searchParams.get('phone') || '').replace(/\D/g, '');
  else return null;
  if (!phone) return null;
  return { phone, text: url.searchParams.get('text') || '' };
}

/** Whether this account has its own WhatsApp in the system (the same rule as the «واتسابي» tab). */
export function useInSystemWhatsApp(): boolean {
  const { isAdmin, currentStaff } = useSiteData();
  return useMemo(() => {
    if (isAdmin) return true;
    if (!currentStaff) return false;
    return canUseChannel({ role: currentStaff.role as RoleKey, permissions: currentStaff.permissions as PermissionKey[] | undefined }, 'whatsapp');
  }, [isAdmin, currentStaff]);
}

/**
 * One listener for every WhatsApp link in the admin: a plain click on a wa.me / api.whatsapp.com link opens that number's
 * chat inside the system. Ctrl/Cmd/Shift/middle clicks keep the browser's own behaviour, and accounts without WhatsApp in
 * the system are left alone. It does not stop the event, so a button's own handler (a logged contact, say) still runs.
 */
export function InSystemWhatsAppLinks() {
  const navigate = useNavigate();
  const enabled = useInSystemWhatsApp();
  useEffect(() => {
    if (!enabled) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      const target = parseWhatsAppHref(link.getAttribute('href') || '');
      if (!target) return;
      event.preventDefault();
      navigate(inSystemChatUrl({ phone: target.phone, text: target.text }));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [enabled, navigate]);
  return null;
}
