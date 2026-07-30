import { useState } from 'react';
import type { CommunicationRecord, CourseAccessSetting, ExtraCertificateType, PaymentHistoryEntry, SubscriberItem } from '../../../types';
import type { PaymentDraft } from '../../../components/PaymentModal';
import { createClientPaymentDraft } from '../../../lib/clientActionDrafts';

type SubStatus = SubscriberItem['status'];

// Subscriber-tab modal/draft state (edit-in-progress row + form drafts for
// each of the subscriber quick-action popups: payment, extra-certificate
// request, quick-contact, edit-subscriber, WhatsApp),
// lifted out of the Dashboard god-hub. Pure UI state (no effects) — returns
// identical names so the component body is unchanged apart from the single
// destructure that replaces these useState lines.
export function useSubscriberModals() {
  const [editingSubscriberId, setEditingSubscriberId] = useState('');
  const [refundActionSaving, setRefundActionSaving] = useState<string|null>(null);

  // Subscriber payment modal (separate from grant)
  const [subPayRow, setSubPayRow] = useState<SubscriberItem | null>(null);
  const [subPayDraft, setSubPayDraft] = useState<PaymentDraft>(createClientPaymentDraft());

  // Extra certificate request action
  const [certActionSub, setCertActionSub] = useState<SubscriberItem | null>(null);
  const [certActionDraft, setCertActionDraft] = useState<{ courseId: string; type: ExtraCertificateType | ''; certExpected: string; certPaid: string }>({ courseId: '', type: '', certExpected: '', certPaid: '' });

  // Subscriber quick-contact modal
  const [subContactRow, setSubContactRow] = useState<SubscriberItem | null>(null);
  const [subContactDraft, setSubContactDraft] = useState<{
    type: CommunicationRecord['type'];
    date: string;
    notes: string;
    outcome: string;
    nextFollowUp: string;
  }>({
    type: 'call',
    date: new Date().toISOString().slice(0, 16),
    notes: '',
    outcome: '',
    nextFollowUp: '',
  });
  const [subscriberDraft, setSubscriberDraft] = useState({
    id: '',
    name: '',
    email: '',
    phone: '',
    enrolledCourseIds: [] as string[],
    courseAccess: {} as Record<string, CourseAccessSetting>,
    lectureProgress: {} as Record<string, number>,
    paymentHistory: [] as PaymentHistoryEntry[],
    status: 'active_new' as SubStatus,
    createdAt: '',
  });
  const [newSubscriberPassword, setNewSubscriberPassword] = useState('');
  const [subWaRow, setSubWaRow] = useState<SubscriberItem | null>(null);

  return {
    editingSubscriberId, setEditingSubscriberId,
    refundActionSaving, setRefundActionSaving,
    subPayRow, setSubPayRow,
    subPayDraft, setSubPayDraft,
    certActionSub, setCertActionSub,
    certActionDraft, setCertActionDraft,
    subContactRow, setSubContactRow,
    subContactDraft, setSubContactDraft,
    subscriberDraft, setSubscriberDraft,
    newSubscriberPassword, setNewSubscriberPassword,
    subWaRow, setSubWaRow,
  };
}
