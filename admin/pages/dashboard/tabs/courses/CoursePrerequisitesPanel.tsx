import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { Course } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

interface Rule {
  prerequisiteCourseId: string;
  requirementType: 'completion' | 'entitlement';
}

interface Props {
  courseId?: string;
  subjectId?: string;
  subjectType?: 'course' | 'bundle' | 'cohort';
  courses: Course[];
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
  compact?: boolean;
}

export function CoursePrerequisitesPanel({
  courseId, subjectId = courseId || '', subjectType = 'course', courses, notify, compact = false,
}: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    mysqlAdmin.adminGet<{ rules: Array<Rule & { subjectType: string; subjectId: string }> }>('/admin/lms/prerequisites')
      .then(result => {
        if (active) setRules(result.rules.filter(rule => rule.subjectType === subjectType && rule.subjectId === subjectId));
      })
      .catch(() => { if (active) setRules([]); });
    return () => { active = false; };
  }, [subjectId, subjectType]);

  const toggle = (prerequisiteCourseId: string) => setRules(current =>
    current.some(rule => rule.prerequisiteCourseId === prerequisiteCourseId)
      ? current.filter(rule => rule.prerequisiteCourseId !== prerequisiteCourseId)
      : [...current, { prerequisiteCourseId, requirementType: 'completion' }]
  );

  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPut('/admin/lms/prerequisites', { subjectType, subjectId, rules });
      notify('success', 'تم حفظ متطلبات الالتحاق.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ متطلبات الكورس.');
    } finally {
      setSaving(false);
    }
  };

  const candidates = courses.filter(course => subjectType !== 'course' || course.id !== subjectId);
  return (
    <div className={`border border-indigo-200 bg-indigo-50 rounded-2xl p-4 ${compact ? 'my-3' : 'mb-4'}`} dir="rtl">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="font-bold text-indigo-900 text-sm">متطلبات الالتحاق</p>
          <p className="text-xs text-indigo-600 mt-1">يمنع النظام منح الكورس قبل تحقق الشروط المختارة.</p>
        </div>
        <button type="button" onClick={() => void save()} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold disabled:opacity-50">
          <Save size={13} /> {saving ? 'جاري الحفظ...' : 'حفظ المتطلبات'}
        </button>
      </div>
      {candidates.length === 0 ? <p className="text-xs text-indigo-500">لا توجد كورسات أخرى لاختيارها.</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {candidates.map(course => {
            const rule = rules.find(item => item.prerequisiteCourseId === course.id);
            return (
              <div key={course.id} className="flex items-center gap-2 bg-white border border-indigo-100 rounded-xl px-3 py-2">
                <input type="checkbox" checked={!!rule} onChange={() => toggle(course.id)} />
                <span className="text-xs font-medium text-gray-800 flex-1">{course.title}</span>
                {rule && (
                  <select
                    value={rule.requirementType}
                    onChange={event => setRules(current => current.map(item => item.prerequisiteCourseId === course.id
                      ? { ...item, requirementType: event.target.value as Rule['requirementType'] } : item))}
                    className="border border-indigo-200 rounded-lg px-2 py-1 text-xs"
                  >
                    <option value="completion">إتمام الكورس</option>
                    <option value="entitlement">اشتراك فعّال</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
