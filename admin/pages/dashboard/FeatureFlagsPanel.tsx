/**
 * FeatureFlagsPanel — reusable module on/off toggles (used inside the unified
 * Settings page). Persists to site_config via the safe setContentValue path.
 */
import { useState } from 'react';
import { useSiteData } from '../../context/SiteDataContext';
import { FEATURE_DEFS, parseFeatures, type FeatureKey } from './featureFlags';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export default function FeatureFlagsPanel({ notify }: { notify: NotifyFn }) {
  const { content, setContentValue } = useSiteData();
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(() => parseFeatures(content));

  const toggle = (key: FeatureKey) => {
    const next = { ...features, [key]: !features[key] };
    setFeatures(next);
    try {
      setContentValue('features', JSON.stringify(next));
      notify('success', `${next[key] ? 'تم تفعيل' : 'تم إيقاف'} «${FEATURE_DEFS.find(f => f.key === key)?.label}»`);
    } catch (e) {
      setFeatures(features);
      notify('error', 'فشل تحديث الميزة: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
        إيقاف ميزة يُخفي قسمها من القائمة فوراً لجميع المستخدمين. يمكنك إعادة تفعيلها في أي وقت.
      </p>
      {FEATURE_DEFS.map(f => {
        const on = features[f.key] !== false;
        return (
          <div key={f.key} className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-4 py-3">
            <div>
              <p className="font-bold text-gray-800 text-sm">{f.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{f.desc}</p>
            </div>
            <button onClick={() => toggle(f.key)} role="switch" aria-checked={on}
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'right-0.5' : 'right-6'}`} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
