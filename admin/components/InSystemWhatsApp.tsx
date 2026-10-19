import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, MessageCircle, Search, Send, UserRound } from 'lucide-react';
import { Modal } from '../../shared/ui/Modal';
import { mysqlAdmin } from '../lib/mysqlapi';
import { toDialable, toDisplay } from '../lib/whatsappLink';
import { canUseChannel, type PermissionKey, type RoleKey } from '../constants/permissions';
import { useSiteData } from '../context/SiteDataContext';
import type { NotifyFn } from '../types';
import { WhatsAppContextCard, type WaContext } from './WhatsAppContextCard';

// «لما بضغط زر واتس اب مش بيفتح واتس اب اللى داخل السيستم … خلي كمان زر واتس اب يظهرلهم تحت جمب زر البحث ولما يضغط ارسال
// يفتح الواتس اب اللى على السيستم ويبعت من داخل السيستم» (19 Oct 2026).
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

type LookupRow = { kind: 'subscriber' | 'lead'; id: string; name: string; phone: string | null; typeLabel: string; clientCode: string | null };
type Template = { id: string; title: string; body: string };
type WaState = { status: string; phone: string | null };

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'حصل خطأ');

/** The quick sender behind the floating button: pick a person or type a number, write, send — from the linked WhatsApp. */
export function WhatsAppQuickSend({ open, onClose, notify, initialPhone = '' }: { open: boolean; onClose: () => void; notify: NotifyFn; initialPhone?: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<WaState | null>(null);
  const [query, setQuery] = useState(initialPhone);
  const [rows, setRows] = useState<LookupRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<{ phone: string; name: string } | null>(initialPhone ? { phone: initialPhone, name: '' } : null);
  const [context, setContext] = useState<WaContext | null>(null);
  const [text, setText] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [me, setMe] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSent(false);
    mysqlAdmin.adminGet<WaState>('/staff/whatsapp-web/state').then(setState, () => setState({ status: 'disconnected', phone: null }));
    mysqlAdmin.adminGet<{ templates: Template[]; me: string }>('/staff/whatsapp-web/templates')
      .then(result => { setTemplates(result.templates); setMe(result.me); }, () => undefined);
  }, [open]);

  // A number typed in full needs no lookup; a name or part of a number asks the system's client search.
  const typedDigits = query.replace(/\D/g, '');
  const typedPhone = typedDigits.length >= 9 ? toDialable(query) : '';
  useEffect(() => {
    if (picked || query.trim().length < 2 || typedPhone) { setRows([]); return undefined; }
    let alive = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      mysqlAdmin.adminGet<{ rows: LookupRow[] }>(`/admin/client-lookup?q=${encodeURIComponent(query.trim())}`)
        .then(result => { if (alive) setRows((result.rows || []).filter(row => toDialable(row.phone))); })
        .catch(() => { if (alive) setRows([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, picked, typedPhone]);

  const phone = picked?.phone || typedPhone;
  useEffect(() => {
    if (!open || !phone) { setContext(null); return undefined; }
    let alive = true;
    mysqlAdmin.adminGet<WaContext>(`/staff/whatsapp-web/context?phone=${encodeURIComponent(phone)}`)
      .then(result => { if (alive) setContext(result); }, () => { if (alive) setContext(null); });
    return () => { alive = false; };
  }, [open, phone]);

  const name = picked?.name || context?.subscriber?.name || context?.lead?.name || '';
  const fill = (body: string) => body.replace(/\{name\}/g, name.split(' ')[0] || '').replace(/\{me\}/g, me);

  const reset = useCallback(() => { setQuery(''); setPicked(null); setRows([]); setContext(null); setText(''); setSent(false); input.current?.focus(); }, []);
  const send = async () => {
    if (!phone || !text.trim() || sending) return;
    setSending(true);
    try {
      await mysqlAdmin.adminPost('/staff/whatsapp-web/send', { phone, text: text.trim() });
      setSent(true);
      notify('success', `اتبعتت لـ${name || toDisplay(phone)} من الواتساب بتاعك`);
    } catch (error) { notify('error', errorText(error)); }
    finally { setSending(false); }
  };

  const connected = state?.status === 'connected';
  return (
    <Modal open={open} onClose={onClose} title="واتساب" subtitle="ابعت من الواتساب المربوط بالسيستم" size="md" align="sheet"
      icon={<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-green-600"><MessageCircle size={20} /></div>}>
      <div className="space-y-3 px-5 pb-5 pt-3" dir="rtl">
        {state && !connected && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-bold">الواتساب بتاعك مش مربوط بالسيستم.</p>
            <p className="mt-0.5">اربطه مرة واحدة بكود QR من الموبايل، وبعدها تبعت وتستقبل من هنا.</p>
            <button type="button" onClick={() => { onClose(); navigate(IN_SYSTEM_WHATSAPP_PATH); }}
              className="mt-2 rounded-lg bg-green-600 px-3 py-1.5 font-bold text-white hover:bg-green-700">اربط الواتساب</button>
          </div>
        )}

        {sent ? (
          <div className="space-y-3 rounded-2xl bg-green-50 p-5 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-600 text-white"><Check size={24} /></span>
            <p className="font-bold text-green-800">اتبعتت لـ{name || toDisplay(phone)}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => { onClose(); navigate(inSystemChatUrl({ phone, name })); }}
                className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700">افتح المحادثة</button>
              <button type="button" onClick={reset} className="rounded-xl border border-green-300 bg-white px-4 py-2 text-sm font-bold text-green-800 hover:bg-green-50">رسالة لحد تاني</button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-xs font-bold text-gray-600">لمين؟</label>
              {picked ? (
                <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2">
                  <UserRound size={16} className="text-green-700" />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-800">{name || toDisplay(picked.phone)}</span>
                  <span dir="ltr" className="text-xs text-gray-500">{toDisplay(picked.phone)}</span>
                  <button type="button" onClick={() => { setPicked(null); setQuery(''); setContext(null); }} className="text-xs font-bold text-green-700 hover:underline">تغيير</button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input ref={input} autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="اسم العميل أو رقم الموبايل"
                    className="w-full rounded-xl border border-gray-200 py-2.5 pl-3 pr-9 text-sm focus:border-green-400 focus:outline-none" />
                </div>
              )}
              {!picked && typedPhone && (
                <button type="button" onClick={() => setPicked({ phone: typedPhone, name: '' })}
                  className="mt-1.5 flex w-full items-center justify-between rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-bold text-green-800 hover:bg-green-100">
                  <span>ابعت للرقم</span><span dir="ltr">{toDisplay(typedPhone)}</span>
                </button>
              )}
              {!picked && !typedPhone && (searching || rows.length > 0) && (
                <div className="mt-1.5 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-gray-100 bg-white p-1">
                  {searching && rows.length === 0 && <p className="py-3 text-center text-xs text-gray-400">جاري البحث…</p>}
                  {rows.map(row => (
                    <button key={`${row.kind}:${row.id}`} type="button" onClick={() => setPicked({ phone: toDialable(row.phone) || '', name: row.name })}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-right hover:bg-green-50">
                      <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-800">{row.name || '—'}{row.clientCode && <span className="mr-1.5 text-[10px] font-normal text-gray-400">{row.clientCode}</span>}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">{row.typeLabel}</span>
                      <span dir="ltr" className="text-xs text-gray-500">{toDisplay(row.phone)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {context && (context.subscriber || context.lead) && <WhatsAppContextCard context={context} compact />}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-bold text-gray-600">الرسالة</label>
              </div>
              {templates.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {templates.slice(0, 8).map(template => (
                    <button key={template.id} type="button" onClick={() => setText(current => (current ? `${current}\n` : '') + fill(template.body))} title={fill(template.body)}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-700 hover:border-green-400 hover:text-green-700">{template.title}</button>
                  ))}
                </div>
              )}
              <textarea value={text} onChange={event => setText(event.target.value)} rows={4} placeholder="اكتب رسالتك…"
                onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }}
                className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-green-400 focus:outline-none" />
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50">إلغاء</button>
              <button type="button" onClick={() => void send()} disabled={!connected || !phone || !text.trim() || sending}
                className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-40">
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className="rotate-180" />} إرسال
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** The floating button beside «بحث»: opens the quick sender. Drawn only for an account that has WhatsApp in the system. */
export function WhatsAppFab({ notify }: { notify: NotifyFn }) {
  const enabled = useInSystemWhatsApp();
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="واتساب — ابعت رسالة" title="واتساب — ابعت من الواتساب المربوط بالسيستم"
          className="flex h-11 w-11 items-center justify-center gap-2 rounded-full bg-[#25D366] text-white shadow-xl transition hover:bg-[#1fb857] active:scale-95 md:h-auto md:w-auto md:rounded-2xl md:px-4 md:py-3 md:text-sm md:font-bold md:shadow-2xl md:hover:scale-105">
          <MessageCircle size={18} />
          <span className="hidden md:inline">واتساب</span>
        </button>
      )}
      {open && <WhatsAppQuickSend open onClose={() => setOpen(false)} notify={notify} />}
    </>
  );
}
