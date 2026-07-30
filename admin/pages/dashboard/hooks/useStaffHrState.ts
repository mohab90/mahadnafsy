import { useState } from 'react';
import type { StaffMember } from '../../../types';
import { blankStaffMember } from '../dashboardShared';

/**
 * Staff/HR management state: the sales-staff WhatsApp template + contact-tag
 * editors, the staff profile settings draft, and the HR self-service data
 * (my-HR snapshot, advance requests, leave requests) plus the staff-list
 * filters and edit-in-progress state. Lifted out of the Dashboard god-hub —
 * pure UI state (no effects) — returns identical names so the component
 * body is unchanged apart from the single destructure that replaces these
 * useState lines.
 */
export function useStaffHrState() {
  const [staffWaTemplates, setStaffWaTemplates] = useState<{ id: string; title: string; body: string }[]>([]);
  const [staffWaTemplateEdit, setStaffWaTemplateEdit] = useState<{ id: string; title: string; body: string } | null>(null);
  const [staffContactTags, setStaffContactTags] = useState<string[]>([]);
  const [staffNewTagInput, setStaffNewTagInput] = useState('');
  const [staffSettingsDraft, setStaffSettingsDraft] = useState<{ name: string; phone: string; image: string; waNumber: string; monthlyTarget: string } | null>(null);
  const [staffSettingsSaving, setStaffSettingsSaving] = useState(false);
  // HR self-service state
  const [myHrData, setMyHrData] = useState<{
    staff: { hire_date: string | null; department_name: string | null; employment_type: string | null; joined_at: string | null };
    salary: { base_salary: number; housing_allowance: number; transport_allowance: number } | null;
    commission: { thisMonth: { total: number; count: number } | null };
    attendance: { present_days: number; absent_days: number; late_days: number; total_late_minutes: number };
    leaveBalance: { annualEntitlement: number; usedDays: number; remaining: number };
    leaveHistory: { id: string; type: string; status: string; start_date: string; end_date: string; total_days: number; reason: string; approved_by_name: string | null }[];
    kpi: { leads_assigned: number; leads_converted: number; revenue_generated: number };
  } | null>(null);
  const [loadingMyHr, setLoadingMyHr] = useState(false);
  const [myAdvances, setMyAdvances] = useState<{ id: string; amount: number; currency: string; reason: string | null; status: string; created_at: string }[]>([]);
  const [myDisciplinary, setMyDisciplinary] = useState<{
    id: string; type: string; severity: string; title: string; description: string | null;
    incident_date: string | null; action_taken: string | null; appeal_note: string | null;
    acknowledged_at: string | null; status: string; created_at: string;
  }[]>([]);
  const [showAdvanceForm, setShowAdvanceForm] = useState(false);
  const [advanceDraft, setAdvanceDraft] = useState({ amount: '', reason: '' });
  const [submittingAdvance, setSubmittingAdvance] = useState(false);
  const [showMyLeaveFormProfile, setShowMyLeaveFormProfile] = useState(false);
  const [myLeaveFormProfile, setMyLeaveFormProfile] = useState({ type: 'ANNUAL', start_date: '', end_date: '', reason: '' });
  const [submittingMyLeaveProfile, setSubmittingMyLeaveProfile] = useState(false);

  const [staffSearch, setStaffSearch] = useState('');
  const [staffRoleFilter, setStaffRoleFilter] = useState<'all' | 'instructor' | 'trainer' | 'expert' | 'sales' | 'manager' | 'admin' | 'support' | 'reception_daqqi' | 'daqqi_manager' | 'online_manager' | 'sales_collection_manager' | 'collection' | 'accountant' | 'consultant' | 'hr' | 'other'>('all');
  const [editingStaffId, setEditingStaffId] = useState('');
  const [staffDraft, setStaffDraft] = useState<StaffMember>(blankStaffMember());
  const [staffPassword, setStaffPassword] = useState('');
  const [staffShowPassword, setStaffShowPassword] = useState(false);
  const [staffProfileModalId, setStaffProfileModalId] = useState<string | null>(null);

  return {
    staffWaTemplates, setStaffWaTemplates,
    staffWaTemplateEdit, setStaffWaTemplateEdit,
    staffContactTags, setStaffContactTags,
    staffNewTagInput, setStaffNewTagInput,
    staffSettingsDraft, setStaffSettingsDraft,
    staffSettingsSaving, setStaffSettingsSaving,
    myHrData, setMyHrData,
    loadingMyHr, setLoadingMyHr,
    myAdvances, setMyAdvances,
    myDisciplinary, setMyDisciplinary,
    showAdvanceForm, setShowAdvanceForm,
    advanceDraft, setAdvanceDraft,
    submittingAdvance, setSubmittingAdvance,
    showMyLeaveFormProfile, setShowMyLeaveFormProfile,
    myLeaveFormProfile, setMyLeaveFormProfile,
    submittingMyLeaveProfile, setSubmittingMyLeaveProfile,
    staffSearch, setStaffSearch,
    staffRoleFilter, setStaffRoleFilter,
    editingStaffId, setEditingStaffId,
    staffDraft, setStaffDraft,
    staffPassword, setStaffPassword,
    staffShowPassword, setStaffShowPassword,
    staffProfileModalId, setStaffProfileModalId,
  };
}
