import { useCallback, useEffect, useState } from 'react';

import { mysqlAdmin, mysqlClient } from '../../../../lib/mysqlapi';
import type { StaffMember } from '../../../../types';
import {
  DEFAULT_CRM_SETTINGS,
  type CrmPipelineStage,
  type CrmSettings,
  type NotifyFn,
} from '../CrmSettingsModal';

type StaffSelfSnapshot = { id?: string; role?: string; name?: string };

export function useLeadCrmBootstrap(notify: NotifyFn) {
  const [crmSettings, setCrmSettings] = useState<CrmSettings>(DEFAULT_CRM_SETTINGS);
  const [pipelineStages, setPipelineStages] = useState<CrmPipelineStage[]>([]);
  const [selfStaff, setSelfStaff] = useState<{
    id: string;
    role: StaffMember['role'];
    name: string;
  } | null>(null);

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
    void mysqlClient.getStaffSelf()
      .then((staff: StaffSelfSnapshot) => {
        if (staff?.id) {
          setSelfStaff({
            id: staff.id,
            role: (staff.role || 'other') as StaffMember['role'],
            name: staff.name || '',
          });
        }
      })
      .catch(() => {});
  }, []);
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
