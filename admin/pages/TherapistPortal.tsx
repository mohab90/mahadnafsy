import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock3, ExternalLink, UserRound, Pencil, Save, X } from 'lucide-react';
import { mysqlClient } from '../lib/mysqlapi';
import { sortConsultationsByDate, meetingProviderLabels } from '../lib/consultations';
import type { ConsultationItem, Therapist } from '../types';

const TherapistPortal: React.FC = () => {
  const [therapist, setTherapist] = useState<Therapist | null>(null);
  const [consultations, setConsultations] = useState<ConsultationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const [savingId, setSavingId] = useState('');

  useEffect(() => {
    let cancelled = false;
    void mysqlClient.getTherapistPortal()
      .then(result => {
        if (cancelled) return;
        setTherapist(result.therapist as unknown as Therapist);
        setConsultations(result.consultations as unknown as ConsultationItem[]);
      })
      .catch(error => { if (!cancelled) setErrorText(error instanceof Error ? error.message : 'تعذر تحميل بوابة المحاضر'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const therapistConsultations = useMemo(() => {
    if (!therapist) return [];
    return sortConsultationsByDate(
      consultations.filter((row) => row.therapistId === therapist.id || row.therapistName === therapist.name)
    );
  }, [consultations, therapist]);

  const updateConsultation = async (item: ConsultationItem, patch: { status?: ConsultationItem['status']; notes?: string }) => {
    setSavingId(item.id);
    setErrorText('');
    try {
      await mysqlClient.updateTherapistConsultation(item.id, patch);
      setConsultations(rows => rows.map(row => row.id === item.id ? { ...row, ...patch } : row));
      return true;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'تعذر تحديث الجلسة');
      return false;
    } finally {
      setSavingId('');
    }
  };

  if (loading) return <div className="min-h-screen grid place-items-center bg-gray-50"><div className="w-10 h-10 rounded-full border-4 border-primary-200 border-t-primary-600 animate-spin" /></div>;

  if (!therapist) {
    return (
      <div className="min-h-screen bg-gray-50 py-14">
        <div className="container mx-auto px-4 max-w-lg">
          <div className="bg-white border border-gray-200 rounded-3xl shadow-sm p-8 space-y-6">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-primary-600 text-white grid place-items-center mx-auto mb-4">
                <UserRound size={26} />
              </div>
              <h1 className="text-3xl font-extrabold text-gray-900">بوابة المحاضر</h1>
              <p className="text-gray-500">لا يوجد ملف معالج نشط مرتبط بحساب الموظف الحالي.</p>
              {errorText && <div className="border border-red-200 bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{errorText}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const stats = {
    total: therapistConsultations.length,
    pending: therapistConsultations.filter((item) => item.status === 'pending').length,
    confirmed: therapistConsultations.filter((item) => item.status === 'confirmed').length,
    completed: therapistConsultations.filter((item) => item.status === 'completed').length,
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="container mx-auto px-4 max-w-6xl space-y-6">
        <div className="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img src={therapist.image} alt={therapist.name} className="w-16 h-16 rounded-2xl object-cover border border-gray-200" />
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900">{therapist.name}</h1>
              <p className="text-sm text-gray-500">{therapist.title || therapist.specialty}</p>
              <p className="text-xs text-gray-500 mt-1">{meetingProviderLabels[therapist.consultationSettings!.meetingProvider]} • مرتبط بحساب الموظف الحالي</p>
            </div>
          </div>
          {errorText && <div className="border border-red-200 bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{errorText}</div>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <p className="text-xs text-gray-500">إجمالي الجلسات</p>
            <p className="text-3xl font-extrabold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white border border-amber-200 rounded-2xl p-4">
            <p className="text-xs text-amber-700">قيد الانتظار</p>
            <p className="text-3xl font-extrabold text-amber-800">{stats.pending}</p>
          </div>
          <div className="bg-white border border-blue-200 rounded-2xl p-4">
            <p className="text-xs text-blue-700">مؤكدة</p>
            <p className="text-3xl font-extrabold text-blue-800">{stats.confirmed}</p>
          </div>
          <div className="bg-white border border-emerald-200 rounded-2xl p-4">
            <p className="text-xs text-emerald-700">مكتملة</p>
            <p className="text-3xl font-extrabold text-emerald-800">{stats.completed}</p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-primary-600" />
            <h2 className="text-xl font-bold text-gray-900">جلساتي</h2>
          </div>

          {therapistConsultations.map((item) => (
            <div key={item.id} className="border border-gray-200 rounded-2xl p-4 bg-gray-50/60">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-2">
                  <p className="font-bold text-gray-900">{item.clientName}</p>
                  <p className="text-sm text-gray-500">{item.sessionDate} • {item.slotLabel || 'موعد يدوي'} • {item.sessionType}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-700">{item.clientPhone || 'بدون هاتف'}</span>
                    <span className="px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-700">{item.clientEmail || 'بدون بريد'}</span>
                    <span className="px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-700">{item.amount || 0} {item.currency || 'EGP'}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button disabled={savingId === item.id} onClick={() => void updateConsultation(item, { status: 'confirmed' })} className="px-3 py-2 rounded-xl bg-blue-50 text-blue-700 disabled:opacity-50 text-sm font-bold">تأكيد</button>
                  <button disabled={savingId === item.id} onClick={() => void updateConsultation(item, { status: 'completed' })} className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 disabled:opacity-50 text-sm font-bold">إنهاء</button>
                  <button disabled={savingId === item.id} onClick={() => void updateConsultation(item, { status: 'cancelled' })} className="px-3 py-2 rounded-xl bg-red-50 text-red-700 disabled:opacity-50 text-sm font-bold">إلغاء</button>
                  {item.meetingLink && (
                    <a href={item.meetingLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold">
                      <ExternalLink size={14} />
                      فتح الجلسة
                    </a>
                  )}
                </div>
              </div>

              {item.notes && editingNotesId !== item.id && (
                <p className="mt-3 text-sm text-gray-600 bg-white border border-gray-100 rounded-xl p-3">{item.notes}</p>
              )}
              {editingNotesId === item.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="w-full border border-primary-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none"
                    rows={3}
                    value={notesText}
                    onChange={(e) => setNotesText(e.target.value)}
                    placeholder="أضف ملاحظات الجلسة..."
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={savingId === item.id}
                      onClick={() => { void updateConsultation(item, { notes: notesText }).then(saved => { if (saved) setEditingNotesId(null); }); }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-bold"
                    >
                      <Save size={12} /> حفظ
                    </button>
                    <button
                      onClick={() => setEditingNotesId(null)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold"
                    >
                      <X size={12} /> إلغاء
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingNotesId(item.id); setNotesText(item.notes || ''); }}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-primary-600 transition"
                >
                  <Pencil size={12} /> {item.notes ? 'تعديل الملاحظات' : 'إضافة ملاحظات'}
                </button>
              )}
            </div>
          ))}

          {therapistConsultations.length === 0 && (
            <div className="border border-dashed border-gray-300 rounded-2xl p-8 text-center text-gray-500">
              لا توجد جلسات مرتبطة بهذا المحاضر حتى الآن.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-primary-600 mb-2"><Clock3 size={16} /><span className="font-bold">مدة الجلسة</span></div>
            <p className="text-gray-700">{therapist.consultationSettings?.sessionDurationMinutes || 0} دقيقة</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-primary-600 mb-2"><CheckCircle2 size={16} /><span className="font-bold">المواعيد النشطة</span></div>
            <p className="text-gray-700">{therapist.consultationSettings?.availableSlots.filter((slot) => slot.isActive).length || 0}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-primary-600 mb-2"><CalendarDays size={16} /><span className="font-bold">سعر الجلسة EGP</span></div>
            <p className="text-gray-700">{therapist.consultationSettings?.sessionPrice.EGP || 0} ج.م</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TherapistPortal;
