import React, { useCallback, useEffect, useState } from 'react';
import {
  X, Loader2, Phone, PhoneOff, CalendarPlus, Check, Ban,
  GraduationCap, Building2, Briefcase, Mail, FileText,
} from 'lucide-react';

import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { EXPERIENCE_YEARS as YEARS, BRANCH_LABELS as BRANCHES, STAGE_LABELS as STAGES } from "./hr-sections/applicantLabels";

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

type Applicant = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cv_url: string | null;
  stage: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';
  stage_notes: string | null;
  created_at: string;
  branch: string | null;
  education: string | null;
  experience_places: string | null;
  experience_years: string | null;
  phone_interview_at: string | null;
  phone_interview_result: 'passed' | 'failed' | 'no_answer' | null;
  interview_at: string | null;
};


const fmt = (value: string | null) => (value ? new Date(value).toLocaleDateString('ar-EG') : null);

/**
 * The applicants for one job, and the decisions you can take on them.
 *
 * The job card showed "3 متقدمين" as plain text with no way in, so every
 * decision — did we call them, are they in or out, when is the interview —
 * happened outside the system and came back as a note, if at all.
 *
 * Scheduling an interview moves the applicant onto the interviews screen and
 * out of this list, which is why the date and the stage are sent together: a
 * date with the stage left behind is how people went missing from both.
 */
export const JobApplicantsPanel: React.FC<{
  jobId: string;
  jobTitle: string;
  onClose: () => void;
  onChanged: () => void;
  notify: Notify;
}> = ({ jobId, jobTitle, onClose, onChanged, notify }) => {
  const [rows, setRows] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [dateDraft, setDateDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/hr/jobs/${encodeURIComponent(jobId)}/applicants`, {
      credentials: 'include', headers: adminAuthHeaders(),
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(data => setRows(Array.isArray(data) ? data : []))
      .catch(e => notify('error', `تعذر تحميل المتقدمين: ${e.message}`))
      .finally(() => setLoading(false));
  }, [jobId, notify]);

  useEffect(load, [load]);

  const patch = async (row: Applicant, body: Record<string, unknown>, ok: string) => {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/hr/applicants/${encodeURIComponent(row.id)}`, {
        method: 'PUT', credentials: 'include',
        headers: { ...adminAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      notify('success', ok);
      load();
      onChanged();
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally { setBusyId(''); }
  };

  const active = rows.filter(r => r.stage !== 'rejected' && r.stage !== 'hired');
  const closed = rows.filter(r => r.stage === 'rejected' || r.stage === 'hired');

  const Card = ({ row }: { row: Applicant }) => {
    const busy = busyId === row.id;
    const stage = STAGES[row.stage] || STAGES.applied;
    const decided = row.stage === 'rejected' || row.stage === 'hired' || row.stage === 'offer';
    return (
      <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-800 text-sm">{row.name}</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${stage.tone}`}>{stage.label}</span>
              {row.interview_at && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
                  مقابلة {fmt(row.interview_at)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-gray-600">
              {row.phone && <span className="font-mono" dir="ltr">{row.phone}</span>}
              {row.email && <span className="flex items-center gap-1"><Mail size={11} />{row.email}</span>}
              {row.branch && <span className="flex items-center gap-1"><Building2 size={11} />{BRANCHES[row.branch] || row.branch}</span>}
              {row.experience_years && <span className="flex items-center gap-1"><Briefcase size={11} />{YEARS[row.experience_years] || row.experience_years}</span>}
              {row.education && <span className="flex items-center gap-1"><GraduationCap size={11} />{row.education}</span>}
              {row.cv_url && (
                <a href={row.cv_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-indigo-600 hover:underline">
                  <FileText size={11} />السيرة الذاتية
                </a>
              )}
            </div>
            {row.experience_places && (
              <p className="text-[11px] text-gray-500 mt-1">اشتغل قبل كده: {row.experience_places}</p>
            )}
            {row.phone_interview_result && (
              <p className="text-[11px] mt-1">
                <span className="text-gray-500">الفون انترفيو: </span>
                <span className={row.phone_interview_result === 'passed' ? 'text-emerald-700 font-bold'
                  : row.phone_interview_result === 'failed' ? 'text-rose-700 font-bold' : 'text-amber-700 font-bold'}>
                  {row.phone_interview_result === 'passed' ? 'نجح'
                    : row.phone_interview_result === 'failed' ? 'لم ينجح' : 'لم يرد'}
                </span>
                {row.phone_interview_at && <span className="text-gray-400"> · {fmt(row.phone_interview_at)}</span>}
              </p>
            )}
          </div>
          <span className="text-[10px] text-gray-400 whitespace-nowrap">قدّم {fmt(row.created_at)}</span>
        </div>

        {!decided && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-gray-100">
            {/* The phone screen is the first real decision and had nowhere to
                live — staff tracked "did we call them" outside the system. */}
            {!row.phone_interview_result && (
              <>
                <button disabled={busy}
                  onClick={() => patch(row, { phone_interview_result: 'passed', phone_interview_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }, 'اتسجل: الفون انترفيو نجح')}
                  className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-[11px] font-bold hover:bg-emerald-100 transition disabled:opacity-40">
                  <Phone size={11} />فون انترفيو نجح
                </button>
                <button disabled={busy}
                  onClick={() => patch(row, { phone_interview_result: 'no_answer', phone_interview_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }, 'اتسجل: لم يرد')}
                  className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-[11px] font-bold hover:bg-amber-100 transition disabled:opacity-40">
                  <PhoneOff size={11} />لم يرد
                </button>
              </>
            )}
            <span className="flex items-center gap-1">
              <input type="date" value={dateDraft[row.id] || ''}
                onChange={e => setDateDraft(d => ({ ...d, [row.id]: e.target.value }))}
                className="border border-gray-200 rounded-lg px-2 py-1 text-[11px]" />
              <button disabled={busy || !dateDraft[row.id]}
                onClick={() => patch(row, { interview_at: `${dateDraft[row.id]} 10:00:00`, stage: 'interview' }, 'اتحدد موعد المقابلة — المتقدم راح لصفحة المقابلات')}
                className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-[11px] font-bold hover:bg-indigo-700 transition disabled:opacity-40">
                {busy ? <Loader2 size={11} className="animate-spin" /> : <CalendarPlus size={11} />}حدد مقابلة
              </button>
            </span>
            <button disabled={busy}
              onClick={() => patch(row, { stage: 'offer' }, 'اتقبل المتقدم')}
              className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[11px] font-bold hover:bg-emerald-700 transition disabled:opacity-40">
              <Check size={11} />مقبول
            </button>
            <button disabled={busy}
              onClick={() => {
                const why = window.prompt('سبب الرفض (اختياري):') ?? undefined;
                if (why === undefined) return;
                patch(row, { stage: 'rejected', ...(why ? { stage_notes: why } : {}) }, 'اترفض المتقدم');
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-700 rounded-lg text-[11px] font-bold hover:bg-rose-100 transition disabled:opacity-40">
              <Ban size={11} />مرفوض
            </button>
          </div>
        )}
        {row.stage_notes && <p className="text-[11px] text-gray-500 border-t border-gray-100 pt-1.5">{row.stage_notes}</p>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto p-5" dir="rtl">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-extrabold text-gray-800">المتقدمون — {jobTitle}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <p className="text-[11px] text-gray-500 mb-4">
          تحديد موعد مقابلة بينقل المتقدم لصفحة المقابلات ويختفي من هنا.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 size={22} className="animate-spin ml-2" /> جاري التحميل...
          </div>
        ) : !rows.length ? (
          <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-200 rounded-2xl">
            مفيش متقدمين على الوظيفة دي لسه
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {active.map(row => <Card key={row.id} row={row} />)}
              {!active.length && (
                <p className="text-xs text-gray-400 text-center py-4">مفيش متقدمين مستنيين قرار</p>
              )}
            </div>
            {closed.length > 0 && (
              <details className="border-t border-gray-100 pt-3">
                <summary className="text-xs font-bold text-gray-500 cursor-pointer">
                  المرفوضون والمعيَّنون ({closed.length})
                </summary>
                <div className="space-y-2 mt-2 opacity-70">
                  {closed.map(row => <Card key={row.id} row={row} />)}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default JobApplicantsPanel;
