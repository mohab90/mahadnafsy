import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Star, Trash2, X, ExternalLink } from 'lucide-react';
import type { Course, SubscriberItem } from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  notify: NotifyFn;
  courses: Course[];
  subscribers: SubscriberItem[];
  updateSubscriber: (s: SubscriberItem) => void;
}

export default function CertRequestsTab({
  notify, courses, subscribers, updateSubscriber,
}: Props) {
              const navigate = useNavigate();
              // Filters — tab-local (lifted out of the Dashboard god-hub).
              const [certSearch, setCertSearch] = useState('');
              const [certTypeFilter, setCertTypeFilter] = useState('all');
              const [certStatusFilter, setCertStatusFilter] = useState('all');
              // Gather all extra certificate requests from all subscribers
              type CertReqRow = import('../../../types').ExtraCertificateRequest & { subscriberName: string; subscriberPhone: string; subscriberEmail: string; subscriberId: string; subscriberCode?: string };
              const allRequests: CertReqRow[] = [];
              subscribers.forEach(sub => {
                (sub.extraCertificateRequests || []).forEach(req => {
                  allRequests.push({ ...req, subscriberName: sub.name, subscriberPhone: sub.phone, subscriberEmail: sub.email, subscriberId: sub.id, subscriberCode: sub.clientCode });
                });
              });
              allRequests.sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));

              const CERT_TYPE_LABELS: Record<string, string> = {
                social_solidarity: 'شهادة التضامن الاجتماعي',
                ain_shams: 'شهادة جامعة عين شمس',
                experience_external: 'شهادة الخبرة',
                practice_external: 'شهادة التطبيقين',
                national_council: 'شهادة المجلس الوطني',
                american_board: 'شهادة البورد الأمريكي',
                institute: 'شهادة المعهد',
                other: 'شهادة أخرى',
              };

              type CertStatus = import('../../../types').ExtraCertificateRequest['status'];

              const STATUS_META: Record<CertStatus, { label: string; badge: string }> = {
                pending:     { label: 'تحت المراجعة',          badge: 'bg-gray-100 text-gray-600' },
                priced:      { label: 'مسعّرة',                badge: 'bg-amber-100 text-amber-700' },
                paid:        { label: 'مدفوعة',                badge: 'bg-blue-100 text-blue-700' },
                in_progress: { label: 'في الجهة المسئولة',     badge: 'bg-purple-100 text-purple-700' },
                not_sent:    { label: 'لسه متتبعتش للجهة',     badge: 'bg-orange-100 text-orange-700' },
                issued:      { label: 'جاهزة للشحن',           badge: 'bg-green-100 text-green-700' },
                shipped:     { label: 'اتشحنت',                badge: 'bg-cyan-100 text-cyan-700' },
                at_branch:   { label: 'في الفرع',              badge: 'bg-teal-100 text-teal-700' },
                delivered:   { label: 'العميل استلمها',        badge: 'bg-emerald-100 text-emerald-800' },
              };

              const statusBadge = (s: string) => {
                const m = STATUS_META[s as CertStatus];
                if (!m) return <span className="text-[11px] bg-gray-100 text-gray-500 font-bold px-2 py-0.5 rounded-full">{s}</span>;
                return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${m.badge}`}>{m.label}</span>;
              };

              const changeStatus = (req: CertReqRow, newStatus: CertStatus) => {
                const sub = subscribers.find(s => s.id === req.subscriberId);
                if (!sub) return;
                const updated = (sub.extraCertificateRequests || []).map(r => r.id === req.id ? { ...r, status: newStatus } : r);
                updateSubscriber({ ...sub, extraCertificateRequests: updated });
                notify('success', `تم تحديث الحالة: ${STATUS_META[newStatus]?.label || newStatus}`);
              };

              const deleteCertReq = (req: CertReqRow) => {
                if (!window.confirm(`حذف طلب الشهادة لـ "${req.subscriberName}"؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;
                const sub = subscribers.find(s => s.id === req.subscriberId);
                if (!sub) return;
                const updated = (sub.extraCertificateRequests || []).filter(r => r.id !== req.id);
                updateSubscriber({ ...sub, extraCertificateRequests: updated });
                notify('success', 'تم حذف الطلب.');
              };

              // ── Apply filters ────────────────────────────────────────────────────────────
              const filtered = allRequests.filter(req => {
                const q = certSearch.trim().toLowerCase();
                if (q) {
                  const haystack = `${req.subscriberName} ${req.subscriberPhone} ${req.nameAr || ''} ${req.nameEn || ''}`.toLowerCase();
                  if (!haystack.includes(q)) return false;
                }
                if (certTypeFilter !== 'all' && req.type !== certTypeFilter) return false;
                if (certStatusFilter !== 'all' && req.status !== certStatusFilter) return false;
                return true;
              });

              // ── Count chips ──────────────────────────────────────────────────────────────
              const counts = (Object.keys(STATUS_META) as CertStatus[]).map(s => ({
                key: s,
                label: STATUS_META[s].label,
                color: STATUS_META[s].badge,
                val: allRequests.filter(r => r.status === s).length,
              }));

              const natLabel: Record<string, string> = {
                egyptian: '🇪🇬 مصري',
                non_egyptian_egypt: '👤 مقيم بمصر',
                saudi_resident: '🇸🇦 مقيم بالسعودية',
                international: '✈️ دولي',
              };

              return (
                <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
                  {/* Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2">
                      <Star size={18} className="text-amber-500" /> طلبات الشهادات الإضافية
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">{filtered.length} / {allRequests.length} طلب</span>
                    </div>
                  </div>

                  {/* Status count chips */}
                  <div className="flex flex-wrap gap-2">
                    {counts.map(c => (
                      <button
                        key={c.key}
                        onClick={() => setCertStatusFilter(certStatusFilter === c.key ? 'all' : c.key)}
                        className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${certStatusFilter === c.key ? 'ring-2 ring-offset-1 ring-primary-400' : ''} ${c.color}`}
                      >
                        {c.label}: {c.val}
                      </button>
                    ))}
                    {certStatusFilter !== 'all' && (
                      <button onClick={() => setCertStatusFilter('all')} className="text-xs font-bold px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 flex items-center gap-1">
                        <X size={11} /> إلغاء الفلتر
                      </button>
                    )}
                  </div>

                  {/* Search + filters row */}
                  <div className="flex flex-wrap gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        value={certSearch}
                        onChange={e => setCertSearch(e.target.value)}
                        placeholder="ابحث بالاسم أو الهاتف..."
                        className="w-full border border-gray-300 rounded-xl pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                      />
                    </div>
                    <select
                      value={certTypeFilter}
                      onChange={e => setCertTypeFilter(e.target.value)}
                      className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                    >
                      <option value="all">كل أنواع الشهادات</option>
                      {Object.entries(CERT_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <select
                      value={certStatusFilter}
                      onChange={e => setCertStatusFilter(e.target.value)}
                      className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                    >
                      <option value="all">كل الحالات</option>
                      {(Object.entries(STATUS_META) as [CertStatus, { label: string }][]).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  </div>

                  {filtered.length === 0 ? (
                    <div className="py-16 text-center text-gray-400">
                      <Star size={36} className="mx-auto mb-3 text-gray-200" />
                      <p>{allRequests.length === 0 ? 'لا توجد طلبات شهادات بعد' : 'لا توجد نتائج مطابقة للفلتر'}</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border border-gray-200">
                            <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs">العميل</th>
                            <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs">نوع الشهادة</th>
                            <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs">الكورس</th>
                            <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs">الاسم على الشهادة</th>
                            <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs">الجنسية</th>
                            <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs">السعر / المتبقي</th>
                            <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs">الحالة</th>
                            <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs">تاريخ الطلب</th>
                            <th className="text-right px-3 py-2.5 border border-gray-200 font-semibold text-xs w-44">إجراءات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(req => {
                            const course = req.courseId ? courses.find(c => c.id === req.courseId) : undefined;
                            const remaining = req.price != null ? req.price - (req.paidAmount ?? 0) : null;
                            return (
                              <tr key={req.id} className="hover:bg-gray-50 border border-gray-100">
                                {/* Client */}
                                <td className="px-3 py-2 border border-gray-100">
                                  {req.subscriberCode ? (
                                    <button onClick={() => navigate(`/client/${req.subscriberCode}`)}
                                      title="فتح ملف العميل"
                                      className="font-bold text-gray-900 hover:text-primary-600 text-xs flex items-center gap-1 transition">
                                      {req.subscriberName} <ExternalLink size={11} className="text-gray-300" />
                                    </button>
                                  ) : (
                                    <div className="font-bold text-gray-900 text-xs">{req.subscriberName}</div>
                                  )}
                                  <div className="text-[11px] text-gray-400">{req.subscriberPhone}</div>
                                </td>
                                {/* Cert type */}
                                <td className="px-3 py-2 border border-gray-100 text-xs font-medium">
                                  {req.customName || CERT_TYPE_LABELS[req.type] || req.type}
                                </td>
                                {/* Course */}
                                <td className="px-3 py-2 border border-gray-100 text-xs text-gray-600">
                                  {course ? course.title : (req.courseId ? <span className="text-gray-400 text-[11px]">{req.courseId}</span> : <span className="text-gray-300">—</span>)}
                                </td>
                                {/* Name on cert */}
                                <td className="px-3 py-2 border border-gray-100 text-xs">
                                  {!req.nameAr && !req.nameEn ? (
                                    <span className="text-[11px] bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">⚠️ اسم فارغ</span>
                                  ) : (
                                    <>
                                      <div>{req.nameAr || '—'}</div>
                                      <div className="text-gray-400" dir="ltr">{req.nameEn || ''}</div>
                                    </>
                                  )}
                                </td>
                                {/* Nationality */}
                                <td className="px-3 py-2 border border-gray-100 text-xs">{natLabel[req.nationality || ''] || req.nationality || '—'}</td>
                                {/* Price / remaining */}
                                <td className="px-3 py-2 border border-gray-100 text-xs">
                                  {req.price != null ? (
                                    <div>
                                      <span className="font-bold text-primary-700">{req.price} {req.currency || 'EGP'}</span>
                                      {remaining != null && remaining > 0 && (
                                        <div className="text-[11px] text-red-600 font-bold mt-0.5">متبقي: {remaining} {req.currency || 'EGP'}</div>
                                      )}
                                      {remaining != null && remaining <= 0 && (
                                        <div className="text-[11px] text-green-600 font-bold mt-0.5">مكتمل الدفع ✓</div>
                                      )}
                                    </div>
                                  ) : '—'}
                                </td>
                                {/* Status */}
                                <td className="px-3 py-2 border border-gray-100">
                                  <select
                                    value={req.status}
                                    onChange={e => changeStatus(req, e.target.value as CertStatus)}
                                    className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white"
                                  >
                                    {(Object.entries(STATUS_META) as [CertStatus, { label: string }][]).map(([k, v]) => (
                                      <option key={k} value={k}>{v.label}</option>
                                    ))}
                                  </select>
                                  <div className="mt-1">{statusBadge(req.status)}</div>
                                </td>
                                {/* Date */}
                                <td className="px-3 py-2 border border-gray-100 text-xs text-gray-400">{req.requestedAt || '—'}</td>
                                {/* Actions */}
                                <td className="px-3 py-2 border border-gray-100">
                                  <div className="flex flex-wrap gap-1 items-center">
                                    <button
                                      onClick={() => deleteCertReq(req)}
                                      title="حذف الطلب"
                                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </article>
              );

}