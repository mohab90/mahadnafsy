import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { cairoDay } from '../../../../../shared/cairoDate';

type Row = {
  kind: 'subscriber' | 'lead' | 'registration';
  id: string;
  clientCode: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  place: string;
  owner: string | null;
  createdAt: string;
};

const CLOSED_PLACES = new Set(['أرشيف العملاء', 'ليد محذوف', 'ليد مدمج في آخر']);

const PLACE_STYLE: Record<string, string> = {
  'عميل أونلاين': 'bg-blue-100 text-blue-700',
  'عميل الدقي': 'bg-violet-100 text-violet-700',
  'أرشيف العملاء': 'bg-gray-200 text-gray-700',
  'أرشيف الليدز': 'bg-gray-200 text-gray-700',
  'تسجيل دخول بالموقع': 'bg-emerald-100 text-emerald-700',
  'داتا سعودي': 'bg-orange-100 text-orange-700',
  'محلي قديم': 'bg-amber-100 text-amber-700',
};

type Candidate = { id: string; clientCode: string | null; name: string; phone: string | null; email: string | null; linkedToLiveAccount: boolean };

/** «العميلة بتدخل على حسابها تلاقي مفيش كورسات»: a site sign-up that is the same person as a client record, linked by a member of the staff. */
function LinkAccount({ row, onLinked }: { row: Row; onLinked: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const open = async () => {
    setBusy(true); setMessage('');
    try {
      const result = await mysqlAdmin.adminGet<{ candidates: Candidate[] }>(`/admin/site-accounts/${encodeURIComponent(row.id)}/candidates`);
      setCandidates(result.candidates);
      if (!result.candidates.length) setMessage('مفيش عميل بنفس الاسم — افتح ملف العميل الصح واربطه من الإيميل أو الرقم');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر البحث'); } finally { setBusy(false); }
  };
  const link = async (candidate: Candidate) => {
    const ok = await confirmDialog({
      title: 'ربط حساب الموقع بالعميل',
      message: `${row.email || row.phone || row.name} ← ${candidate.name} ${candidate.clientCode || ''}\nلما تربطهم هيشوف العميل كل كورساته ومدفوعاته لما يدخل. اتأكد إنهم نفس الشخص.${candidate.linkedToLiveAccount ? '\nالعميل ده مربوط بحساب موقع تاني شغال وهيتفك عنه.' : ''}`,
      confirmLabel: 'اربط',
      tone: 'normal',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await mysqlAdmin.adminPost(`/admin/site-accounts/${encodeURIComponent(row.id)}/link`, { subscriberId: candidate.id, force: candidate.linkedToLiveAccount });
      onLinked();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر الربط'); setBusy(false); }
  };
  if (!candidates) {
    return (
      <div>
        <button type="button" disabled={busy} onClick={() => void open()} className="rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">{busy ? '...' : 'ربطه بعميل'}</button>
        {message && <p className="mt-1 text-[10px] text-amber-700">{message}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {candidates.map(candidate => (
        <button key={candidate.id} type="button" disabled={busy} onClick={() => void link(candidate)}
          className="block w-full rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-right text-[10px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
          اربطه بـ {candidate.name} {candidate.clientCode || ''} {candidate.phone ? `· ${candidate.phone}` : ''}
        </button>
      ))}
      {message && <p className="text-[10px] text-amber-700">{message}</p>}
    </div>
  );
}

/**
 * Search the whole database — clients (archived too), every lead (archived,
 * imported, deleted, merged) and site sign-ups — through
 * GET /admin/client-db/search, so the answer does not depend on which rows the
 * browser happened to load or on holding view_leads. Each row says where the
 * person is and where they came from.
 */
export function WholeDatabaseSearch({ query }: { query: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [capped, setCapped] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const term = query.trim();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (term.length < 2) { setRows([]); setState('idle'); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      setState('loading');
      mysqlAdmin.adminGet<{ rows: Row[]; capped?: boolean }>(`/admin/client-db/search?q=${encodeURIComponent(term)}`)
        .then(result => { if (alive) { setRows(result.rows); setCapped(Boolean(result.capped)); setState('ready'); } })
        .catch(() => { if (alive) setState('error'); });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [term, refresh]);

  if (state === 'idle') return null;
  return (
    <div className="bg-white border border-emerald-200 rounded-2xl p-3 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800 mb-2">
        <Database size={15} className="text-emerald-600" />
        البحث في قاعدة البيانات كاملة
        {state === 'ready' && <span className="text-[11px] font-normal text-gray-500">{rows.length} نتيجة{capped ? ' — أول 50 من كل نوع، دقّق البحث' : ''}</span>}
      </h3>
      {state === 'loading' && <p className="text-xs text-gray-400 py-2">جاري البحث…</p>}
      {state === 'error' && <p className="text-xs text-red-600 py-2">تعذّر البحث في قاعدة البيانات</p>}
      {state === 'ready' && rows.length === 0 && <p className="text-xs text-gray-400 py-2">لا يوجد أي شخص بهذا الاسم أو الرقم في النظام.</p>}
      {state === 'ready' && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-100">
                <th className="text-right py-1.5 px-2">الاسم</th>
                <th className="text-right py-1.5 px-2">الهاتف</th>
                <th className="text-right py-1.5 px-2">مكانه في النظام</th>
                <th className="text-right py-1.5 px-2">المصدر</th>
                <th className="text-right py-1.5 px-2">المسئول</th>
                <th className="text-right py-1.5 px-2">التاريخ</th>
                <th className="text-right py-1.5 px-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                // The profile page opens live records only: a deleted client is
                // restored from «أرشيف العملاء», and a deleted or merged lead has
                // no page of its own — the row says where it is instead of
                // linking to «العميل غير موجود».
                const opensProfile = row.kind !== 'registration' && !CLOSED_PLACES.has(row.place);
                const profile = opensProfile ? `/client/${row.clientCode || row.id}` : null;
                return (
                  <tr key={`${row.kind}:${row.id}`} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 px-2">
                      {profile
                        ? <button type="button" onClick={() => navigate(profile)} className="font-bold text-primary-700 hover:underline">{row.name || '—'}</button>
                        : <span className="font-bold text-gray-800">{row.name || '—'}</span>}
                      {row.clientCode && <span className="mr-1 text-[10px] text-gray-400">{row.clientCode}</span>}
                    </td>
                    <td className="py-1.5 px-2 font-mono" dir="ltr">{row.phone || row.email || '—'}</td>
                    <td className="py-1.5 px-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PLACE_STYLE[row.place] || 'bg-sky-100 text-sky-700'}`}>{row.place}</span>
                    </td>
                    <td className="py-1.5 px-2 text-gray-600">{row.source || '—'}</td>
                    <td className="py-1.5 px-2 text-gray-600">{row.owner || '—'}</td>
                    <td className="py-1.5 px-2 text-gray-500">{row.createdAt ? cairoDay(row.createdAt) : '—'}</td>
                    <td className="py-1.5 px-2">{row.kind === 'registration' && <LinkAccount row={row} onLinked={() => setRefresh(count => count + 1)} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
