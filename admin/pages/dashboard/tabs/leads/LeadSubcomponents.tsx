// Lead labels and helpers, plus the barrel the lead screens import from.
//
// The components that used to live here are in their own files now; they are
// re-exported below so the ten importing files did not have to change.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  ExternalLink,
  Inbox,
  Link2,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  Tag,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import type { LeadItem, LeadStatus, CommunicationRecord, Course, Bundle } from '../../../../types';
import { toDialable } from '../../../../lib/whatsappLink';
import { courseBadgeLabel, isRawCourse } from './leadCourseLabel';
import {
  STATUS_CFG,
} from '../leadUtils';


export { AddLeadModal } from './AddLeadModal';
export { BulkWhatsAppModal, WhatsAppRepModal } from './LeadWhatsAppModals';
export { QuickEditPanel } from './QuickEditPanel';
export { LeadCard } from './LeadCard';
export { getScoreBreakdown, ScoreBadge, EVENT_CFG, LeadJourneyTimeline } from './LeadScoreAndTimeline';
export { TagInput, MultiSelectDropdown } from './LeadInputs';

export const LEAD_STATUS_CFG = STATUS_CFG;

export const crmSourceLabels: Record<string, { label: string; color: string }> = {
  'واتساب':    { label: 'واتساب',    color: 'bg-green-100 text-green-800' },
  'فيسبوك':   { label: 'فيسبوك',   color: 'bg-blue-100 text-blue-800' },
  'إنستغرام': { label: 'إنستغرام', color: 'bg-pink-100 text-pink-800' },
  'توصية':    { label: 'توصية',    color: 'bg-amber-100 text-amber-800' },
  'الموقع':   { label: 'الموقع',   color: 'bg-indigo-100 text-indigo-800' },
  'جوجل':     { label: 'جوجل',     color: 'bg-red-100 text-red-800' },
  'شات الـAI': { label: 'AI', color: 'bg-purple-100 text-purple-800' },
  'تسجيل دخول': { label: 'تسجيل', color: 'bg-gray-100 text-gray-700' },
  'Google Sheet': { label: 'Sheet', color: 'bg-teal-100 text-teal-800' },
  'أخرى':     { label: 'أخرى',     color: 'bg-gray-100 text-gray-600' },
};

// Delegates to the shared rule — this used to build country code "2".
export const formatWaPhone = (p: string) => {
  return toDialable(p);
};

export const mkPromoCode = (name: string) =>
  name.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '').slice(0, 12);

export const crmStatusLabels: Record<string, string> = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم', interested_booking: 'مهتم بالحجز',
  interested_followup: 'مهتم ومتابعة', postpone_month: 'هيأجل >شهر', not_interested: 'مش مهتم',
  no_answer: 'لا يرد', no_answer_wa: 'لا يرد+واتس', no_answer_nowa: 'لا يرد-واتس',
  wrong_number: 'رقم غلط/مقفول', with_colleague: 'مع زميل آخر',
  not_interested_hidden: 'مش مهتم ومخفي', closed: 'مغلق', converted: 'تحول لمشترك', lost: 'مفقود', other: 'أخرى',
};

export const paymentTypeLabels: Record<string, string> = {
  course: 'دورة', bundle: 'باقة', certificate: 'شهادة',
  consultation: 'استشارة', deposit: 'عربون', installment: 'قسط', other: 'أخرى',
};
