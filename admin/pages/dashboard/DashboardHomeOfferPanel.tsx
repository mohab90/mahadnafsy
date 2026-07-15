import React, { type Dispatch, type SetStateAction } from 'react';
import type { Course } from '../../types';
import type { ContentField } from './contentFields';

type ContentMap = Record<string, string>;
type NotifyFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

type DashboardHomeOfferPanelProps = {
  fields: ContentField[];
  content: ContentMap;
  policyDrafts: ContentMap;
  setPolicyDrafts: Dispatch<SetStateAction<ContentMap>>;
  setContentValue: (key: string, value: string) => void;
  notify: NotifyFn;
  courses: Course[];
  offerSelectedCourseId: string;
  setOfferSelectedCourseId: Dispatch<SetStateAction<string>>;
};

export function DashboardHomeOfferPanel({
  fields,
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValue,
  notify,
  courses,
  offerSelectedCourseId,
  setOfferSelectedCourseId,
}: DashboardHomeOfferPanelProps) {
  const saveFields = () => {
    fields.forEach((field) => {
      const value = policyDrafts[field.key] ?? content[field.key] ?? '';
      setContentValue(field.key, value);
    });
    notify('success', 'تم حفظ إعدادات الصفحة الرئيسية بنجاح.');
  };

  const applySelectedCourse = () => {
    const selected = courses.find((course) => course.id === offerSelectedCourseId);
    if (!selected) {
      notify('error', 'يرجى اختيار كورس أولاً.');
      return;
    }

    setContentValue('offer.courseId', selected.id);
    setContentValue('home.offer.title', selected.title);
    setContentValue(
      'home.offer.description',
      (selected.shortDescription || selected.description?.slice(0, 200) || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim()
    );

    const egpPrice = selected.price?.EGP ?? 0;
    const egpOriginal = selected.originalPrice?.EGP ?? 0;
    setContentValue('home.offer.newPrice', egpPrice > 0 ? `${egpPrice} ج.م` : '');
    setContentValue('home.offer.oldPrice', egpOriginal > 0 ? `${egpOriginal} ج.م` : '');
    if (egpOriginal > 0 && egpPrice > 0) {
      const pct = Math.round(((egpOriginal - egpPrice) / egpOriginal) * 100);
      setContentValue('home.offer.discount', `خصم ${pct}%`);
    }
    setContentValue('home.offer.registerFor', `${selected.title} (عرض 24 ساعة)`);
    notify('success', `تم تطبيق كورس "${selected.title}" على قسم العرض بنجاح.`);
  };

  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-900">إدارة الصفحة الرئيسية</h3>
        <div className="flex gap-2">
          <button onClick={() => setPolicyDrafts({})} className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm">إعادة تحميل</button>
          <button onClick={saveFields} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold">
            حفظ التعديلات
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-bold text-amber-900 flex items-center gap-2">
            <span className="bg-amber-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">?</span>
            كورس العرض المميز (24 ساعة)
          </h4>
          <button
            type="button"
            onClick={() => {
              setContentValue('offer.timerStartedAt', new Date().toISOString());
              notify('success', 'تم إعادة ضبط مؤقت الـ24 ساعة.');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors"
          >
            إعادة ضبط المؤقت
          </button>
        </div>
        <p className="text-xs text-amber-700">اختر الكورس الذي تريد تمييزه في قسم العرض على الصفحة الرئيسية.</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-bold text-amber-800 mb-1">اختر كورس العرض</label>
            <select
              value={offerSelectedCourseId}
              onChange={(event) => setOfferSelectedCourseId(event.target.value)}
              className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-amber-400 outline-none"
            >
              <option value="">— اختر كورساً —</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>{course.title}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={applySelectedCourse}
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors whitespace-nowrap"
          >
            تطبيق على العرض
          </button>
        </div>
        {content['offer.courseId'] && (
          <p className="text-xs text-amber-700 bg-amber-100 rounded-lg px-3 py-2">
            الكورس الحالي في العرض: <strong>{courses.find((course) => course.id === content['offer.courseId'])?.title || content['offer.courseId']}</strong>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map((field) => {
          const value = policyDrafts[field.key] ?? content[field.key] ?? '';
          return (
            <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
              <label className="block text-xs font-bold text-gray-600 mb-1">{field.label} • {field.key}</label>
              {field.multiline ? (
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-24"
                  value={value}
                  onChange={(event) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))}
                />
              ) : (
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={value}
                  onChange={(event) => setPolicyDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))}
                />
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}
