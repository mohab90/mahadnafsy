import { lazy, Suspense, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bot, CreditCard, Mail, MessageSquareText, Settings2, Shield, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NotifyFn, StaffPermission } from '../../../types';
import { hasPermission, type PermissionKey, type RoleKey } from '../../../constants/permissions';
import { useSiteData } from '../../../context/SiteDataContext';

/**
 * The seven places the institute connects to something outside itself.
 *
 * They were seven entries in the settings menu — payment gateways, OTP, email,
 * SMS, the AI messaging agent, AI settings, webhooks — each its own screen with
 * one card on it. Somebody setting the institute up visited all seven and had
 * no way to see which were configured without opening each in turn.
 *
 * Nothing here re-implements them. Each section is the tab component that was
 * already behind that menu entry, rendered under a strip that says which one is
 * showing. The old URLs still work: Dashboard.tsx maps each retired key to this
 * screen with the matching section, the same way it already did for the
 * "subscribers" route.
 */

const PaymentSettingsTab = lazy(() => import('./PaymentSettingsTab'));
const OtpSettingsTab = lazy(() => import('./OtpSettingsTab'));
const EmailSettingsTab = lazy(() => import('./EmailSettingsTab'));
const SmsSettingsTab = lazy(() => import('./SmsSettingsTab'));
const WebhooksTab = lazy(() => import('./WebhooksTab'));
const MessagingAgentTab = lazy(() => import('./MessagingAgentTab'));
const AdminAiSettingsTab = lazy(() => import('./AdminAiSettingsTab'));

type Section = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The permission this section required when it was its own screen. */
  permission: StaffPermission;
  Component: React.LazyExoticComponent<React.ComponentType<{ notify: NotifyFn }>>;
};

// The permissions are the ones each screen carried before the merge. Bringing
// them together must not hand somebody a setting they could not open before,
// so the strip shows only the sections the viewer already had.
export const INTEGRATION_SECTIONS: Section[] = [
  { id: 'payment', label: 'بوابات الدفع', icon: CreditCard, permission: 'manage_settings', Component: PaymentSettingsTab },
  { id: 'otp', label: 'OTP والقنوات', icon: Shield, permission: 'manage_security', Component: OtpSettingsTab },
  { id: 'email', label: 'البريد الإلكتروني', icon: Mail, permission: 'manage_settings', Component: EmailSettingsTab },
  { id: 'sms', label: 'الرسائل النصية', icon: MessageSquareText, permission: 'manage_channel_settings', Component: SmsSettingsTab },
  { id: 'agent', label: 'عميل المراسلة AI', icon: Bot, permission: 'manage_channel_settings', Component: MessagingAgentTab },
  { id: 'ai', label: 'إعدادات AI', icon: Settings2, permission: 'manage_ai_settings', Component: AdminAiSettingsTab },
  { id: 'webhooks', label: 'Webhooks', icon: Zap, permission: 'manage_settings', Component: WebhooksTab },
];

/** The retired menu keys, and the section each one now opens. */
export const RETIRED_INTEGRATION_TABS: Record<string, string> = {
  payment_settings: 'payment',
  otp_settings: 'otp',
  email_settings: 'email',
  sms_settings: 'sms',
  messaging_agent: 'agent',
  admin_ai_settings: 'ai',
  webhooks: 'webhooks',
};

export default function IntegrationsTab({ notify }: { notify: NotifyFn }) {
  const navigate = useNavigate();
  const { param } = useParams<{ param?: string }>();
  // Same shape CustomerInboxTab uses to answer the same question.
  const { isAdmin, staffMembers, authUser } = useSiteData();
  const sections = useMemo(() => {
    const self = staffMembers.find(member =>
      String(member.email || '').toLowerCase() === String(authUser?.email || '').toLowerCase());
    const subject = self
      ? { role: self.role as RoleKey, permissions: self.permissions as PermissionKey[] | undefined }
      : null;
    return INTEGRATION_SECTIONS.filter(s => isAdmin || hasPermission(subject, s.permission as PermissionKey));
  }, [isAdmin, staffMembers, authUser]);
  const active = useMemo(
    () => sections.find(s => s.id === param) ?? sections[0],
    [param, sections],
  );

  // Reachable when a link points at a section this viewer cannot open. The tab
  // itself opens for anyone holding any one of the four permissions, so having
  // none of them here means the deep link, not the tab, was the wrong door.
  if (!active) {
    return (
      <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        لا توجد تكاملات مسموح لك بإدارتها.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        {sections.map(section => {
          const Icon = section.icon;
          const isActive = section.id === active.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => navigate(`/dashboard/integrations/${section.id}`)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                isActive
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon size={16} />
              {section.label}
            </button>
          );
        })}
      </div>

      <Suspense
        fallback={(
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
          </div>
        )}
      >
        <active.Component notify={notify} />
      </Suspense>
    </div>
  );
}
