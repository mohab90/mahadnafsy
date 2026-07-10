import React, { useState, useEffect } from 'react';
import { Award, Star, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { mysqlClient } from '../../lib/mysqlapi';
import type { ExtraCertificateType, ExtraCertificateRequest, CourseLectureItem } from '../../types';

interface CertificatesTabProps {
  subscriber: any;
  enrolledCourses: any[];
  getCourseLectures: (id: string) => CourseLectureItem[];
  setPlayerCourseId: (id: string) => void;
  setCertModal: (data: { courseId: string }) => void;
  content: any;
  refreshMySubscriber: () => void;
}

export const CertificatesTab: React.FC<CertificatesTabProps> = ({
  subscriber,
  enrolledCourses,
  getCourseLectures,
  setPlayerCourseId,
  setCertModal,
  content,
  refreshMySubscriber,
}) => {
  const navigate = useNavigate();

  const [extraCertType, setExtraCertType] = useState<ExtraCertificateType | ''>('');
  const [extraCertCourseId, setExtraCertCourseId] = useState('');
  const [extraCertNote, setExtraCertNote] = useState('');
  const [extraCertCustomName, setExtraCertCustomName] = useState('');
  const [extraCertConfirm, setExtraConfirm] = useState(false);
  const [extraCertNameAr, setExtraCertNameAr] = useState('');
  const [extraCertNameEn, setExtraCertNameEn] = useState('');
  const [extraCertNationality, setExtraCertNationality] = useState<'egyptian' | 'non_egyptian_egypt' | 'saudi_resident' | 'international'>('egyptian');
  const [extraCertIdNumber, setExtraCertIdNumber] = useState('');

  // Pre-fill name fields
  useEffect(() => {
    if (subscriber?.name && !extraCertNameAr) setExtraCertNameAr(subscriber.name);
    if (subscriber?.nameEn && !extraCertNameEn) setExtraCertNameEn(subscriber.nameEn);
  }, [subscriber, extraCertNameAr, extraCertNameEn]);

  const EXTRA_TYPES: { key: ExtraCertificateType; label: string; icon: string; desc: string }[] = [
    { key: 'social_solidarity', label: 'شهادة التضامن الاجتماعي', icon: '🦅', desc: 'بختم النسر الرسمي — وزارة التضامن الاجتماعي' },
    { key: 'ain_shams', label: 'شهادة جامعة عين شمس', icon: '🎓', desc: 'معتمدة من جامعة عين شمس' },
    { key: 'experience_external', label: 'شهادة الخبرة', icon: '📜', desc: 'بتوثيق الخارجية المصرية' },
    { key: 'practice_external', label: 'شهادة التطبيقين', icon: '🏛', desc: 'بتوثيق الخارجية المصرية' },
    { key: 'national_council', label: 'شهادة المجلس الوطني', icon: '🏅', desc: 'للتدريب والتعليم' },
    { key: 'american_board', label: 'شهادة البورد الأمريكي', icon: '🇺🇸', desc: 'American Board of Psychology' },
    { key: 'institute', label: 'شهادة المعهد', icon: '🏆', desc: 'معهد الدراسات النفسية — معتمدة' },
    { key: 'other', label: 'شهادة أخرى', icon: '📋', desc: 'حدد نوع الشهادة في الملاحظات' },
  ];

  const extraRequests = subscriber?.extraCertificateRequests || [];

  type CertPricing = { egyptianEGP: number; residentEGP: number; residentSAR: number; foreignUSD: number };
  const certPricingMap: Record<string, CertPricing> = (() => {
    try { return JSON.parse(content['extra_cert_pricing'] || '{}'); } catch { return {}; }
  })();

  const getPriceAndCurrency = (): { price: number; currency: 'EGP' | 'SAR' | 'USD' } | null => {
    if (!extraCertType) return null;
    const row = certPricingMap[extraCertType];
    if (!row) return null;
    if (extraCertNationality === 'egyptian') {
      const p = row.egyptianEGP || 0;
      return p > 0 ? { price: p, currency: 'EGP' } : null;
    }
    if (extraCertNationality === 'non_egyptian_egypt') {
      const p = row.residentEGP || 0;
      return p > 0 ? { price: p, currency: 'EGP' } : null;
    }
    if (extraCertNationality === 'saudi_resident') {
      const p = row.residentSAR || 0;
      return p > 0 ? { price: p, currency: 'SAR' } : null;
    }
    if (extraCertNationality === 'international') {
      const p = row.foreignUSD || 0;
      return p > 0 ? { price: p, currency: 'USD' } : null;
    }
    return null;
  };
  const autoPrice = getPriceAndCurrency();

  const handleRequestExtraCert = () => {
    if (!extraCertType || !subscriber) return;
    const priceData = getPriceAndCurrency();
    const req: ExtraCertificateRequest = {
      id: `ecr-${Date.now()}`,
      type: extraCertType as ExtraCertificateType,
      courseId: extraCertCourseId || undefined,
      customName: extraCertType === 'other' ? extraCertCustomName : undefined,
      nameAr: extraCertNameAr || undefined,
      nameEn: extraCertNameEn || undefined,
      nationality: extraCertNationality,
      idNumber: extraCertIdNumber.trim() || undefined,
      status: priceData ? 'priced' : 'pending',
      price: priceData?.price,
      currency: priceData?.currency,
      requestedAt: new Date().toISOString().slice(0, 10),
      note: extraCertNote || undefined,
    };

    void mysqlClient.createCertificateRequest({
      type: req.type, courseId: req.courseId, customName: req.customName,
      nameAr: req.nameAr, nameEn: req.nameEn, nationality: req.nationality,
      idNumber: req.idNumber, price: req.price, currency: req.currency, note: req.note,
    } as unknown as Record<string, unknown>)
      .then(() => { refreshMySubscriber(); })
      .catch(() => {});

    setExtraCertType('');
    setExtraCertCourseId('');
    setExtraCertNote('');
    setExtraCertCustomName('');
    setExtraCertNameAr('');
    setExtraCertNameEn('');
    setExtraCertNationality('egyptian');
    setExtraCertIdNumber('');
    setExtraConfirm(false);

    if (priceData && priceData.price > 0) {
      const certLabel = EXTRA_TYPES.find(t => t.key === extraCertType)?.label || 'شهادة إضافية';
      sessionStorage.setItem('mahad-pending-order', JSON.stringify({
        orderId: req.id,
        type: 'certificate',
        itemId: req.id,
        itemTitle: certLabel,
        amount: priceData.price,
        currency: priceData.currency,
        paymentMethod: 'card',
        customerName: extraCertNameAr || subscriber.name,
        customerEmail: subscriber.email || '',
        customerPhone: subscriber.phone || '',
        extraCertRequestId: req.id,
        subscriberPhone: subscriber.phone,
      }));
      navigate(`/checkout?type=certificate&id=${req.id}&amount=${priceData.price}&currency=${priceData.currency}&title=${encodeURIComponent(certLabel)}`);
    }
  };

  const statusBadge = (s: string) => {
    if (s === 'issued') return <span className="text-[10px] bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full">✅ صدرت</span>;
    if (s === 'paid') return <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">💳 مدفوعة</span>;
    if (s === 'priced') return <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">💰 تم التسعير</span>;
    return <span className="text-[10px] bg-gray-100 text-gray-600 font-bold px-2 py-0.5 rounded-full">⏳ قيد المراجعة</span>;
  };

  return (
    <div className="space-y-8 max-w-3xl">
      {/* ── Course completion certificates ── */}
      <div>
        <h3 className="font-extrabold text-gray-800 text-base mb-4 flex items-center gap-2">
          <Award size={18} className="text-red-700" /> شهادات إتمام الكورسات
        </h3>
        {enrolledCourses.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
            <Award size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400">اشترك في كورس للحصول على شهاداتك</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {enrolledCourses.map(course => {
              const courseLectures = getCourseLectures(course.id);
              const total = courseLectures.length;
              const watched = total > 0
                ? Object.entries(subscriber?.lectureProgress || {})
                    .filter(([lid, pct]) => courseLectures.some(l => String(l.id) === lid) && (pct as number) >= 90).length
                : 0;
              const pct = total > 0 ? Math.round((watched / total) * 100) : 100;
              const isCompleted = total === 0 || pct === 100;

              return (
                <div key={course.id} className={`rounded-2xl p-5 border shadow-sm ${isCompleted ? 'bg-gradient-to-br from-red-900 to-red-800 border-red-700 text-white' : 'bg-white border-gray-100'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isCompleted ? 'bg-white/15' : 'bg-red-50'}`}>
                      <Award size={24} className={isCompleted ? 'text-yellow-300' : 'text-red-700'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] uppercase tracking-wider mb-0.5 ${isCompleted ? 'text-red-200' : 'text-gray-400'}`}>
                        شهادة إتمام
                      </p>
                      <h4 className={`font-bold text-sm leading-snug line-clamp-2 ${isCompleted ? 'text-white' : 'text-gray-800'}`}>
                        {course.title}
                      </h4>
                      {!isCompleted && (
                        <div className="mt-2">
                          <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>{watched}/{total} محاضرة مكتملة</span>
                            <span className="font-bold">{pct}%</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-red-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <button
                            onClick={() => setPlayerCourseId(course.id)}
                            className="mt-2 text-xs text-red-600 font-bold flex items-center gap-1 hover:text-red-800 transition"
                          >
                            <Play size={11} /> تابع التعلم لتحميل الشهادة
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {isCompleted && (
                    <button
                      onClick={() => setCertModal({ courseId: course.id })}
                      className="w-full mt-4 bg-white/15 hover:bg-white/25 text-white font-bold py-2.5 rounded-xl transition text-sm flex items-center justify-center gap-2 border border-white/20"
                    >
                      🏆 عرض وطباعة الشهادة
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Additional certificates ── */}
      <div>
        <h3 className="font-extrabold text-gray-800 text-base mb-1 flex items-center gap-2">
          <Star size={18} className="text-amber-500" /> الشهادات الإضافية المعتمدة
        </h3>
        <p className="text-xs text-gray-500 mb-4">اختر الشهادة الإضافية التي تحتاجها وسيتواصل معك فريق المعهد بالتفاصيل والتكلفة</p>

        {/* Existing requests */}
        {extraRequests.length > 0 && (
          <div className="space-y-3 mb-5">
            {extraRequests.map((req: any) => {
              const typeInfo = EXTRA_TYPES.find(t => t.key === req.type);
              return (
                <div key={req.id} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{typeInfo?.icon || '📋'}</span>
                    <div>
                      <p className="font-bold text-sm text-gray-800">{req.customName || typeInfo?.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">طُلبت في {req.requestedAt}</p>
                      {req.price && <p className="text-xs text-amber-600 font-bold mt-0.5">التكلفة: {req.price} {req.currency || 'EGP'}</p>}
                      {req.status === 'priced' && (
                        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          <p className="text-xs font-bold text-amber-800 mb-1">💳 لإتمام الدفع:</p>
                          <p className="text-xs text-amber-700">تواصل مع فريق المعهد عبر واتس أب أو الهاتف لسداد المبلغ وإرسال إيصال الدفع</p>
                        </div>
                      )}
                      {req.adminNote && <p className="text-xs text-blue-600 mt-0.5">ملاحظة: {req.adminNote}</p>}
                    </div>
                  </div>
                  {statusBadge(req.status)}
                </div>
              );
            })}
          </div>
        )}

        {/* Request form */}
        {!extraCertConfirm ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-4">
            <p className="font-bold text-amber-800 text-sm">طلب شهادة إضافية جديدة</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">نوع الشهادة *</label>
                <select value={extraCertType} onChange={e => setExtraCertType(e.target.value as ExtraCertificateType)}
                  className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400">
                  <option value="">— اختر نوع الشهادة —</option>
                  {EXTRA_TYPES.map(t => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">الجنسية / مكان الإقامة *</label>
                <select value={extraCertNationality} onChange={e => setExtraCertNationality(e.target.value as any)}
                  className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400">
                  <option value="egyptian">🇪🇬 مصري</option>
                  <option value="non_egyptian_egypt">👤 غير مصري مقيم في مصر</option>
                  <option value="saudi_resident">🇸🇦 مقيم في السعودية</option>
                  <option value="international">✈️ دولي — خارج مصر والسعودية</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">رقم الهوية / الإقامة *</label>
                <input value={extraCertIdNumber} onChange={e => setExtraCertIdNumber(e.target.value)}
                  placeholder={extraCertNationality === 'egyptian' ? 'رقم البطاقة الوطنية (14 رقم)' : 'رقم الإقامة أو الهوية'}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400" dir="ltr" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-gray-600 mb-1 block">الكورس المرتبط (اختياري)</label>
                <select value={extraCertCourseId} onChange={e => setExtraCertCourseId(e.target.value)}
                  className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400">
                  <option value="">— اختر الكورس —</option>
                  {enrolledCourses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">الاسم بالعربية *</label>
                <input value={extraCertNameAr} onChange={e => setExtraCertNameAr(e.target.value)}
                  placeholder="الاسم الرباعي بالعربية"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">الاسم بالإنجليزية *</label>
                <input value={extraCertNameEn} onChange={e => setExtraCertNameEn(e.target.value)}
                  placeholder="Full name in English"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400" dir="ltr" />
              </div>
              {extraCertType === 'other' && (
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-gray-600 mb-1 block">اسم الشهادة المطلوبة *</label>
                  <input value={extraCertCustomName} onChange={e => setExtraCertCustomName(e.target.value)}
                    placeholder="اكتب اسم الشهادة المطلوبة"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400" />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظات إضافية (اختياري)</label>
                <textarea value={extraCertNote} onChange={e => setExtraCertNote(e.target.value)} rows={2}
                  placeholder="أي تفاصيل إضافية..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 resize-none" />
              </div>
            </div>
            {autoPrice && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="text-green-600 text-xl">💰</span>
                <div>
                  <p className="text-xs text-green-700 font-bold">التكلفة المحسوبة تلقائياً</p>
                  <p className="text-lg font-extrabold text-green-800">{autoPrice.price} {autoPrice.currency === 'EGP' ? 'ج.م' : autoPrice.currency === 'SAR' ? 'ر.س' : '$'}</p>
                </div>
              </div>
            )}
            <button
              disabled={!extraCertType || !extraCertNameAr.trim() || !extraCertNameEn.trim() || !extraCertIdNumber.trim() || (extraCertType === 'other' && !extraCertCustomName)}
              onClick={() => setExtraConfirm(true)}
              className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-bold rounded-xl transition text-sm"
            >
              إرسال الطلب
            </button>
          </div>
        ) : (
          <div className="bg-white border border-amber-300 rounded-2xl p-5 space-y-3">
            <p className="font-bold text-gray-800">تأكيد الطلب</p>
            {autoPrice ? (
              <p className="text-sm text-gray-600">
                سيتم توجيهك لصفحة الدفع لسداد مبلغ <strong>{autoPrice.price} {autoPrice.currency === 'EGP' ? 'ج.م' : autoPrice.currency === 'SAR' ? 'ر.س' : '$'}</strong> لإصدار الشهادة.
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                سيتواصل معك فريق المعهد لإخبارك بتكلفة الشهادة وطريقة الدفع والمدة الزمنية اللازمة.
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { handleRequestExtraCert(); }}
                className="flex-1 py-2.5 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 active:scale-95 transition text-sm"
              >
                {autoPrice ? '💳 تأكيد والانتقال للدفع' : '✅ تأكيد الطلب'}
              </button>
              <button onClick={() => setExtraConfirm(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition text-sm">
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
