import React from 'react';
import { Edit2 } from 'lucide-react';

import type { BranchType, Bundle, Course, LeadItem, StaffMember, SubscriberItem } from '../../types';
import { branchLabels, statusLabels } from './constants';
import { UnifiedClientCredentialsSection } from './UnifiedClientCredentialsSection';

type StatusMessage = { type: 'success' | 'error'; text: string };

export type UnifiedClientSubscriberDraft = {
  name: string;
  email: string;
  phone: string;
  branch?: BranchType;
  expectedEGP: string;
  expectedSAR: string;
  expectedUSD: string;
  assignedSalesId: string;
  assignedSalesName: string;
  assignedCsId: string;
  assignedCsName: string;
  discount: string;
};

interface UnifiedClientEditTabProps {
  isSub: boolean;
  isAdmin: boolean;
  isOnlineManager: boolean;
  isSaving: boolean;
  lead?: LeadItem;
  subscriber?: SubscriberItem;
  clientEmail: string;
  subDraft: UnifiedClientSubscriberDraft;
  setSubDraft: React.Dispatch<React.SetStateAction<UnifiedClientSubscriberDraft>>;
  leadDraft: LeadItem;
  setLeadDraft: React.Dispatch<React.SetStateAction<LeadItem>>;
  salesStaffList: StaffMember[];
  csStaffList: StaffMember[];
  courses: Course[];
  bundles: Bundle[];
  onSaveSubscriber: () => void | Promise<void>;
  onSaveLead: () => void | Promise<void>;
  currentPassword: string | null;
  currentPasswordLoading: boolean;
  showCurrentPassword: boolean;
  setShowCurrentPassword: React.Dispatch<React.SetStateAction<boolean>>;
  showNewPassword: boolean;
  setShowNewPassword: React.Dispatch<React.SetStateAction<boolean>>;
  credNewPassword: string;
  setCredNewPassword: React.Dispatch<React.SetStateAction<string>>;
  credMsg: StatusMessage | null;
  setCredMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
  accountDiag: Record<string, unknown> | null;
  setAccountDiag: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  accountDiagLoading: boolean;
  setAccountDiagLoading: React.Dispatch<React.SetStateAction<boolean>>;
  createAccMsg: StatusMessage | null;
  setCreateAccMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
  createAccLoading: boolean;
  setCreateAccLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

export function UnifiedClientEditTab({
  isSub,
  isAdmin,
  isOnlineManager,
  isSaving,
  lead,
  subscriber,
  clientEmail,
  subDraft,
  setSubDraft,
  leadDraft,
  setLeadDraft,
  salesStaffList,
  csStaffList,
  courses,
  bundles,
  onSaveSubscriber,
  onSaveLead,
  currentPassword,
  currentPasswordLoading,
  showCurrentPassword,
  setShowCurrentPassword,
  showNewPassword,
  setShowNewPassword,
  credNewPassword,
  setCredNewPassword,
  credMsg,
  setCredMsg,
  accountDiag,
  setAccountDiag,
  accountDiagLoading,
  setAccountDiagLoading,
  createAccMsg,
  setCreateAccMsg,
  createAccLoading,
  setCreateAccLoading,
}: UnifiedClientEditTabProps) {
  return (
    <div id="section-edit" className="space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-5 rounded-full bg-gray-400 flex-shrink-0" />
        <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
          <Edit2 size={14} className="text-gray-500" /> تعديل بيانات العميل
        </h3>
      </div>

      {isSub ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="text-xs text-gray-600 mb-1 block">الاسم</label>
            <input value={subDraft.name} onChange={e => setSubDraft({ ...subDraft, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="text-xs text-gray-600 mb-1 block">الهاتف</label>
            <input value={subDraft.phone} onChange={e => setSubDraft({ ...subDraft, phone: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="text-xs text-gray-600 mb-1 block">البريد الإلكتروني</label>
            <input value={subDraft.email} onChange={e => setSubDraft({ ...subDraft, email: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <p className="text-[10px] text-amber-600 mt-0.5">تغيير الإيميل سيحدث بيانات الدخول أيضاً</p>
          </div>
          <div><label className="text-xs text-gray-600 mb-1 block">الفرع</label>
            <select value={subDraft.branch || ''} onChange={e => setSubDraft({ ...subDraft, branch: (e.target.value as BranchType) || undefined })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">- الفرع -</option>
              {Object.entries(branchLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">السيلز / المبيعات</label>
            <select value={subDraft.assignedSalesId} onChange={e => { const staff = salesStaffList.find(x => x.id === e.target.value); setSubDraft({ ...subDraft, assignedSalesId: e.target.value, assignedSalesName: staff?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">- بدون تحديد -</option>
              {salesStaffList.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">خدمة العملاء</label>
            <select value={subDraft.assignedCsId} onChange={e => { const staff = csStaffList.find(x => x.id === e.target.value); setSubDraft({ ...subDraft, assignedCsId: e.target.value, assignedCsName: staff?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">- بدون تحديد -</option>
              {csStaffList.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">الخصم (ج.م)</label>
            <input type="number" min="0" value={subDraft.discount} onChange={e => setSubDraft({ ...subDraft, discount: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div className="sm:col-span-2">
            <p className="text-xs font-bold text-gray-600 mb-2">المبالغ المتوقعة</p>
            <div className="grid grid-cols-3 gap-2">
              {([['expectedEGP', 'ج.م'], ['expectedSAR', 'ر.س'], ['expectedUSD', '$']] as const).map(([field, label]) => (
                <div key={field}><label className="text-[10px] text-gray-400 block mb-0.5">{label}</label>
                  <input type="number" min="0" value={subDraft[field]} onChange={e => setSubDraft({ ...subDraft, [field]: e.target.value })} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
              ))}
            </div>
          </div>
          <UnifiedClientCredentialsSection
            isAdmin={isAdmin}
            isOnlineManager={isOnlineManager}
            clientEmail={clientEmail}
            currentPassword={currentPassword}
            currentPasswordLoading={currentPasswordLoading}
            showCurrentPassword={showCurrentPassword}
            setShowCurrentPassword={setShowCurrentPassword}
            showNewPassword={showNewPassword}
            setShowNewPassword={setShowNewPassword}
            credNewPassword={credNewPassword}
            setCredNewPassword={setCredNewPassword}
            credMsg={credMsg}
            accountDiag={accountDiag}
            setAccountDiag={setAccountDiag}
            accountDiagLoading={accountDiagLoading}
            setAccountDiagLoading={setAccountDiagLoading}
            createAccMsg={createAccMsg}
            setCreateAccMsg={setCreateAccMsg}
            createAccLoading={createAccLoading}
            setCreateAccLoading={setCreateAccLoading}
            subscriber={subscriber}
            lead={lead}
          />
          <div className="sm:col-span-2 flex gap-2 pt-2">
            <button onClick={onSaveSubscriber} disabled={isSaving} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">{isSaving ? 'جاري الحفظ...' : 'حفظ التعديلات'}</button>
            <button onClick={() => { setCredMsg(null); setCredNewPassword(''); setShowCurrentPassword(false); setShowNewPassword(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex-1 py-2 bg-gray-200 rounded-lg text-sm">إلغاء</button>
          </div>
        </div>
      ) : lead ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([['name', 'الاسم', 'text'], ['email', 'البريد الإلكتروني', 'email'], ['phone', 'رقم الهاتف', 'tel'], ['source', 'المصدر', 'text']] as const).map(([field, label, type]) => (
            <div key={field}><label className="text-xs text-gray-600 mb-1 block">{label}</label>
              <input type={type} value={(leadDraft as unknown as Record<string, string>)[field] || ''} onChange={e => setLeadDraft({ ...leadDraft, [field]: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          ))}
          <div><label className="text-xs text-gray-600 mb-1 block">الفرع</label>
            <select value={leadDraft.branch || ''} onChange={e => setLeadDraft({ ...leadDraft, branch: e.target.value as BranchType })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">اختر الفرع</option>
              {Object.entries(branchLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">الحالة</label>
            <select value={leadDraft.status} onChange={e => setLeadDraft({ ...leadDraft, status: e.target.value as LeadItem['status'] })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {Object.entries(statusLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">درجة الاهتمام</label>
            <select value={leadDraft.interestLevel || ''} onChange={e => setLeadDraft({ ...leadDraft, interestLevel: e.target.value as LeadItem['interestLevel'] })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">اختر</option><option value="low">منخفض</option><option value="medium">متوسط</option><option value="high">مرتفع</option>
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">السيلز المسئول</label>
            <select value={leadDraft.assignedSalesId || ''} onChange={e => { const staff = salesStaffList.find(x => x.id === e.target.value); setLeadDraft({ ...leadDraft, assignedSalesId: e.target.value, assignedSalesName: staff?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">بدون تحديد</option>
              {salesStaffList.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">خدمة العملاء</label>
            <select value={leadDraft.assignedCsId || ''} onChange={e => { const staff = csStaffList.find(x => x.id === e.target.value); setLeadDraft({ ...leadDraft, assignedCsId: e.target.value, assignedCsName: staff?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">- بدون تحديد -</option>
              {csStaffList.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">الكورس</label>
            <select value={leadDraft.enrolledCourseId || ''} onChange={e => setLeadDraft({ ...leadDraft, enrolledCourseId: e.target.value || undefined })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">بدون تحديد</option>
              {(() => {
                const bundledIds = new Set(bundles.flatMap(bundle => bundle.courses.map(course => course.id)));
                return (
                  <>
                    {bundles.map(bundle => (
                      <optgroup key={bundle.id} label={bundle.title}>
                        {bundle.courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
                      </optgroup>
                    ))}
                    <optgroup label="الكورسات الفردية">
                      {courses.filter(course => !bundledIds.has(course.id)).map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
                    </optgroup>
                  </>
                );
              })()}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">موعد المتابعة</label>
            <input type="date" value={leadDraft.nextFollowUpDate || ''} onChange={e => setLeadDraft({ ...leadDraft, nextFollowUpDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div className="sm:col-span-2 flex gap-2 pt-2">
            <button onClick={onSaveLead} disabled={isSaving} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">حفظ التعديلات</button>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex-1 py-2 bg-gray-200 rounded-lg text-sm">إلغاء</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
