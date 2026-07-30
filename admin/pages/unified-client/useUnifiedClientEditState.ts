import { useEffect, useState } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type { LeadItem, StaffMember, SubscriberItem } from '../../types';
import type { UnifiedClientSubscriberDraft } from './UnifiedClientEditTab';
import type { UnifiedClientTab } from './useUnifiedClientActiveTab';

interface Params {
  activeTab: UnifiedClientTab;
  lead?: LeadItem;
  subscriber?: SubscriberItem;
  staffMembers: StaffMember[];
  isAdmin: boolean;
  isOnlineManager: boolean;
  updateLead: (lead: LeadItem) => Promise<boolean>;
  updateSubscriber: (subscriber: SubscriberItem) => Promise<boolean>;
  reloadSubscribers: () => Promise<unknown>;
}

function subscriberDraft(subscriber?: SubscriberItem): UnifiedClientSubscriberDraft {
  return {
    name: subscriber?.name || '',
    email: subscriber?.email || '',
    phone: subscriber?.phone || '',
    branch: subscriber?.branch,
    expectedEGP: String(subscriber?.expectedTotals?.EGP || ''),
    expectedSAR: String(subscriber?.expectedTotals?.SAR || ''),
    expectedUSD: String(subscriber?.expectedTotals?.USD || ''),
    assignedSalesId: subscriber?.assignedSalesId || '',
    assignedSalesName: subscriber?.assignedSalesName || '',
    assignedCsId: subscriber?.assignedCsId || '',
    assignedCsName: subscriber?.assignedCsName || '',
    discount: String(subscriber?.discount || ''),
  };
}

export function useUnifiedClientEditState(params: Params) {
  const {
    activeTab, lead, subscriber, staffMembers, isAdmin, isOnlineManager,
    updateLead, updateSubscriber, reloadSubscribers,
  } = params;
  const [editing, setEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [leadDraft, setLeadDraft] = useState<LeadItem>(lead ?? ({} as LeadItem));
  const [subDraft, setSubDraft] = useState<UnifiedClientSubscriberDraft>(() => subscriberDraft(subscriber));
  const [credNewPassword, setCredNewPassword] = useState('');
  const [credMsg, setCredMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState<string | null>(null);
  const [currentPasswordLoading, setCurrentPasswordLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [accountDiag, setAccountDiag] = useState<Record<string, unknown> | null>(null);
  const [accountDiagLoading, setAccountDiagLoading] = useState(false);
  const [createAccLoading, setCreateAccLoading] = useState(false);
  const [createAccMsg, setCreateAccMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { if (lead) setLeadDraft(lead); }, [lead]);
  useEffect(() => { setSubDraft(subscriberDraft(subscriber)); }, [subscriber]);
  useEffect(() => {
    if (activeTab !== 'edit' || !subscriber || !(isAdmin || isOnlineManager)) return;
    setCurrentPasswordLoading(true);
    mysqlAdmin.getSubscriberPassword(subscriber.id)
      .then(result => setCurrentPassword(result.plain_password))
      .catch(() => setCurrentPassword(null))
      .finally(() => setCurrentPasswordLoading(false));
  }, [activeTab, subscriber?.id, isAdmin, isOnlineManager]);

  const handleSaveLeadEdit = async () => {
    if (isSaving || !lead) return;
    setIsSaving(true);
    try {
      if (await updateLead(leadDraft)) setEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSubEdit = async () => {
    if (isSaving || !subscriber) return;
    setIsSaving(true);
    setCredMsg(null);
    const nextSubscriber: SubscriberItem = {
      ...subscriber,
      name: subDraft.name,
      email: subDraft.email,
      phone: subDraft.phone,
      branch: subDraft.branch,
      expectedTotals: (subDraft.expectedEGP || subDraft.expectedSAR || subDraft.expectedUSD)
        ? {
            EGP: Number(subDraft.expectedEGP) || undefined,
            SAR: Number(subDraft.expectedSAR) || undefined,
            USD: Number(subDraft.expectedUSD) || undefined,
          }
        : undefined,
      assignedSalesId: subDraft.assignedSalesId || undefined,
      assignedSalesName: subDraft.assignedSalesName || undefined,
      assignedCsId: subDraft.assignedCsId || undefined,
      assignedCsName: subDraft.assignedCsName || undefined,
      discount: Number(subDraft.discount) || undefined,
    };
    const emailChanged = subDraft.email.trim().toLowerCase() !== subscriber.email.trim().toLowerCase();
    const password = credNewPassword.trim();
    try {
      if (isAdmin || isOnlineManager) {
        await mysqlAdmin.saveSubscriber({
          ...nextSubscriber,
          credentialUpdate: { currentEmail: subscriber.email, newPassword: password || undefined },
        });
        await reloadSubscribers();
      } else if (!await updateSubscriber(nextSubscriber)) {
        return;
      }
      if (emailChanged || password) {
        setCredMsg({
          type: 'success',
          text: password && emailChanged
            ? 'تم تحديث الإيميل وكلمة المرور ✓'
            : password ? 'تم تغيير كلمة المرور ✓' : 'تم تحديث الإيميل ✓',
        });
        if (password) setCurrentPassword(password);
        setCredNewPassword('');
      }
      setEditing(false);
    } catch (error) {
      setCredMsg({
        type: 'error',
        text: error instanceof Error ? error.message : 'فشل تحديث بيانات العميل',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    editing, setEditing, isSaving, setIsSaving,
    leadDraft, setLeadDraft, subDraft, setSubDraft,
    credNewPassword, setCredNewPassword, credMsg, setCredMsg,
    currentPassword, currentPasswordLoading,
    showCurrentPassword, setShowCurrentPassword, showNewPassword, setShowNewPassword,
    accountDiag, setAccountDiag, accountDiagLoading, setAccountDiagLoading,
    createAccLoading, setCreateAccLoading, createAccMsg, setCreateAccMsg,
    salesStaffList: staffMembers.filter(member => member.role === 'sales' && member.status === 'active'),
    csStaffList: staffMembers.filter(member => member.role === 'support' && member.status === 'active'),
    handleSaveLeadEdit, handleSaveSubEdit,
  };
}
