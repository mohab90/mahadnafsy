import { lazy } from 'react';
import { Mail, MessageCircle, MessageSquareText, Repeat } from 'lucide-react';
import type { NotifyFn } from '../../../types';
import { SectionedTab, type TabSection } from './SectionedTab';

/**
 * One campaign, four channels.
 *
 * حملات البريد، حملات SMS، حملات التنقيط، الواتساب والماسنجر were four menu
 * entries doing the same job down different pipes. Deciding which channel to
 * reach a segment on meant opening all four to see what each had sent.
 *
 * All four carried manage_channel_settings, so who can open them is unchanged.
 */

const MessagingHubTab = lazy(() => import('./MessagingHubTab'));
const EmailCampaignsTab = lazy(() => import('./EmailCampaignsTab'));
const SmsCampaignsTab = lazy(() => import('./SmsCampaignsTab'));
const DripCampaignsTab = lazy(() => import('./DripCampaignsTab'));

export const CAMPAIGN_SECTIONS: TabSection[] = [
  { id: 'messaging', label: 'واتساب وماسنجر', icon: MessageCircle, permission: 'manage_channel_settings', Component: MessagingHubTab },
  { id: 'email', label: 'البريد', icon: Mail, permission: 'manage_channel_settings', Component: EmailCampaignsTab },
  { id: 'sms', label: 'الرسائل النصية', icon: MessageSquareText, permission: 'manage_channel_settings', Component: SmsCampaignsTab },
  { id: 'drip', label: 'التنقيط (Drip)', icon: Repeat, permission: 'manage_channel_settings', Component: DripCampaignsTab },
];

/** The retired menu keys, and the section each one now opens. */
export const RETIRED_CAMPAIGN_TABS: Record<string, string> = {
  messaging_hub: 'messaging',
  email_campaigns: 'email',
  sms_campaigns: 'sms',
  drip_campaigns: 'drip',
};

export default function CampaignsTab({ notify }: { notify: NotifyFn }) {
  return (
    <SectionedTab
      sections={CAMPAIGN_SECTIONS}
      notify={notify}
      basePath="campaigns"
      emptyMessage="لا توجد حملات مسموح لك بإدارتها."
    />
  );
}
