import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Loader,
  RefreshCw,
} from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type ApiHealth = { status: 'ok' | 'error'; message?: string; db?: string };

export default function MysqlStatusTab() {
  const {
    courses, bundles, therapists, testimonials, lectures, chapters,
    leads, subscribers, staffMembers, consultations, orders, expenses,
    discounts, notifications, courseQuizzes, quizAttempts, liveStreams,
    automationWorkflows, daqqiRounds, joinUsApplications, contactMessages,
    activityLogs,
  } = useSiteData();

  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [checking, setChecking] = useState(false);

  const checkHealth = async () => {
    setChecking(true);
    setHealth(null);
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setHealth({ status: 'ok', db: json.db ?? 'connected', message: json.message });
    } catch (e: unknown) {
      setHealth({ status: 'error', message: e instanceof Error ? e.message : 'تعذّر الاتصال' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { checkHealth(); }, []);

  const counts = [
    { label: 'الكورسات', n: courses.length },
    { label: 'الباقات', n: bundles.length },
    { label: 'المحاضرون', n: therapists.length },
    { label: 'آراء العملاء', n: testimonials.length },
    { label: 'المحاضرات', n: lectures.length },
    { label: 'الفصول', n: chapters.length },
    { label: 'العملاء المحتملون', n: leads.length },
    { label: 'المشتركون', n: subscribers.length },
    { label: 'الموظفون', n: staffMembers.length },
    { label: 'الاستشارات', n: consultations.length },
    { label: 'الطلبات', n: orders.length },
    { label: 'المصاريف', n: expenses.length },
    { label: 'الخصومات', n: discounts.length },
    { label: 'الإشعارات', n: notifications.length },
    { label: 'الاختبارات', n: courseQuizzes.length },
    { label: 'محاولات الاختبارات', n: quizAttempts.length },
    { label: 'البث المباشر', n: liveStreams.length },
    { label: 'الأتوميشن', n: automationWorkflows.length },
    { label: 'جدول الدقي', n: daqqiRounds.length },
    { label: 'طلبات الانضمام', n: joinUsApplications.length },
    { label: 'رسائل التواصل', n: contactMessages.length },
    { label: 'سجل النشاط', n: activityLogs.length },
  ];
  const totalRecords = counts.reduce((s, c) => s + c.n, 0);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-3 bg-indigo-100 rounded-xl">
          <Database size={24} className="text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">حالة قاعدة البيانات MySQL</h2>
          <p className="text-sm text-gray-500">مراقبة الاتصال وإحصاءات السجلات المحملة</p>
        </div>
      </div>

      {/* API Health card */}
      <div className={`flex items-center justify-between rounded-2xl border p-5 shadow-sm ${
        health === null
          ? 'bg-gray-50 border-gray-200'
          : health.status === 'ok'
            ? 'bg-green-50 border-green-200'
            : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-center gap-3">
          {health === null || checking ? (
            <Loader size={22} className="animate-spin text-gray-400" />
          ) : health.status === 'ok' ? (
            <CheckCircle2 size={22} className="text-green-600" />
          ) : (
            <AlertCircle size={22} className="text-red-500" />
          )}
          <div>
            <p className="font-semibold text-gray-800 text-sm">
              {checking
                ? 'جاري فحص الاتصال...'
                : health === null
                  ? 'فحص الاتصال...'
                  : health.status === 'ok'
                    ? `✅ API يعمل — MySQL: ${health.db ?? 'متصل'}`
                    : `❌ تعذّر الاتصال: ${health.message}`}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">mahadnafsy.com (Hostinger)</p>
          </div>
        </div>
        <button
          onClick={checkHealth}
          disabled={checking}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-all"
        >
          <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
          فحص
        </button>
      </div>

      {/* Counts grid */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-semibold text-gray-800 text-sm">إحصاءات السجلات المحملة من MySQL</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            إجمالي {totalRecords.toLocaleString('ar-EG')} سجل محمّل في الذاكرة
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-0 divide-x divide-y divide-gray-100 rtl:divide-x-reverse">
          {counts.map(({ label, n }) => (
            <div key={label} className="px-4 py-3 text-center">
              <div className="text-lg font-bold text-indigo-700">{n.toLocaleString('ar-EG')}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Info note */}
      <div className="flex gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <AlertCircle size={18} className="flex-shrink-0 mt-0.5 text-blue-400" />
        <div>
          <p className="font-semibold mb-1">ملاحظة</p>
          <p className="text-blue-700 text-xs">
            الأرقام المعروضة أعلاه تمثل البيانات المحملة حالياً من MySQL في ذاكرة التطبيق.
            للتحديث، اضغط على زر "تحديث" في أي قسم آخر من لوحة التحكم.
          </p>
        </div>
      </div>
    </div>
  );
}
