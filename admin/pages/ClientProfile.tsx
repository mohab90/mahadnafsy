import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Info, ArrowRight, Loader } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { mysqlAdmin } from '../lib/mysqlapi';
import { LeadItem, SubscriberItem } from '../types';
import UnifiedClientPage from './UnifiedClientPage';

/**
 * Unified client profile page — accessible via /client/:code
 * Looks up ANY client by their unified clientCode or internal id,
 * spanning: subscribers, leads, DaqqiRound attendees, and consultations.
 * Non-admin staff: fetches the specific client via /api/staff/client/:code
 */
const ClientProfile: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { subscribers, leads, daqqiRounds, consultations, isAdmin, staffScopedSubscribers, staffScopedLeads } = useSiteData();

  // Merge context + scoped data so non-admin staff can navigate to clients
  const allSubs = subscribers.length > 0 ? subscribers : staffScopedSubscribers;
  const allLeads = leads.length > 0 ? leads : staffScopedLeads;

  // Remote fetch state — used when global context doesn't have the client (non-admin staff)
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteSub, setRemoteSub] = useState<SubscriberItem | null>(null);
  const [remoteLead, setRemoteLead] = useState<LeadItem | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteChecked, setRemoteChecked] = useState(false);

  if (!code) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-gray-500" dir="rtl">
        <Info size={48} className="text-gray-300" />
        <p className="text-xl">لم يتم تحديد كود العميل</p>
        <button onClick={() => navigate('/dashboard')} className="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 flex items-center gap-2">
          <ArrowRight size={16} /> العودة للوحة التحكم
        </button>
      </div>
    );
  }

  // ─── 1. Look up subscriber (by id OR clientCode) ─────────────────────
  const sub = allSubs.find((s) => s.id === code || (s.clientCode && s.clientCode === code));
  if (sub) {
    return <UnifiedClientPage subscriber={sub} />;
  }

  // ─── 2. Look up lead (by id OR clientCode) ─────────────────────────────
  const lead = allLeads.find((l) => l.id === code || (l.clientCode && l.clientCode === code));
  if (lead) {
    const leadPhone = lead.phone ? lead.phone.replace(/\D/g, '') : '';
    const leadEmail = lead.email ? lead.email.toLowerCase().trim() : '';
    const linkedSub = allSubs.find(
      (s) =>
        s.leadId === lead.id ||
        (leadEmail && s.email && s.email.toLowerCase().trim() === leadEmail) ||
        (leadPhone && leadPhone.length >= 8 && s.phone && s.phone.replace(/\D/g, '') === leadPhone)
    );
    if (linkedSub) return <Navigate to={`/client/${linkedSub.clientCode || linkedSub.id}`} replace />;
    return <UnifiedClientPage lead={lead} />;
  }

  // ─── 3. Look up via DaqqiRound attendees ───────────────────────────────
  for (const round of daqqiRounds) {
    const attendee = round.attendees.find((a) => a.subscriberId === code);
    if (attendee) {
      const attendeeSub = allSubs.find((s) => s.id === attendee.subscriberId);
      if (attendeeSub) return <UnifiedClientPage subscriber={attendeeSub} />;
    }
  }

  // ─── 4. Look up via consultation ───────────────────────────────────────
  const consult = consultations.find(
    (c) => c.id === code ||
      (code.includes('@') && c.clientEmail && c.clientEmail.toLowerCase() === code.toLowerCase()) ||
      (c.clientPhone && c.clientPhone.replace(/\D/g, '') === code.replace(/\D/g, ''))
  );
  if (consult) {
    const consultSub = allSubs.find(
      (s) =>
        (consult.clientEmail && s.email && s.email.toLowerCase() === consult.clientEmail.toLowerCase()) ||
        (consult.clientPhone && s.phone && s.phone.replace(/\D/g, '') === consult.clientPhone.replace(/\D/g, ''))
    );
    if (consultSub) return <UnifiedClientPage subscriber={consultSub} />;
    const consultLead = allLeads.find(
      (l) =>
        (consult.clientEmail && l.email && l.email.toLowerCase() === consult.clientEmail.toLowerCase()) ||
        (consult.clientPhone && l.phone && l.phone.replace(/\D/g, '') === consult.clientPhone.replace(/\D/g, ''))
    );
    if (consultLead) return <UnifiedClientPage lead={consultLead} />;
  }

  // ─── 5. Remote fetch — for non-admin staff whose context is empty ───────
  // This component function is called on every render, so we need a wrapper
  return (
    <RemoteFallback
      code={code}
      remoteLoading={remoteLoading} setRemoteLoading={setRemoteLoading}
      remoteSub={remoteSub} setRemoteSub={setRemoteSub}
      remoteLead={remoteLead} setRemoteLead={setRemoteLead}
      remoteError={remoteError} setRemoteError={setRemoteError}
      remoteChecked={remoteChecked} setRemoteChecked={setRemoteChecked}
    />
  );
};

/** Handles the API fallback fetch for non-admin staff accessing a client by code */
const RemoteFallback: React.FC<{
  code: string;
  remoteLoading: boolean; setRemoteLoading: (v: boolean) => void;
  remoteSub: SubscriberItem | null; setRemoteSub: (v: SubscriberItem | null) => void;
  remoteLead: LeadItem | null; setRemoteLead: (v: LeadItem | null) => void;
  remoteError: string | null; setRemoteError: (v: string | null) => void;
  remoteChecked: boolean; setRemoteChecked: (v: boolean) => void;
}> = ({ code, remoteLoading, setRemoteLoading, remoteSub, setRemoteSub, remoteLead, setRemoteLead, remoteError, setRemoteError, remoteChecked, setRemoteChecked }) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (remoteChecked) return;
    setRemoteLoading(true);
    mysqlAdmin.getClientByCode(code)
      .then((result) => {
        const r = result as unknown as { type: 'subscriber' | 'lead'; data: Record<string, unknown> };
        if (r.type === 'subscriber') {
          const s = r.data as unknown as SubscriberItem;
          setRemoteSub({ ...s, enrolledCourseIds: Array.isArray(s.enrolledCourseIds) ? s.enrolledCourseIds : [] });
        } else if (r.type === 'lead') {
          const l = r.data as unknown as LeadItem;
          setRemoteLead({ ...l, status: (l.status || 'new').toLowerCase() as LeadItem['status'] });
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setRemoteError(msg.includes('403') ? 'ليس لديك صلاحية الوصول لهذا العميل' : 'العميل غير موجود');
      })
      .finally(() => { setRemoteLoading(false); setRemoteChecked(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (remoteLoading || !remoteChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <div className="text-center text-gray-400">
          <Loader size={36} className="animate-spin mx-auto mb-3 text-indigo-400" />
          <p>جاري تحميل بيانات العميل...</p>
        </div>
      </div>
    );
  }

  if (remoteSub) return <UnifiedClientPage subscriber={remoteSub} />;
  if (remoteLead) return <UnifiedClientPage lead={remoteLead} />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-gray-500" dir="rtl">
      <Info size={48} className="text-gray-300" />
      <p className="text-xl font-bold">{remoteError || 'العميل غير موجود'}</p>
      <p className="text-sm text-gray-400">الكود: <span className="font-mono font-bold">{code}</span></p>
      <button onClick={() => navigate('/dashboard')} className="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 flex items-center gap-2">
        <ArrowRight size={16} /> العودة للوحة التحكم
      </button>
    </div>
  );
};

export default ClientProfile;
