import { cairoStamp } from '../../../../../shared/cairoDate';

/** How one sign-in attempt ended (api/routes/misc/analytics.js attemptState). */
export type AttemptState = 'ok' | 'failed' | 'pending' | 'done';

export const STATE_META: Record<AttemptState, { label: string; cls: string }> = {
  ok: { label: 'نجح', cls: 'bg-green-100 text-green-700' },
  failed: { label: 'فشل', cls: 'bg-red-100 text-red-700' },
  pending: { label: 'ماكملش كود التحقق', cls: 'bg-amber-100 text-amber-700' },
  // The password step of a sign-in that went on to enter its code — one sign-in, not two.
  done: { label: 'خطوة كلمة المرور (اكتمل التحقق)', cls: 'bg-blue-100 text-blue-700' },
};

/** Turn a raw user-agent into something a non-technical admin can scan. */
export function deviceLabel(ua: string | null | undefined): string {
  const s = String(ua || '');
  if (!s) return '—';
  const os = /Windows/i.test(s) ? 'Windows'
    : /Android/i.test(s) ? 'Android'
      : /iPhone|iPad|iOS/i.test(s) ? 'iOS'
        : /Mac OS X|Macintosh/i.test(s) ? 'macOS'
          : /Linux/i.test(s) ? 'Linux' : 'غير معروف';
  const browser = /Edg\//i.test(s) ? 'Edge'
    : /OPR\//i.test(s) ? 'Opera'
      : /Chrome\//i.test(s) ? 'Chrome'
        : /Firefox\//i.test(s) ? 'Firefox'
          : /Safari\//i.test(s) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
}

/** A moment in Cairo's own clock; a dash for nothing. */
export function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  return cairoStamp(value) || String(value);
}

/** One attempt as the log returns it. */
export interface LoginEvent {
  id: number;
  user_id: string | null;
  email: string | null;
  phone: string | null;
  name?: string | null;
  client_code?: string | null;
  subscriber_id?: string | null;
  /** What the person is in the client base: a client of a branch, a lead, or no record (api/lib/loginClientKind.js). */
  client_kind?: 'client' | 'lead' | 'none';
  branch_label?: string;
  /** A client who also still has a lead of the same number or email open — a duplicate the desk can clear. */
  also_lead?: boolean;
  ip: string | null;
  user_agent: string | null;
  status: 'success' | 'failed' | '2fa_pending' | '2fa_success';
  state: AttemptState;
  failure_reason: string | null;
  reason_label: string | null;
  created_at: string;
}

/** The «الفرع» chip of a sign-in: a client of a branch, a lead («محتمل»), or nobody on file. */
export function branchChip(kind: 'client' | 'lead' | 'none' | undefined, label: string | undefined): { text: string; cls: string } {
  if (kind === 'lead') return { text: label || 'محتمل', cls: 'bg-amber-100 text-amber-800' };
  if (kind === 'client') {
    const text = label || 'عميل';
    if (text === 'الدقي') return { text, cls: 'bg-indigo-100 text-indigo-800' };
    if (text === 'التجمع') return { text, cls: 'bg-purple-100 text-purple-800' };
    if (text.includes('سعودي')) return { text, cls: 'bg-green-100 text-green-800' };
    if (text.includes('دولي')) return { text, cls: 'bg-sky-100 text-sky-800' };
    return { text, cls: 'bg-emerald-100 text-emerald-800' };
  }
  return { text: 'مش مسجل', cls: 'bg-gray-100 text-gray-500' };
}
