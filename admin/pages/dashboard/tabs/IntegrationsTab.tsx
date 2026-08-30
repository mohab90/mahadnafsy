import { lazy } from 'react';
import { Bot, CreditCard, Mail, MessageSquareText, Settings2, Shield, Zap } from 'lucide-react';
import type { NotifyFn } from '../../../types';
import { SectionedTab, type TabSection } from './SectionedTab';

/**
 * The seven places the institute connects to something outside itself.
 *
 * They were seven entries in the settings menu — payment gateways, OTP, email,
 * SMS, the AI messaging agent, AI settings, webhooks — each its own screen with
 * one card on it. Somebody setting the institute up visited all seven and had
 * no way to see which were configured without opening each in turn.
 *
 * Nothing here re-implements them: every section is the component that was
 * already behind that menu entry. The permissions are the ones each screen
 * carried before, so bringing them together hands nobody a setting they could
 * not open before.
 */

const PaymentSettingsTab = lazy(() => import('./PaymentSettingsTab'));
const OtpSettingsTab = lazy(() => import('./OtpSettingsTab'));
const EmailSettingsTab = lazy(() => import('./EmailSettingsTab'));
const SmsSettingsTab = lazy(() => import('./SmsSettingsTab'));
const WebhooksTab = lazy(() => import('./WebhooksTab'));
const MessagingAgentTab = lazy(() => import('./MessagingAgentTab'));
const AdminAiSettingsTab = lazy(() => import('./AdminAiSettingsTab'));

export const INTEGRATION_SECTIONS: TabSection[] = [
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
  return (
    <SectionedTab
      sections={INTEGRATION_SECTIONS}
      notify={notify}
      basePath="integrations"
      emptyMessage="لا توجد تكاملات مسموح لك بإدارتها."
    />
  );
}
