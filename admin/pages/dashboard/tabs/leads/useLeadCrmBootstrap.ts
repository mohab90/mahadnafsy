import { useCallback, useEffect, useState } from 'react';

import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { useSiteData } from '../../../../context/SiteDataContext';
import type { StaffMember } from '../../../../types';
import {
  DEFAULT_CRM_SETTINGS,
  type CrmPipelineStage,
  type CrmSettings,
  type NotifyFn,
} from '../CrmSettingsModal';

export function useLeadCrmBootstrap(notify: NotifyFn) {
  // Who I am, from the one place that resolves it. This hook used to ask
  // /api/staff/me itself — the third component on the same page load to do so,
  // and the answer decides whose leads the screen is scoped to.
  const { currentStaff } = useSiteData();
  const [crmSettings, setCrmSettings] = useState<CrmSettings>(DEFAULT_CRM_SETTINGS);
  const [pipelineStages, setPipelineStages] = useState<CrmPipelineStage[]>([]);
  const selfStaff = currentStaff
    ? { id: currentStaff.id, role: currentStaff.role, name: currentStaff.name || '' }
    : null;

  const reloadPipeline = useCallback(async () => {
    try {
      const result = await mysqlAdmin.getCrmPipeline();
      setPipelineStages(result.stages as CrmPipelineStage[]);
    } catch {
      setPipelineStages([]);
    }
  }, []);

  useEffect(() => { void reloadPipeline(); }, [reloadPipeline]);
  useEffect(() => {
    void mysqlAdmin.getCrmSettings()
      .then(data => {
        if ((data as Partial<CrmSettings> | null)?.leadSources?.length) {
          setCrmSettings(current => ({ ...current, ...(data as Partial<CrmSettings>) }));
        }
      })
      .catch(() => notify('error', 'تعذر تحميل إعدادات CRM'));
  }, [notify]);

  return {
    crmSettings,
    setCrmSettings,
    pipelineStages,
    reloadPipeline,
    selfStaff,
  };
}
