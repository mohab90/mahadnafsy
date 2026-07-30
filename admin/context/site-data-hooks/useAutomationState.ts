import { useState } from 'react';
import type { AutomationWorkflow } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useAutomationState(
  initialAutomationWorkflows: AutomationWorkflow[],
  track: Track,
) {
  const [automationWorkflows, setAutomationWorkflows] = useState<AutomationWorkflow[]>(initialAutomationWorkflows);

  const addAutomationWorkflow = async (item: AutomationWorkflow) => {
    try {
      await mysqlAdmin.saveAutomationWorkflow(item as unknown as Record<string,unknown>);
      setAutomationWorkflows((prev) => [item, ...prev]);
      track('create', 'automation', item.name);
      return true;
    } catch {
      return false;
    }
  };
  const updateAutomationWorkflow = async (item: AutomationWorkflow) => {
    try {
      await mysqlAdmin.saveAutomationWorkflow(item as unknown as Record<string,unknown>);
      setAutomationWorkflows((prev) => prev.map((x) => (x.id === item.id ? item : x)));
      track('update', 'automation', item.name);
      return true;
    } catch {
      return false;
    }
  };
  const deleteAutomationWorkflow = async (id: string) => {
    try {
      await mysqlAdmin.deleteAutomationWorkflow(id);
      setAutomationWorkflows((prev) => prev.filter((x) => x.id !== id));
      track('delete', 'automation', id);
      return true;
    } catch {
      return false;
    }
  };

  return { automationWorkflows, setAutomationWorkflows, addAutomationWorkflow, updateAutomationWorkflow, deleteAutomationWorkflow };
}
