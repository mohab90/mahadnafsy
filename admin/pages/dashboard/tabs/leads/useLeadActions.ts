import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { PaymentDraft } from '../../../../components/PaymentModal';
import { currencyForBranch } from '../../../../lib/branchCurrency';
import { createClientPaymentDraft } from '../../../../lib/clientActionDrafts';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type {
  Bundle, Course, LeadItem, LeadStatus, NewLeadDraft, StaffMember, SubscriberItem,
} from '../../../../types';
import { STATUS_CFG } from '../leadUtils';
import { EMPTY_LEAD_DRAFT } from '../crmConstants';
import type { NotifyFn } from '../CrmSettingsModal';
import type { ConvertLeadModalState } from './ConvertLeadModal';
import { buildCsv } from './leadCsvUtils';
import type { TabKey } from '../../navigation';

type AsyncReload = () => Promise<void>;
type StatusTimer = ReturnType<typeof setTimeout>;

interface LeadActionsParams {
  notify: NotifyFn;
  updateLead: (lead: LeadItem) => Promise<boolean>;
  addLead: (lead: NewLeadDraft) => Promise<unknown>;
  reloadLeads: AsyncReload;
  reloadSubscribers: AsyncReload;
  bulkRedistributeLeads: (scope: 'unassigned') => Promise<number>;
  recordSubscriberPayment: (
    subscriberId: string,
    payment: Record<string, unknown>,
  ) => Promise<{ status: string; approvalRequired?: boolean }>;
  fetchSalesData?: () => void | Promise<void>;
  setActiveDashboardTab?: (tab: TabKey) => void;
  salesReps: StaffMember[];
  leads: LeadItem[];
  effectiveLeads: LeadItem[];
  effectiveSubs: SubscriberItem[];
  visibleLeads: LeadItem[];
  bundles: Bundle[];
  courses: Course[];
  branchLabelMap: Record<string, string>;
  currentStaff: StaffMember | null;
  isAdmin: boolean;
  isSalesOnly: boolean;
  statusDebounceRef: MutableRefObject<Map<string, StatusTimer>>;
  leadPayRow: LeadItem | null;
  setLeadPayRow: Dispatch<SetStateAction<LeadItem | null>>;
  setLeadPayDraft: Dispatch<SetStateAction<PaymentDraft>>;
  convertLeadModal: ConvertLeadModalState;
  setConvertLeadModal: Dispatch<SetStateAction<ConvertLeadModalState>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSyncingSheet: Dispatch<SetStateAction<boolean>>;
  setDistributing: Dispatch<SetStateAction<boolean>>;
  setMigratingBranches: Dispatch<SetStateAction<boolean>>;
}

const downloadLeadsCsv = (leads: LeadItem[]) => {
  const headers = ['الاسم', 'الهاتف', 'البريد', 'المصدر', 'الحالة', 'مستوى الاهتمام', 'المندوب', 'تاريخ الإنشاء'];
  const rows = leads.map(lead => [
    lead.name,
    lead.phone,
    lead.email || '',
    lead.source || '',
    lead.status,
    lead.interestLevel || '',
    lead.assignedSalesName || '',
    (lead.createdAt || '').slice(0, 10),
  ]);
  const url = URL.createObjectURL(new Blob(
    ['\uFEFF' + buildCsv([headers, ...rows])],
    { type: 'text/csv;charset=utf-8;' },
  ));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export function useLeadActions(params: LeadActionsParams) {
  const {
    notify, updateLead, addLead, reloadLeads, reloadSubscribers,
    bulkRedistributeLeads,
    recordSubscriberPayment, fetchSalesData, setActiveDashboardTab,
    salesReps, leads, effectiveLeads, effectiveSubs, visibleLeads, bundles,
    courses, branchLabelMap, currentStaff, isAdmin, isSalesOnly,
    statusDebounceRef, leadPayRow, setLeadPayRow, setLeadPayDraft,
    convertLeadModal, setConvertLeadModal, setSelectedId, setSyncingSheet,
    setDistributing, setMigratingBranches,
  } = params;

  const handleSave = async (updated: LeadItem) => {
    if (!await updateLead(updated)) return notify('error', 'تعذر حفظ بيانات العميل');
    setSelectedId(null);
    notify('success', 'تم حفظ بيانات العميل');
  };

  const handleSyncSheet = async () => {
    setSyncingSheet(true);
    try {
      const result = await mysqlAdmin.syncAllSheets();
      await reloadLeads();
      notify('success', `تمت المزامنة · ${result.imported} جديد، ${result.skipped} مكرر`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشلت المزامنة');
    } finally {
      setSyncingSheet(false);
    }
  };

  const handleDistribute = async () => {
    if (!salesReps.length) return notify('error', 'لا يوجد مندوبو مبيعات');
    setDistributing(true);
    try {
      const assigned = await bulkRedistributeLeads('unassigned');
      notify(
        assigned ? 'success' : 'info',
        assigned ? `تم توزيع ${assigned} عميل محتمل طبقًا لسياسة السيرفر` : 'كل العملاء النشطين لديهم مندوب صالح',
      );
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر توزيع العملاء');
    } finally {
      setDistributing(false);
    }
  };

  const handleMigrateBranches = async () => {
    const missing = leads.filter(lead => !lead.hidden && !lead.branch);
    if (!missing.length) return notify('info', 'جميع العملاء لديهم فرع مُعيَّن بالفعل');
    setMigratingBranches(true);
    try {
      const result = await mysqlAdmin.migrateLeadBranches();
      if (result.updated) await reloadLeads();
      notify(
        result.updated ? 'success' : 'info',
        result.updated
          ? `تم تحديث الفرع لـ ${result.updated} عميل، وتعذر تحديد ${result.unresolved}`
          : `لم يُعثر على اسم فرع معروف في بيانات ${result.unresolved} عميل`,
      );
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'حدث خطأ');
    } finally {
      setMigratingBranches(false);
    }
  };

  const handleAddLead = async (draft: typeof EMPTY_LEAD_DRAFT & { interestedCourseIds: string[] }) => {
    const salesId = !draft.autoAssign && draft.assignedSalesId !== '__rr__'
      ? draft.assignedSalesId
      : undefined;
    const rep = salesReps.find(item => item.id === salesId);
    const lead: LeadItem = {
      id: `lead-${Date.now()}`,
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      notes: draft.notes.trim() || undefined,
      status: draft.status,
      interestLevel: draft.interestLevel,
      source: draft.source,
      leadType: 'general',
      assignedSalesId: salesId,
      assignedSalesName: rep?.name,
      interestedCourseIds: draft.interestedCourseIds,
      branch: (draft.branch || undefined) as LeadItem['branch'],
      tags: draft.tags.length ? draft.tags : undefined,
      communications: [],
      createdAt: new Date().toISOString(),
      hidden: false,
    };
    await addLead(lead);
    notify('success', `تم إضافة ${lead.name} بنجاح`);
    if (isSalesOnly) await fetchSalesData?.();
  };

  const handleStatusChange = (lead: LeadItem, status: LeadStatus) => {
    const existing = statusDebounceRef.current.get(lead.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      const saved = await updateLead({ ...lead, status });
      statusDebounceRef.current.delete(lead.id);
      notify(
        saved ? 'success' : 'error',
        saved ? `${lead.name} → ${STATUS_CFG[status].label}` : `تعذر تحديث حالة ${lead.name}`,
      );
    }, 600);
    statusDebounceRef.current.set(lead.id, timer);
  };

  const openLeadBook = (lead: LeadItem) => {
    setLeadPayRow(lead);
    setLeadPayDraft(createClientPaymentDraft({
      courseId: lead.interestedCourseIds?.[0] || lead.enrolledCourseId || '',
      currency: currencyForBranch(lead.branch),
      branch: lead.branch || '',
      email: lead.email || '',
    }));
  };

  const handleLeadPayment = async (draft: PaymentDraft) => {
    if (!leadPayRow) return;
    try {
      const { handleLeadPaymentFn } = await import('../../dashboardPaymentHandlers');
      await handleLeadPaymentFn(draft, {
        leadPayRow,
        leads: effectiveLeads,
        subscribers: effectiveSubs,
        bundles,
        courses,
        branchLabelMap,
        recordSubscriberPayment,
        reloadLeads,
        reloadSubscribers,
        notify,
        currentStaff,
        isAdmin,
        isSalesOnly,
        isDaqqiManager: currentStaff?.role === 'daqqi_manager',
        isReceptionDaqqi: currentStaff?.role === 'reception_daqqi',
        fetchSalesData: async () => { await fetchSalesData?.(); },
        setActiveTab: tab => setActiveDashboardTab?.(tab),
      });
      setLeadPayRow(null);
    } catch {
      // The payment handler already reports a precise persistence error.
      // Keep the modal open so the operator can correct/retry the same draft.
    }
  };

  const convertLeadToSubscriber = async () => {
    const { lead, courseId, accessMode } = convertLeadModal;
    if (!lead || !courseId) return;
    try {
      await mysqlAdmin.convertLead(lead.id, { courseId, accessMode });
      await Promise.all([reloadLeads(), reloadSubscribers()]);
      notify('success', 'تم تحويل العميل وربط الكورس داخل النظام بنجاح');
      setConvertLeadModal({ lead: null, courseId: '', accessMode: 'full' });
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحويل العميل');
    }
  };

  const handleCleanupJunkLeads = async () => {
    if (!window.confirm('سيتم إخفاء العملاء المحتملين بدون اسم ولا هاتف. تأكيد؟')) return;
    try {
      const result = await mysqlAdmin.adminPost<Record<string, unknown>>('/admin/cleanup-junk-leads', {});
      notify('success', `تم إخفاء ${Number(result.hidden) || 0} سجل جنك`);
      await reloadLeads();
    } catch {
      notify('error', 'فشل التنظيف');
    }
  };

  return {
    handleSave,
    handleSyncSheet,
    handleDistribute,
    handleMigrateBranches,
    handleAddLead,
    handleStatusChange,
    openLeadBook,
    handleLeadPayment,
    convertLeadToSubscriber,
    handleExportVisibleLeadsCsv: () => downloadLeadsCsv(visibleLeads),
    handleCleanupJunkLeads,
  };
}
