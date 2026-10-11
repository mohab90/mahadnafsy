import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, CreditCard, LifeBuoy, Search, UserCheck, UserPlus, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { Modal } from '../../../shared/ui/Modal';
import { SEARCH_MIN_CHARS } from '../../lib/clientSearch';
import { hasPermission, type PermissionKey } from '../../constants/permissions';
import type { StaffMember } from '../../types';

/**
 * «سيرش واحد للسيستم كله» (11 Oct 2026): 🔍 in the header, or Ctrl+K anywhere.
 * One box for clients, leads, payments by transaction number, certificates and
 * tickets — GET /api/search?scope=system (api/lib/systemSearch.js), which
 * answers only the kinds this account may open, inside its own scope. A result
 * opens its record: a person, a payment or a certificate the client's page; a
 * ticket the inbox, on that ticket. Same rules as every list's box: from the
 * second letter, and three digits for a phone.
 */
type Hit = { id: string; title: string; subtitle?: string; status?: string | null; open: { client?: string; tab?: string; ticket?: string } };
type Kind = 'clients' | 'leads' | 'payments' | 'certificates' | 'tickets';
type Answer = Record<Kind, Hit[]> & { kinds: Kind[] };

const GROUPS: { kind: Kind; label: string; icon: LucideIcon }[] = [
  { kind: 'clients', label: 'العملاء', icon: UserCheck },
  { kind: 'leads', label: 'العملاء المحتملين', icon: UserPlus },
  { kind: 'payments', label: 'الدفعات', icon: CreditCard },
  { kind: 'certificates', label: 'الشهادات', icon: Award },
  { kind: 'tickets', label: 'التذاكر', icon: LifeBuoy },
];
/** Any one of these opens the box (api/lib/systemSearch.js SYSTEM_SEARCH_PERMISSIONS). */
const SEARCH_PERMISSIONS: PermissionKey[] = ['view_subscribers', 'view_client_db', 'view_leads', 'view_financial', 'manage_certificates', 'manage_inbox'];

export function canUseGlobalSearch(isAdmin: boolean, staff: StaffMember | null | undefined): boolean {
  return isAdmin || SEARCH_PERMISSIONS.some(permission => hasPermission(staff ?? null, permission));
}

/** Where a result goes. */
export function hitPath(hit: Hit): string {
  if (hit.open.client) return `/client/${encodeURIComponent(hit.open.client)}`;
  const tab = hit.open.tab || 'overview';
  return `/dashboard/${tab}${hit.open.ticket ? `?focus=${encodeURIComponent(hit.open.ticket)}` : ''}`;
}

export function GlobalSearch({ className }: { className: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  const q = query.trim();
  useEffect(() => {
    if (!open || q.length < SEARCH_MIN_CHARS) { setAnswer(null); setFailed(false); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      mysqlAdmin.adminGet<Answer>(`/search?scope=system&q=${encodeURIComponent(q)}`)
        .then(result => { if (!cancelled) { setAnswer(result); setFailed(false); setCursor(0); } })
        .catch(() => { if (!cancelled) setFailed(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, q]);

  const close = useCallback(() => { setOpen(false); setQuery(''); setAnswer(null); }, []);
  const hits = answer ? GROUPS.flatMap(group => (answer[group.kind] || []).map(hit => ({ ...hit, kind: group.kind }))) : [];
  const go = (hit: Hit) => { close(); navigate(hitPath(hit)); };

  const onInputKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor(at => Math.min(hits.length - 1, at + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor(at => Math.max(0, at - 1)); }
    else if (event.key === 'Enter' && hits[cursor]) go(hits[cursor]);
  };

  let index = -1;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} title="ابحث في السيستم كله (Ctrl+K)" aria-label="البحث في السيستم">
        <Search size={15} />
      </button>
      <Modal open={open} onClose={close} hideClose layer="top" size="lg" bodyClassName="p-0">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <Search size={18} className="text-gray-400" />
          <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onInputKey}
            placeholder="اسم، تليفون، كود عميل، إيميل، رقم عملية، كود شهادة أو تذكرة"
            className="flex-1 bg-transparent text-sm outline-none" />
          {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-400 border-t-transparent" />}
          <button type="button" onClick={close} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100" aria-label="إغلاق"><X size={16} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {q.length < SEARCH_MIN_CHARS && <p className="py-6 text-center text-xs text-gray-400">اكتب حرفين على الأقل — والتليفون 3 أرقام</p>}
          {failed && <p className="py-6 text-center text-xs text-red-500">تعذر البحث — جرّب تاني</p>}
          {answer && !hits.length && !loading && <p className="py-6 text-center text-xs text-gray-400">مفيش نتايج لـ «{q}»</p>}
          {answer && GROUPS.filter(group => (answer[group.kind] || []).length).map(group => {
            const Icon = group.icon;
            return (
              <section key={group.kind} className="mb-2">
                <h4 className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-bold text-gray-500"><Icon size={12} /> {group.label}</h4>
                {answer[group.kind].map(hit => {
                  index += 1;
                  const at = index;
                  return (
                    <button key={`${group.kind}-${hit.id}`} type="button" onClick={() => go(hit)} onMouseEnter={() => setCursor(at)}
                      className={`block w-full rounded-xl px-3 py-2 text-right transition ${cursor === at ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                      <span className="block text-sm font-bold text-gray-800">{hit.title}</span>
                      {hit.subtitle && <span className="block text-xs text-gray-500" dir="auto">{hit.subtitle}</span>}
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
        <p className="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-400">↑ ↓ للتنقل · Enter للفتح · Esc للإغلاق</p>
      </Modal>
    </>
  );
}
