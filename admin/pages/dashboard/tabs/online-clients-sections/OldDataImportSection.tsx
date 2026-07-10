import React from 'react';
import type { Course, PaymentHistoryEntry, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import OldDataImportPanel from '../online/OldDataImportPanel';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type ViewTabKey = 'active'|'real-local'|'real-intl'|'finished'|'paused'|'refunded'|'old_data'|'old_local'|'old_intl';

interface Props {
  collOnlineViewTab: ViewTabKey;
  isDaqqiClientsTab: boolean;
  courses: Course[];
  notify: NotifyFn;
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
}

export function OldDataImportSection({ collOnlineViewTab, isDaqqiClientsTab, courses, notify, setSalesOwnSubscribers }: Props) {
  if (collOnlineViewTab === 'old_data' && isDaqqiClientsTab) {
    return (
      /* داتا قديمة — استيراد عملاء الدقي القدامى */
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <span className="text-base">📂</span>
          <h3 className="font-extrabold text-gray-800 text-base">داتا قديمة — استيراد عملاء دقي</h3>
        </div>
          <OldDataImportPanel
            defaultSource="داتا قديمة دقي"
            accent="indigo"
            showAttendanceCol
            importRow={async (row, source) => {
              const matchedCourse = row._course ? courses.find(c => (c.titleAr||c.title||'').includes(row._course) || row._course.includes(c.titleAr||c.title||'')) : null;
              const enrolledCourseIds = matchedCourse ? [matchedCourse.id] : [];
              const extraNotes = [row._notes, row._cert ? `شهادة: ${row._cert}` : '', row._attendance ? `حضور: ${row._attendance}` : ''].filter(Boolean).join(' | ');
              await mysqlAdmin.saveSubscriber({ name: row._name, phone: row._phone, email: row._email || '', branch: 'DAQQI', status: 'active', notes: extraNotes, enrolledCourseIds, source } as any);
            }}
            onImported={async (created) => {
              if (created > 0) {
                notify('success', `✅ تم استيراد ${created} عميل`);
                try { const fresh = (await mysqlAdmin.listMyDaqqiClients()) as unknown as SubscriberItem[]; setSalesOwnSubscribers(prev => { const ids = new Set(prev.map(s=>s.id)); return [...prev, ...fresh.filter(s=>!ids.has(s.id))]; }); } catch {}
              }
            }}
          />
      </div>
    );
  }

  return (
    <>
      {/* ── استيراد بيانات قديمة للأونلاين (old_local / old_intl) ── */}
      {(collOnlineViewTab === 'old_local' || collOnlineViewTab === 'old_intl') && !isDaqqiClientsTab && (
        <details className="mb-4 group">
          <summary className="cursor-pointer flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-100 transition select-none list-none">
            <span>⬆️</span>
            <span>استيراد بيانات {collOnlineViewTab === 'old_local' ? 'محلي قديم' : 'دولي قديم'}</span>
            <span className="text-xs font-normal text-violet-500 mr-auto group-open:hidden">انقر للفتح</span>
            <span className="text-xs font-normal text-violet-500 mr-auto hidden group-open:inline">▲ إخفاء</span>
          </summary>
            <OldDataImportPanel
              defaultSource="داتا قديمة أونلاين"
              accent="violet"
              importRow={async (row, source) => {
                const subBranch = collOnlineViewTab === 'old_local' ? 'ONLINE_EGYPT' : 'ONLINE_ABROAD';
                const subCurrency = collOnlineViewTab === 'old_local' ? 'EGP' : 'USD';
                const matchedCourse = row._course ? courses.find(c => (c.titleAr||c.title||'').includes(row._course) || row._course.includes(c.titleAr||c.title||'')) : null;
                const enrolledCourseIds = matchedCourse ? [matchedCourse.id] : [];
                const paid = Number(row._paid) || 0;
                const expected = Number(row._expected) || 0;
                const extraNotes = [row._notes, row._cert ? `شهادة: ${row._cert}` : '', row._attendance ? `حضور: ${row._attendance}` : ''].filter(Boolean).join(' | ');
                const payHistory: PaymentHistoryEntry[] = [];
                if (paid > 0 && matchedCourse) {
                  payHistory.push({ id:`csv-pay-${Date.now()}-${Math.random()}`, amount:paid, currency:subCurrency as 'EGP'|'USD', paymentType:'course', isInstallment:false, courseId:matchedCourse.id, courseExpected:expected||undefined, at:new Date().toISOString().slice(0,10) });
                }
                await mysqlAdmin.saveSubscriber({ name: row._name, phone: row._phone, email: row._email || '', branch: subBranch, status: 'active', clientStatus: collOnlineViewTab, notes: extraNotes, enrolledCourseIds, source, paymentHistory: payHistory } as any);
              }}
              onImported={async (created) => {
                if (created > 0) {
                  notify('success', `✅ تم استيراد ${created} عميل`);
                  try { const fresh = await mysqlAdmin.listStaffSubscribers() as unknown as SubscriberItem[]; setSalesOwnSubscribers(prev => { const ids = new Set(prev.map(s=>s.id)); return [...prev, ...fresh.filter(s=>!ids.has(s.id))]; }); } catch {}
                }
              }}
            />
        </details>
      )}
    </>
  );
}
