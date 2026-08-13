import React from 'react';
import { Plus, Upload } from 'lucide-react';
import { defaultMeetingBaseUrls, meetingProviderLabels } from '../../../../lib/consultations';
import type { ConsultationItem, StaffMember, Therapist, TherapistAvailabilitySlot } from '../../../../types';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

interface Props {
  activeTab: string;
  isAdmin: boolean;
  therapists: Therapist[];
  staffMembers: StaffMember[];
  consultations: ConsultationItem[];
  isTherapistFormOpen: boolean;
  setIsTherapistFormOpen: (open: boolean) => void;
  editingTherapistId: string;
  setEditingTherapistId: (id: string) => void;
  therapistDraft: Therapist;
  setTherapistDraft: SetState<Therapist>;
  therapistImageInputRef: React.RefObject<HTMLInputElement | null>;
  handleTherapistImageUpload: (files: FileList | null) => Promise<void>;
  blankTherapist: () => Therapist;
  blankTherapistSlot: () => TherapistAvailabilitySlot;
  therapistAvatarDataUrl: (name?: string) => string;
  safeTherapistImageSrc: (image: string | undefined, name?: string) => string;
  saveTherapist: () => Promise<void>;
  updateTherapist: (row: Therapist) => Promise<boolean>;
  startEditTherapist: (row: Therapist) => void;
  deleteTherapist: (id: string) => Promise<boolean>;
}

export function CourseInstructorsPanel({
  activeTab,
  isAdmin,
  therapists,
  staffMembers,
  consultations,
  isTherapistFormOpen,
  setIsTherapistFormOpen,
  editingTherapistId,
  setEditingTherapistId,
  therapistDraft,
  setTherapistDraft,
  therapistImageInputRef,
  handleTherapistImageUpload,
  blankTherapist,
  blankTherapistSlot,
  therapistAvatarDataUrl,
  safeTherapistImageSrc,
  saveTherapist,
  updateTherapist,
  startEditTherapist,
  deleteTherapist,
}: Props) {
  return (
    <>
  {activeTab === 'instructors' && (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-bold text-gray-900">إدارة المحاضرين</h3>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                const now = new Date();
                const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
                const backup = { _meta: { createdAt: now.toISOString(), type: 'instructors' }, therapists };
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `backup_instructors_${stamp}.json`; a.click();
                URL.revokeObjectURL(url);
              }}
              className="bg-green-50 text-green-700 border border-green-200 px-3 py-2 rounded-xl text-sm font-bold hover:bg-green-100 transition flex items-center gap-1"
            >
              💾 نسخة احتياطية
            </button>
          )}
          <button
            onClick={() => {
              if (isTherapistFormOpen && !editingTherapistId) {
                setIsTherapistFormOpen(false);
                return;
              }
              setEditingTherapistId('');
              setTherapistDraft(blankTherapist());
              setIsTherapistFormOpen(true);
            }}
            className="bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-4 py-2.5 font-bold text-sm"
          >
            <Plus size={16} className="inline ml-1" />
            {isTherapistFormOpen ? 'إغلاق نموذج المحاضر' : 'إضافة محاضر'}
          </button>
        </div>
      </div>

      {isTherapistFormOpen && (
        <div className="border border-gray-200 rounded-2xl p-4 mb-4 bg-gray-50/70 space-y-4">
          <input ref={therapistImageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void handleTherapistImageUpload(e.target.files); e.target.value = ''; }} />

          <div className="flex flex-col lg:flex-row gap-4">
            <div className="w-full lg:w-56 shrink-0 border border-dashed border-gray-300 rounded-2xl bg-white p-4 text-center">
              <div className="w-32 h-32 mx-auto rounded-2xl overflow-hidden bg-gray-100 border border-gray-200">
                {therapistDraft.image ? (
                  <img
                    src={safeTherapistImageSrc(therapistDraft.image, therapistDraft.name)}
                    alt={therapistDraft.name || 'therapist'}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).src = therapistAvatarDataUrl(therapistDraft.name); }}
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-xs text-gray-400">لا توجد صورة</div>
                )}
              </div>
              <div className="mt-3 space-y-2">
                <button type="button" onClick={() => therapistImageInputRef.current?.click()} className="w-full px-3 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold">
                  <Upload size={14} className="inline ml-1" />رفع صورة
                </button>
                <input className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" placeholder="أو ضع رابط الصورة" value={therapistDraft.image} onChange={(e) => setTherapistDraft({ ...therapistDraft, image: e.target.value })} />
              </div>
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="الاسم" value={therapistDraft.name} onChange={(e) => setTherapistDraft({ ...therapistDraft, name: e.target.value })} />
              <select
                className="border border-gray-300 rounded-xl px-4 py-2.5"
                value={therapistDraft.staffId || ''}
                onChange={(event) => {
                  const staff = staffMembers.find(item => item.id === event.target.value);
                  setTherapistDraft({ ...therapistDraft, staffId: event.target.value || undefined, name: therapistDraft.name || staff?.name || '' });
                }}
              >
                {/* Every active employee, not only role instructor/trainer. This
                    institute has no staff carrying those two roles at all, so
                    the list was permanently empty and no lecturer could ever be
                    linked — which is why course creation kept warning that the
                    lecturer has no staff account. The server-side check accepts
                    any active employee of the tenant for exactly this reason;
                    the filter here just never matched it. */}
                <option value="">بدون ربط — يُحفظ باسم المحاضر فقط</option>
                {staffMembers.filter(item => item.status === 'active')
                  .map(item => <option key={item.id} value={item.id}>{item.name}{item.role ? ` — ${item.role}` : ''}</option>)}
              </select>
              <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="التخصص الرئيسي" value={therapistDraft.specialty} onChange={(e) => setTherapistDraft({ ...therapistDraft, specialty: e.target.value })} />
              <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="المسمى الوظيفي" value={therapistDraft.title || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, title: e.target.value })} />
              <input type="number" className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="سنوات الخبرة" value={therapistDraft.experience} onChange={(e) => setTherapistDraft({ ...therapistDraft, experience: Number(e.target.value) })} />
              <input type="number" className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="التقييم" min={0} max={5} step="0.1" value={therapistDraft.rating} onChange={(e) => setTherapistDraft({ ...therapistDraft, rating: Number(e.target.value) })} />
              <input type="number" className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="رقم الترتيب (1 = أول، 99 = آخر)" min={1} value={therapistDraft.sortOrder ?? 99} onChange={(e) => setTherapistDraft({ ...therapistDraft, sortOrder: Number(e.target.value) })} />
              <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-4 py-2.5 bg-white text-sm font-medium text-gray-700">
                <input type="checkbox" checked={Boolean(therapistDraft.featured)} onChange={(e) => setTherapistDraft({ ...therapistDraft, featured: e.target.checked })} />
                إبراز المحاضر في الصفحة العامة
              </label>
              <label className={`flex items-center gap-2 border-2 rounded-xl px-4 py-2.5 text-sm font-bold cursor-pointer transition-colors ${
                therapistDraft.showOnHome
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-dashed border-gray-300 bg-white text-gray-500'
              }`}>
                <input type="checkbox" checked={Boolean(therapistDraft.showOnHome)} onChange={(e) => setTherapistDraft({ ...therapistDraft, showOnHome: e.target.checked })} />
                🏠 يظهر في الصفحة الرئيسية
                {!therapistDraft.showOnHome && <span className="text-xs text-red-400 mr-1">(غير مفعّل)</span>}
              </label>
              <label className={`flex items-center gap-2 border-2 rounded-xl px-4 py-2.5 text-sm font-bold cursor-pointer transition-colors ${
                therapistDraft.showOnAbout
                  ? 'border-amber-400 bg-amber-50 text-amber-700'
                  : 'border-dashed border-gray-300 bg-white text-gray-500'
              }`}>
                <input type="checkbox" checked={Boolean(therapistDraft.showOnAbout)} onChange={(e) => setTherapistDraft({ ...therapistDraft, showOnAbout: e.target.checked })} />
                ℹ️ يظهر في فريق العمل (عن المعهد)
                {!therapistDraft.showOnAbout && <span className="text-xs text-red-400 mr-1">(غير مفعّل)</span>}
              </label>
              <textarea className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" rows={4} placeholder="النبذة المهنية" value={therapistDraft.bio || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, bio: e.target.value })} />
              <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="اللغات مفصولة بفاصلة" value={(therapistDraft.languages || []).join(', ')} onChange={(e) => setTherapistDraft({ ...therapistDraft, languages: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
              <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="محاور الخبرة أو المجالات العلاجية مفصولة بفاصلة" value={(therapistDraft.focusAreas || []).join(', ')} onChange={(e) => setTherapistDraft({ ...therapistDraft, focusAreas: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
              <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="المؤهلات والشهادات مفصولة بفاصلة" value={(therapistDraft.qualifications || []).join(', ')} onChange={(e) => setTherapistDraft({ ...therapistDraft, qualifications: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
            </div>
          </div>

          <div className="border border-gray-200 rounded-2xl bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-bold text-gray-900">تفعيل خدمة الجلسات والاستشارات</h4>
                <p className="text-xs text-gray-500">عند التفعيل سيظهر المحاضر في صفحة الاستشارات ويُفتح له حساب دخول لبوابته.</p>
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm font-bold text-gray-700">
                <input
                  type="checkbox"
                  checked={Boolean(therapistDraft.consultationSettings?.enabled)}
                  onChange={(e) => setTherapistDraft({
                    ...therapistDraft,
                    consultationSettings: {
                      ...(therapistDraft.consultationSettings || blankTherapist().consultationSettings!),
                      enabled: e.target.checked,
                    },
                  })}
                />
                {therapistDraft.consultationSettings?.enabled ? 'الخدمة مفعلة' : 'الخدمة غير مفعلة'}
              </label>
            </div>

            {therapistDraft.consultationSettings?.enabled && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div><label className="block text-xs font-bold text-gray-600 mb-1">مدة الجلسة (بالدقائق)</label><input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="مثال: 60" value={therapistDraft.consultationSettings.sessionDurationMinutes} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, sessionDurationMinutes: Number(e.target.value) || 0 } })} /></div>
                  <div><label className="block text-xs font-bold text-gray-600 mb-1">سعر الجلسة EGP (جنيه مصري)</label><input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" value={therapistDraft.consultationSettings.sessionPrice.EGP} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, sessionPrice: { ...therapistDraft.consultationSettings!.sessionPrice, EGP: Number(e.target.value) || 0 } } })} /></div>
                  <div><label className="block text-xs font-bold text-gray-600 mb-1">سعر الجلسة SAR (ريال سعودي)</label><input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" value={therapistDraft.consultationSettings.sessionPrice.SAR} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, sessionPrice: { ...therapistDraft.consultationSettings!.sessionPrice, SAR: Number(e.target.value) || 0 } } })} /></div>
                  <div><label className="block text-xs font-bold text-gray-600 mb-1">سعر الجلسة USD (دولار أمريكي)</label><input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" value={therapistDraft.consultationSettings.sessionPrice.USD} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, sessionPrice: { ...therapistDraft.consultationSettings!.sessionPrice, USD: Number(e.target.value) || 0 } } })} /></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <select className="border border-gray-300 rounded-xl px-4 py-2.5" value={therapistDraft.consultationSettings.meetingProvider} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, meetingProvider: e.target.value as 'zoom' | 'google_meet' | 'custom', providerBaseUrl: defaultMeetingBaseUrls[e.target.value as 'zoom' | 'google_meet' | 'custom'] } })}>
                    <option value="google_meet">Google Meet</option>
                    <option value="zoom">Zoom</option>
                    <option value="custom">رابط مخصص</option>
                  </select>
                  <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="رابط الأساس أو endpoint الخاص بالمنصة" value={therapistDraft.consultationSettings.providerBaseUrl} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, providerBaseUrl: e.target.value } })} />
                  <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-4 py-2.5 bg-gray-50 text-sm font-medium text-gray-700">
                    <input type="checkbox" checked={therapistDraft.consultationSettings.autoCreateMeetingLink} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, autoCreateMeetingLink: e.target.checked } })} />
                    توليد رابط اجتماع تلقائياً
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    دخول بوابة المحاضر يتم بحساب الموظف المرتبط أعلاه، بدون اسم مستخدم أو كلمة مرور منفصلة.
                  </div>
                  <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="رابط نموذج intake أو استبيان ما قبل الجلسة" value={therapistDraft.consultationSettings.intakeFormUrl || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, intakeFormUrl: e.target.value } })} />
                  <textarea className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" rows={3} placeholder="تعليمات الحجز أو تجهيزات ما قبل الجلسة" value={therapistDraft.consultationSettings.bookingNotes || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, bookingNotes: e.target.value } })} />
                </div>

                <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50/60 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h5 className="font-bold text-gray-900">المواعيد المتاحة</h5>
                      <p className="text-xs text-gray-500">هذه المواعيد ستظهر في صفحات الاستشارة العامة وسيُبنى عليها جدول المحاضر.</p>
                    </div>
                    <button type="button" onClick={() => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: [...therapistDraft.consultationSettings!.availableSlots, blankTherapistSlot()] } })} className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold">
                      <Plus size={14} className="inline ml-1" />إضافة موعد
                    </button>
                  </div>

                  <div className="space-y-3">
                    {therapistDraft.consultationSettings.availableSlots.map((slot, index) => (
                      <div key={slot.id} className="grid grid-cols-1 md:grid-cols-6 gap-2 border border-gray-200 rounded-xl bg-white p-3">
                        <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={slot.day} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, day: e.target.value as TherapistAvailabilitySlot['day'] } : item) } })}>
                          <option value="saturday">السبت</option>
                          <option value="sunday">الأحد</option>
                          <option value="monday">الاثنين</option>
                          <option value="tuesday">الثلاثاء</option>
                          <option value="wednesday">الأربعاء</option>
                          <option value="thursday">الخميس</option>
                          <option value="friday">الجمعة</option>
                        </select>
                        <input type="time" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={slot.startTime} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: e.target.value } : item) } })} />
                        <input type="time" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={slot.endTime} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, endTime: e.target.value } : item) } })} />
                        <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="وصف الموعد" value={slot.label || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, label: e.target.value } : item) } })} />
                        <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="رابط مباشر اختياري للجلسة" value={slot.meetingLink || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, meetingLink: e.target.value } : item) } })} />
                        <div className="flex gap-2 items-center">
                          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                            <input type="checkbox" checked={slot.isActive} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, isActive: e.target.checked } : item) } })} />
                            متاح
                          </label>
                          <button type="button" onClick={() => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.filter((_, itemIndex) => itemIndex !== index) } })} className="px-2 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-bold">
                            حذف
                          </button>
                        </div>
                      </div>
                    ))}
                    {therapistDraft.consultationSettings.availableSlots.length === 0 && <p className="text-sm text-gray-500">لم تتم إضافة أي مواعيد بعد.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button onClick={() => void saveTherapist()} className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-xl transition">{editingTherapistId ? 'تحديث المحاضر' : 'إضافة محاضر'}</button>
        </div>
      )}
      <div className="mt-5 border-t pt-4 grid grid-cols-1 xl:grid-cols-2 gap-3 max-h-[620px] overflow-auto">
        {[...therapists].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)).map((row) => (
          <div key={row.id} className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={safeTherapistImageSrc(row.image, row.name)}
                  alt={row.name}
                  onError={(event) => { event.currentTarget.src = therapistAvatarDataUrl(row.name); }}
                  className="w-14 h-14 rounded-2xl object-cover border border-gray-200 bg-white"
                />
                <div className="min-w-0">
                  <p className="font-bold text-gray-800 truncate">{row.name}</p>
                  <p className="text-xs text-gray-500 truncate">{row.title || row.specialty}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-500">ترتيب: {row.sortOrder ?? 99}</span>
                    {row.showOnHome && <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-700">الرئيسية</span>}
                    {row.showOnAbout && <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">عن المعهد</span>}
                    <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${row.consultationSettings?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                      {row.consultationSettings?.enabled ? 'يستقبل جلسات' : 'تدريب فقط'}
                    </span>
                    {row.consultationSettings?.enabled && (
                      <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700">
                        {meetingProviderLabels[row.consultationSettings.meetingProvider]}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  onClick={() => void updateTherapist({ ...row, showOnHome: !row.showOnHome })}
                  title="تبديل الظهور في الصفحة الرئيسية"
                  className={`px-2 py-1.5 rounded-lg text-xs font-bold transition ${row.showOnHome ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
                >🏠</button>
                <button
                  onClick={() => void updateTherapist({ ...row, showOnAbout: !row.showOnAbout })}
                  title="تبديل الظهور في فريق العمل"
                  className={`px-2 py-1.5 rounded-lg text-xs font-bold transition ${row.showOnAbout ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-gray-100 text-gray-400 hover:bg-amber-50 hover:text-amber-600'}`}
                >ℹ️</button>
                <button onClick={() => startEditTherapist(row)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm">تعديل</button>
                <button onClick={() => void deleteTherapist(row.id)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">حذف</button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4 text-sm">
              <div className="border border-gray-200 rounded-xl p-3 bg-white">
                <p className="text-xs text-gray-500">الخبرة</p>
                <p className="font-bold text-gray-900">{row.experience} سنة</p>
              </div>
              <div className="border border-gray-200 rounded-xl p-3 bg-white">
                <p className="text-xs text-gray-500">التقييم</p>
                <p className="font-bold text-gray-900">{row.rating}</p>
              </div>
              <div className="border border-gray-200 rounded-xl p-3 bg-white">
                <p className="text-xs text-gray-500">سعر الاستشارة</p>
                <p className="font-bold text-gray-900">{row.consultationSettings?.enabled ? row.consultationSettings.sessionPrice.EGP : row.price.EGP} ج.م</p>
              </div>
              <div className="border border-gray-200 rounded-xl p-3 bg-white">
                <p className="text-xs text-gray-500">جلسات مرتبطة</p>
                <p className="font-bold text-gray-900">{consultations.filter((item) => item.therapistId === row.id || item.therapistName === row.name).length}</p>
              </div>
            </div>

            {row.consultationSettings?.enabled && (
              <div className="mt-4 border border-gray-200 rounded-xl bg-white p-3 space-y-2">
                <p className="text-xs text-gray-500">بوابة المحاضر</p>
                <p className="text-sm font-bold text-gray-800">{staffMembers.find(member => member.id === row.staffId)?.name || 'لا يوجد موظف مرتبط'}</p>
                <p className="text-xs text-gray-500">المواعيد المتاحة: {(row.consultationSettings.availableSlots || []).filter((slot) => slot.isActive).length}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  )}
    </>
  );
}
