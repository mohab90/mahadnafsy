import { lazy } from 'react';
import { MessageCircle } from 'lucide-react';
import type { NotifyFn } from '../../../types';
import { SectionedTab, type TabSection } from './SectionedTab';

/**
 * «الحملات» opens straight on the shared inbox (4 Nov 2026, «امسح البريد والرسائل النصية والتنقيط، وخلي الصفحة تدخل على طول على صندوق الرسائل»).
 *
 * The email, SMS and drip campaign screens are gone from the menu; what is left is the messaging hub — inbox, channels, the WhatsApp campaigns, the bot, the page audience —
 * which opens on the inbox. The routes behind the old screens still answer, so a campaign already scheduled still goes out. A bookmark to one of them lands here.
 */

const MessagingHubTab = lazy(() => import('./MessagingHubTab'));

export const CAMPAIGN_SECTIONS: TabSection[] = [
  { id: 'messaging', label: 'صندوق الرسائل والقنوات', icon: MessageCircle, permission: 'manage_channel_settings', Component: MessagingHubTab },
];

/** The retired menu keys, and the section each one now opens. */
export const RETIRED_CAMPAIGN_TABS: Record<string, string> = {
  messaging_hub: 'messaging',
  email_campaigns: 'messaging',
  sms_campaigns: 'messaging',
  drip_campaigns: 'messaging',
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
