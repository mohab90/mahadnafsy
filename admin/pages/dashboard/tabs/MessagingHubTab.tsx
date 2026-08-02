import { useState } from 'react';
import { Radio, Megaphone, MessageCircle } from 'lucide-react';
import { MessagingChannelsPanel } from './messaging/MessagingChannelsPanel';
import { WhatsappCampaignsPanel } from './messaging/WhatsappCampaignsPanel';
import { MyWhatsappChannelPanel } from './messaging/MyWhatsappChannelPanel';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type View = 'channels' | 'campaigns' | 'mine';

const VIEWS: { key: View; label: string; icon: typeof Radio; hint: string }[] = [
  { key: 'mine', label: 'واتسابي', icon: MessageCircle, hint: 'اربط رقمك الشخصي' },
  { key: 'channels', label: 'قنوات المراسلة', icon: Radio, hint: 'أرقام الشركة والموظفين' },
  { key: 'campaigns', label: 'حملات الواتساب', icon: Megaphone, hint: 'رسائل تسويقية مجدولة' },
];

/**
 * Messaging hub.
 *
 * Opens on "my WhatsApp" rather than the admin views: most people who reach
 * this screen are a rep connecting their own number, not an admin auditing
 * everyone's. The admin panels enforce their own permissions server-side, so a
 * rep seeing the tabs but getting an empty list is the correct behaviour rather
 * than something to hide in the UI.
 */
export default function MessagingHubTab({ notify }: { notify: NotifyFn }) {
  const [view, setView] = useState<View>('mine');

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

      {view === 'mine' && <MyWhatsappChannelPanel notify={notify} />}
      {view === 'channels' && <MessagingChannelsPanel notify={notify} />}
      {view === 'campaigns' && <WhatsappCampaignsPanel notify={notify} />}
    </div>
  );
}
