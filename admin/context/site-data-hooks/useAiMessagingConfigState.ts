import { useState } from 'react';
import type { AdminAiConfig, AiAgentConfig, MessagingChannelsConfig, FacebookLeadAdsConfig, InboxConversation } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

// setInboxConversations is also written directly by the leads hook (auto-created
// conversation on new messaging-channel lead) and the admin inbox bootstrap effect,
// so it's returned alongside the CRUD fns.
export function useAiMessagingConfigState(
  initialAdminAiConfig: AdminAiConfig | null,
  initialAiAgentConfig: AiAgentConfig | null,
  initialMessagingChannels: MessagingChannelsConfig | null,
  initialFbLeadAdsConfig: FacebookLeadAdsConfig | null,
  initialInboxConversations: InboxConversation[],
  track: Track,
) {
  const [adminAiConfig, setAdminAiConfigLocal] = useState<AdminAiConfig | null>(initialAdminAiConfig);
  const [aiAgentConfig, setAiAgentConfigState] = useState<AiAgentConfig | null>(initialAiAgentConfig);
  const [messagingChannels, setMessagingChannelsState] = useState<MessagingChannelsConfig | null>(initialMessagingChannels);
  const [fbLeadAdsConfig, setFbLeadAdsConfigState] = useState<FacebookLeadAdsConfig | null>(initialFbLeadAdsConfig);
  const [inboxConversations, setInboxConversations] = useState<InboxConversation[]>(initialInboxConversations);

  const saveSettingsField = async (field: string, value: unknown) => {
    try {
      await mysqlAdmin.saveSettings({ [field]: JSON.parse(JSON.stringify(value)) } as Record<string,unknown>);
      return true;
    } catch {
      return false;
    }
  };

  const setAdminAiConfig = async (config: AdminAiConfig) => {
    if (!await saveSettingsField('adminAiConfig', config)) return false;
    setAdminAiConfigLocal(config);
    track('update', 'admin_ai', config.model);
    return true;
  };

  const setAiAgentConfig = async (config: AiAgentConfig) => {
    if (!await saveSettingsField('aiAgentConfig', config)) return false;
    setAiAgentConfigState(config);
    track('update', 'ai_agent', config.name);
    return true;
  };

  const setMessagingChannels = async (config: MessagingChannelsConfig) => {
    if (!await saveSettingsField('messagingChannels', config)) return false;
    setMessagingChannelsState(config);
    track('update', 'messaging_channels', 'channels config');
    return true;
  };

  const setFbLeadAdsConfig = async (config: FacebookLeadAdsConfig) => {
    if (!await saveSettingsField('fbLeadAdsConfig', config)) return false;
    setFbLeadAdsConfigState(config);
    track('update', 'fb_lead_ads', 'Facebook Lead Ads config');
    return true;
  };

  const addInboxConversation = async (conv: InboxConversation) => {
    try {
      await mysqlAdmin.saveInboxConversation(conv as unknown as Record<string,unknown>);
      setInboxConversations((prev) => [conv, ...prev]);
      track('create', 'inbox_conversation', conv.contactName);
      return true;
    } catch {
      return false;
    }
  };
  const updateInboxConversation = async (conv: InboxConversation) => {
    try {
      await mysqlAdmin.saveInboxConversation(conv as unknown as Record<string,unknown>);
      setInboxConversations((prev) => prev.map((c) => (c.id === conv.id ? conv : c)));
      track('update', 'inbox_conversation', conv.contactName);
      return true;
    } catch {
      return false;
    }
  };
  const deleteInboxConversation = async (id: string) => {
    try {
      await mysqlAdmin.deleteInboxConversation(id);
      setInboxConversations((prev) => prev.filter((c) => c.id !== id));
      track('delete', 'inbox_conversation', id);
      return true;
    } catch {
      return false;
    }
  };

  return {
    adminAiConfig, setAdminAiConfigLocal, setAdminAiConfig,
    aiAgentConfig, setAiAgentConfigState, setAiAgentConfig,
    messagingChannels, setMessagingChannelsState, setMessagingChannels,
    fbLeadAdsConfig, setFbLeadAdsConfigState, setFbLeadAdsConfig,
    inboxConversations, setInboxConversations, addInboxConversation, updateInboxConversation, deleteInboxConversation,
  };
}
