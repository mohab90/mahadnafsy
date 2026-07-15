import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export type UnifiedClientTab =
  | 'overview'
  | 'communications'
  | 'payments'
  | 'courses'
  | 'certificates'
  | 'loyalty'
  | 'installments'
  | 'consultations'
  | 'daqqi'
  | 'edit';

export function useUnifiedClientActiveTab() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<UnifiedClientTab>(() => {
    const openTab = (location.state as { openTab?: string } | null)?.openTab;
    return (openTab as UnifiedClientTab) || 'overview';
  });

  useEffect(() => {
    const openTab = (location.state as { openTab?: string } | null)?.openTab;
    if (!openTab) return;

    const timer = window.setTimeout(() => {
      document.getElementById(`section-${openTab}`)?.scrollIntoView({ behavior: 'smooth' });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [location.state]);

  return { activeTab, setActiveTab };
}
