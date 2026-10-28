// «0» and «7»: who the payment is for — picked when the screen did not start from them, typed in for a new client,
// their real Arabic and English names and their numbers confirmed, the lead's branch, and their seat in a Dokki round.
import { latinDigits } from '../../../shared/latinDigits';
import { Home } from 'lucide-react';
import { Modal } from '../../../shared/ui/Modal';
import { DaqqiRoundPicker } from '../../pages/dashboard/tabs/daqqi/DaqqiRoundPicker';
import { roundLabel } from '../../pages/dashboard/tabs/daqqi/daqqiScheduleUtils';
import { arabicNameProblem, englishNameProblem, nationalIdProblem } from '../../lib/bookingIdentity';
import { PhoneConfirm } from '../PhoneConfirm';
import { SharedPhonePanel } from '../SharedPhonePanel';
import { SubjectSearchPicker } from './SubjectSearchPicker';
import type { PaymentModalModel } from './usePaymentModalModel';

export function PaymentPersonSection({ m }: { m: PaymentModalModel }) {
  const {
    mode, subject, onClose, branchOptions, subjectOptions, subjectSearch, onSubjectChange, courses, bundles, d, set,
    housingOpen, setHousingOpen, personName, setPhoneNow, setPhone2Now, personPhone, personPhone2, tierBooking,
    housingRounds, canHouse, housingRound, noteField, egyptianId,
  } = m;
  return (
    <>
      {/* ── 0: who is this for, when the screen did not start from them ── */}
      {subjectOptions && (
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">العميل <span className="text-red-500">*</span></label>
          <select
            value={subject.id}
            onChange={e => onSubjectChange?.(e.target.value)}
            className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-semibold ${!subject.id ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white'}`}
          >
            <option value="">— اختر العميل —</option>
            {subjectOptions.map(o => (
              <option key={o.id} value={o.id}>{o.clientCode ? `${o.clientCode} — ${o.name}` : o.name}</option>
            ))}
          </select>
        </div>
      )}

      {subjectSearch && (
        <SubjectSearchPicker subjectId={subject.id} subjectName={subject.name} search={subjectSearch} onPick={id => onSubjectChange?.(id)} />
      )}

      {/* ── 7: new-customer identity ── */}
      {mode === 'new' && (
        <div className="space-y-3 border border-indigo-100 bg-indigo-50/40 rounded-xl p-3">
          <p className="text-[11px] font-bold text-indigo-700">بيانات العميل الجديد</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">{tierBooking ? 'الاسم بالعربي (ثلاثي)' : 'الاسم'} <span className="text-red-500">*</span></label>
              <input
                type="text" value={d.name || ''}
                // In a course booking this is the real Arabic name the server records.
                onChange={e => set({ name: e.target.value, nameAr: e.target.value })}
                className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-semibold ${!(d.name || '').trim() ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">الهاتف <span className="text-red-500">*</span></label>
              <input
                type="tel" dir="ltr" value={d.phone || ''}
                onChange={e => set({ phone: latinDigits(e.target.value) })}
                className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-mono ${!(d.phone || '').trim() ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
              />
            </div>
          </div>
          <SharedPhonePanel phone={d.phone || ''} branch={d.branch || ''} value={d.sharedPhone}
            onChange={next => set({ sharedPhone: next })}
            onOpenHolder={holder => window.open(`/client/${encodeURIComponent(holder.clientCode || holder.id)}`, '_blank', 'noopener')} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">البريد الإلكتروني <span className="text-gray-400 font-normal">(اختياري)</span></label>
              <input
                type="email" dir="ltr" placeholder="email@example.com"
                value={d.email || ''}
                onChange={e => set({ email: e.target.value })}
                className={`w-full border rounded-xl px-3 py-2 text-sm font-mono ${d.email && !d.email.includes('@') ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
              />
            </div>
            {/* In a course booking the branch is the one picked with the price, above. */}
            {tierBooking ? noteField : branchOptions.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">الفرع</label>
                <select
                  value={d.branch || ''}
                  onChange={e => set({ branch: e.target.value })}
                  className="w-full border-2 border-gray-200 bg-white rounded-xl px-3 py-2 text-sm font-semibold"
                >
                  <option value="">— اختر الفرع —</option>
                  {branchOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 7b: Lead-only: branch selector — in a course booking it is the one picked with the price ── */}
      {mode === 'lead' && !tierBooking && (
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">الفرع <span className="text-red-500">*</span></label>
          <select
            value={d.branch || ''}
            onChange={e => set({ branch: e.target.value })}
            className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-semibold ${!d.branch ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white'}`}
          >
            <option value="">— اختر الفرع —</option>
            {branchOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
      )}

      {/* ── 7a: «اسم العميل الحقيقي عربي ثلاثي وايضا اسمه بالانجليزي، وتاكيد علي
            رقم التليفون والرقم القومي» — with every new course booking. ── */}
      {tierBooking && d.courseId && (
        <div className="space-y-3 rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-3">
          <p className="text-xs font-extrabold text-emerald-800">بيانات العميل الحقيقية</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {mode !== 'new' && (
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gray-700">الاسم بالعربي (ثلاثي) <span className="text-red-500">*</span></span>
                <input type="text" value={d.nameAr || ''} placeholder="مثال: أحمد محمد علي"
                  onChange={e => set({ nameAr: e.target.value })}
                  className={`w-full rounded-xl border-2 px-3 py-2 text-sm font-semibold ${arabicNameProblem(d.nameAr) ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`} />
                {d.nameAr && arabicNameProblem(d.nameAr) && <span className="mt-1 block text-[11px] text-red-600">{arabicNameProblem(d.nameAr)}</span>}
              </label>
            )}
            {mode === 'new' && d.name && arabicNameProblem(d.nameAr || d.name) && (
              <p className="text-[11px] text-red-600 sm:col-span-2">{arabicNameProblem(d.nameAr || d.name)}</p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-gray-700">الاسم بالإنجليزي</span>
              <input type="text" dir="ltr" value={d.nameEn || ''} placeholder="Ahmed Mohamed Ali"
                onChange={e => set({ nameEn: e.target.value })}
                className={`w-full rounded-xl border px-3 py-2 text-sm ${englishNameProblem(d.nameEn) ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`} />
              {englishNameProblem(d.nameEn) && <span className="mt-1 block text-[11px] text-red-600">{englishNameProblem(d.nameEn)}</span>}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-gray-700">{egyptianId ? 'الرقم القومي' : 'رقم الهوية / الجواز'}</span>
              <input type="text" dir="ltr" inputMode={egyptianId ? 'numeric' : 'text'} value={d.nationalId || ''}
                placeholder={egyptianId ? '14 رقم' : 'اختياري'}
                onChange={e => set({ nationalId: latinDigits(e.target.value) })}
                className={`w-full rounded-xl border px-3 py-2 text-sm font-mono ${nationalIdProblem(d.nationalId, egyptianId) ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`} />
              {nationalIdProblem(d.nationalId, egyptianId) && <span className="mt-1 block text-[11px] text-red-600">{nationalIdProblem(d.nationalId, egyptianId)}</span>}
            </label>
            <div className="sm:col-span-2">
              <PhoneConfirm
                confirmed={Boolean(d.phoneConfirmed)}
                onConfirmed={value => set({ phoneConfirmed: value })}
                phone={personPhone || ''}
                phone2={personPhone2}
                saveFor={mode === 'subscriber' && subject.id ? { id: subject.id, name: subject.name } : undefined}
                onChange={(a, b) => {
                  if (mode === 'new') set({ phone: a, phone2: b });
                  else { setPhoneNow(a); setPhone2Now(b); }
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── 7c: Dokki: seat the client in a round with the booking ── */}
      {canHouse && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2">
          <button
            type="button"
            onClick={() => setHousingOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100"
          >
            <Home size={13} /> تسكين في روند
          </button>
          {housingRound ? (
            <>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-indigo-900" title={roundLabel(housingRound, courses)}>{roundLabel(housingRound, courses)}</span>
              <button type="button" onClick={() => set({ daqqiRoundId: '' })} className="text-xs font-bold text-red-500 hover:text-red-700" title="إلغاء التسكين">✕</button>
            </>
          ) : (
            <span className="text-xs text-indigo-700/80">اختياري — العميل بيتسكّن في الروند أول ما الحجز يتسجّل.</span>
          )}
        </div>
      )}
      {housingOpen && (
        <Modal open onClose={() => setHousingOpen(false)} layer="over" size="md" title="تسكين في روند" subtitle={personName || undefined} icon={<Home size={18} className="text-indigo-600" />}>
          <DaqqiRoundPicker
            rounds={housingRounds}
            courses={courses}
            selectedId={d.daqqiRoundId || ''}
            onSelect={roundId => { set({ daqqiRoundId: roundId }); setHousingOpen(false); }}
            clientCourseIds={(d.courseId?.startsWith('bundle:')
              ? (bundles.find(b => b.id === d.courseId.replace('bundle:', ''))?.courses || []).map(c => c.id)
              : d.courseId ? [d.courseId] : [])}
          />
        </Modal>
      )}
    </>
  );
}
