import { useState } from 'react';
import type { AutomationWorkflow, AutomationTrigger, LeadItem, LeadStatus, StaffMember, NotificationBroadcast } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;
type SetLeads = React.Dispatch<React.SetStateAction<LeadItem[]>>;
type SetNotifications = React.Dispatch<React.SetStateAction<NotificationBroadcast[]>>;

// triggerAutomation reaches into leads/notifications/staff, so this hook takes those
// slices' setters/values as parameters rather than owning them — automationWorkflows
// is the only state it truly owns.
export function useAutomationState(
  initialAutomationWorkflows: AutomationWorkflow[],
  staffMembers: StaffMember[],
  setLeads: SetLeads,
  setNotifications: SetNotifications,
  track: Track,
) {
  const [automationWorkflows, setAutomationWorkflows] = useState<AutomationWorkflow[]>(initialAutomationWorkflows);

  const persistAutomationWorkflowToCollection = (workflow: AutomationWorkflow) => {
    void mysqlAdmin.saveAutomationWorkflow(workflow as unknown as Record<string,unknown>).catch(() => {});
  };

  const addAutomationWorkflow = (item: AutomationWorkflow) => {
    setAutomationWorkflows((prev) => [item, ...prev]);
    persistAutomationWorkflowToCollection(item);
    track('create', 'automation', item.name);
  };
  const updateAutomationWorkflow = (item: AutomationWorkflow) => {
    setAutomationWorkflows((prev) => prev.map((x) => (x.id === item.id ? item : x)));
    persistAutomationWorkflowToCollection(item);
    track('update', 'automation', item.name);
  };
  const deleteAutomationWorkflow = (id: string) => {
    setAutomationWorkflows((prev) => prev.filter((x) => x.id !== id));
    void mysqlAdmin.deleteAutomationWorkflow(id).catch(() => {});
    track('delete', 'automation', id);
  };

  const triggerAutomation = (trigger: AutomationTrigger, data: Record<string, unknown> = {}) => {
    const enabledWorkflows = automationWorkflows.filter((w) => w.enabled && w.trigger === trigger);
    for (const workflow of enabledWorkflows) {
      if (workflow.conditions && workflow.conditions.length > 0) {
        const allMatch = workflow.conditions.every((cond) => {
          const fieldValue = String(data[cond.field] ?? '');
          switch (cond.operator) {
            case 'equals': return fieldValue === cond.value;
            case 'contains': return fieldValue.includes(cond.value);
            case 'greater_than': return Number(fieldValue) > Number(cond.value);
            case 'less_than': return Number(fieldValue) < Number(cond.value);
            case 'is_empty': return !fieldValue;
            case 'is_not_empty': return !!fieldValue;
            default: return true;
          }
        });
        if (!allMatch) continue;
      }
      const cfg = workflow.actionConfig || {};
      switch (workflow.action) {
        case 'notify_admin':
          setNotifications((prev) => [{
            id: `notif-auto-${Date.now()}`,
            title: cfg.title || workflow.name,
            body: cfg.message || `تم تفعيل الأتمتة: ${workflow.name}`,
            type: 'info',
            createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
            active: true,
          }, ...prev]);
          break;
        case 'update_lead_status': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.status) {
            setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status: cfg.status as LeadStatus } : l));
          }
          break;
        }
        case 'add_note': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.message) {
            setLeads((prev) => prev.map((l) => l.id === leadId
              ? { ...l, notes: l.notes ? `${l.notes}\n[أتمتة] ${cfg.message}` : `[أتمتة] ${cfg.message}` }
              : l));
          }
          break;
        }
        case 'add_followup_reminder': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.days) {
            const d = new Date();
            d.setDate(d.getDate() + Number(cfg.days));
            const dateStr = d.toISOString().slice(0, 10);
            setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, nextFollowUpDate: dateStr } : l));
          }
          break;
        }
        case 'assign_staff': {
          const leadId = String(data.leadId ?? '');
          if (leadId && cfg.staffId) {
            const staff = staffMembers.find((s) => s.id === cfg.staffId);
            setLeads((prev) => prev.map((l) => l.id === leadId
              ? { ...l, assignedSalesId: cfg.staffId, assignedSalesName: staff?.name || cfg.staffId }
              : l));
          }
          break;
        }
        default:
          // External API actions (WhatsApp, Email, etc.) — require backend, log only
          track('automation', 'workflow', `${workflow.name} → ${workflow.action}`);
      }
      setAutomationWorkflows((prev) => prev.map((w) => w.id === workflow.id
        ? { ...w, lastTriggeredAt: new Date().toISOString().slice(0, 16).replace('T', ' '), triggerCount: (w.triggerCount || 0) + 1 }
        : w));
    }
  };

  return { automationWorkflows, setAutomationWorkflows, addAutomationWorkflow, updateAutomationWorkflow, deleteAutomationWorkflow, triggerAutomation };
}
