// @ts-nocheck
import { create } from 'zustand';
import { ActivityLogItem, NotificationBroadcast, AutomationWorkflow, AdminAiConfig, AiAgentConfig, MessagingChannelsConfig, FacebookLeadAdsConfig, Currency } from '../types';
import { mysqlAdmin } from '../lib/mysqlapi';

const logPersistError = (what: string) => (err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[useSystemStore] failed to persist ${what}:`, err);
};

interface SystemState {
  content: Record<string, string>;
  activityLogs: ActivityLogItem[];
  notifications: NotificationBroadcast[];
  automationWorkflows: AutomationWorkflow[];
  adminAiConfig: AdminAiConfig | null;
  aiAgentConfig: AiAgentConfig | null;
  messagingChannels: MessagingChannelsConfig | null;
  fbLeadAdsConfig: FacebookLeadAdsConfig | null;
  currency: Currency;
  remoteReady: boolean;

  setContent: (content: Record<string, string>) => void;
  setActivityLogs: (logs: ActivityLogItem[]) => void;
  setNotifications: (notifications: NotificationBroadcast[]) => void;
  setAutomationWorkflows: (workflows: AutomationWorkflow[]) => void;
  setAdminAiConfig: (config: AdminAiConfig | null) => void;
  setAiAgentConfig: (config: AiAgentConfig | null) => void;
  setMessagingChannels: (config: MessagingChannelsConfig | null) => void;
  setFbLeadAdsConfig: (config: FacebookLeadAdsConfig | null) => void;
  setCurrency: (c: Currency) => void;
  setRemoteReady: (r: boolean) => void;

  setContentValue: (key: string, value: string) => void;
  mergeContent: (data: Record<string, string>) => void;
  addContentKey: (key: string, value: string) => void;
  removeContentKey: (key: string) => void;
  clearAllData: () => void;

  addNotification: (item: NotificationBroadcast) => void;
  updateNotification: (item: NotificationBroadcast) => void;
  deleteNotification: (id: string) => void;

  addAutomationWorkflow: (item: AutomationWorkflow) => void;
  updateAutomationWorkflow: (item: AutomationWorkflow) => void;
  deleteAutomationWorkflow: (id: string) => void;

  issueClientCode: () => string;
  issueClientCodeAsync: () => Promise<string>;
  triggerAutomation: (trigger: any, data?: Record<string, unknown>) => void;
}

export const useSystemStore = create<SystemState>((set) => ({
  content: {},
  activityLogs: [],
  notifications: [],
  automationWorkflows: [],
  adminAiConfig: null,
  aiAgentConfig: null,
  messagingChannels: null,
  fbLeadAdsConfig: null,
  currency: 'USD',
  remoteReady: false,

  setContent: (content) => set({ content }),
  setActivityLogs: (activityLogs) => set({ activityLogs }),
  setNotifications: (notifications) => set({ notifications }),
  setAutomationWorkflows: (automationWorkflows) => set({ automationWorkflows }),
  setAdminAiConfig: (adminAiConfig) => set({ adminAiConfig }),
  setAiAgentConfig: (aiAgentConfig) => set({ aiAgentConfig }),
  setMessagingChannels: (messagingChannels) => set({ messagingChannels }),
  setFbLeadAdsConfig: (fbLeadAdsConfig) => set({ fbLeadAdsConfig }),
  setCurrency: (currency) => set({ currency }),
  setRemoteReady: (remoteReady: boolean) => set({ remoteReady }),

  setContentValue: (key, value) => set((state) => {
    const content = { ...state.content, [key]: value };
    void mysqlAdmin.saveContent(content).catch(logPersistError('site content'));
    return { content };
  }),
  mergeContent: (data) => set((state) => {
    const content = { ...state.content, ...data };
    void mysqlAdmin.saveContent(content).catch(logPersistError('site content'));
    return { content };
  }),
  addContentKey: (key, value) => set((state) => {
    if (key in state.content) return state;
    const content = { ...state.content, [key]: value };
    void mysqlAdmin.saveContent(content).catch(logPersistError('site content'));
    return { content };
  }),
  removeContentKey: (key) => set((state) => {
    const next = { ...state.content };
    delete next[key];
    void mysqlAdmin.saveContent(next).catch(logPersistError('site content'));
    return { content: next };
  }),
  clearAllData: () => {},

  addNotification: (item) => set((state) => {
    const notifications = [item, ...state.notifications];
    void mysqlAdmin.saveNotifications(notifications).catch(logPersistError('notification'));
    return { notifications };
  }),
  updateNotification: (item) => set((state) => {
    const notifications = state.notifications.map((n) => (n.id === item.id ? item : n));
    void mysqlAdmin.saveNotifications(notifications).catch(logPersistError('notification'));
    return { notifications };
  }),
  deleteNotification: (id) => set((state) => {
    const notifications = state.notifications.filter((n) => n.id !== id);
    void mysqlAdmin.saveNotifications(notifications).catch(logPersistError('notification'));
    return { notifications };
  }),

  addAutomationWorkflow: (item) => {
    set((state) => ({ automationWorkflows: [...state.automationWorkflows, item] }));
    void mysqlAdmin.saveAutomationWorkflow(item).catch(logPersistError('automation workflow'));
  },
  updateAutomationWorkflow: (item) => {
    set((state) => ({ automationWorkflows: state.automationWorkflows.map((w) => (w.id === item.id ? item : w)) }));
    void mysqlAdmin.saveAutomationWorkflow(item).catch(logPersistError('automation workflow'));
  },
  deleteAutomationWorkflow: (id) => {
    set((state) => ({ automationWorkflows: state.automationWorkflows.filter((w) => w.id !== id) }));
    void mysqlAdmin.deleteAutomationWorkflow(id).catch(logPersistError('automation workflow delete'));
  },

  issueClientCode: () => 'CLIENT-000',
  issueClientCodeAsync: async () => 'CLIENT-000',
  triggerAutomation: (trigger, data) => {},
}));

