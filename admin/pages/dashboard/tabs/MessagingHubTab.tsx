import { useState } from 'react';
import { Radio, Megaphone, MessageCircle, Inbox } from 'lucide-react';
import { MessagingChannelsPanel } from './messaging/MessagingChannelsPanel';
import { WhatsappCampaignsPanel } from './messaging/WhatsappCampaignsPanel';
import { MyWhatsappChannelPanel } from './messaging/MyWhatsappChannelPanel';
import { InboxPanel } from './messaging/InboxPanel';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type View = 'inbox' | 'channels' | 'campaigns' | 'mine';

const VIEWS: { key: View; label: string; icon: typeof Radio; hint: string }[] = [
  { key: 'inbox', label: 'صندوق الرسائل', icon: Inbox, hint: 'ردود العملاء' },
  { key: 'mine', label: 'واتسابي', icon: MessageCircle, hint: 'اربط رقمك الشخصي' },
  { key: 'channels', label: 'قنوات المراسلة', icon: Radio, hint: 'أرقام الشركة والموظفين' },
  { key: 'campaigns', label: 'حملات الواتساب', icon: Megaphone, hint: 'رسائل تسويقية مجدولة' },
];

/**
 * Messaging hub.
 *
 * Opens on the inbox: the recurring reason to come here is a customer waiting
 * on a reply, not configuration, which is done once. The admin panels enforce their own permissions server-side, so a
 * rep seeing the tabs but getting an empty list is the correct behaviour rather
 * than something to hide in the UI.
 */
export default function MessagingHubTab({ notify }: { notify: NotifyFn }) {
  const [view, setView] = useState<View>('inbox');

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap gap-2">
        {VIEWS.map(({ key, label, icon: Icon, hint }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            title={hint}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition border ${
              view === key
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {view === 'inbox' && <InboxPanel notify={notify} />}
      {view === 'mine' && <MyWhatsappChannelPanel notify={notify} />}
      {view === 'channels' && <MessagingChannelsPanel notify={notify} />}
      {view === 'campaigns' && <WhatsappCampaignsPanel notify={notify} />}
    </div>
  );
}
