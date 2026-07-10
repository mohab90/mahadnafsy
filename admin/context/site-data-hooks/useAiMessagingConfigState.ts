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

  const _persistSettingsField = (field: string, value: unknown) => {
    void mysqlAdmin.saveSettings({ [field]: JSON.parse(JSON.stringify(value)) } as Record<string,unknown>).catch(() => {});
  };
  const persistInboxConversationToCollection = (conv: InboxConversation) => {
    void mysqlAdmin.saveInboxConversation(conv as unknown as Record<string,unknown>).catch(() => {});
  };

  const setAdminAiConfig = (config: AdminAiConfig) => {
    setAdminAiConfigLocal(config);
    _persistSettingsField('adminAiConfig', config);
    track('update', 'admin_ai', config.model);
  };

  const setAiAgentConfig = (config: AiAgentConfig) => {
    setAiAgentConfigState(config);
    _persistSettingsField('aiAgentConfig', config);
    track('update', 'ai_agent', config.name);
  };

  const setMessagingChannels = (config: MessagingChannelsConfig) => {
    setMessagingChannelsState(config);
    _persistSettingsField('messagingChannels', config);
    track('update', 'messaging_channels', 'channels config');
  };

  const setFbLeadAdsConfig = (config: FacebookLeadAdsConfig) => {
    setFbLeadAdsConfigState(config);
    _persistSettingsField('fbLeadAdsConfig', config);
    track('update', 'fb_lead_ads', 'Facebook Lead Ads config');
  };

  const addInboxConversation = (conv: InboxConversation) => {
    setInboxConversations((prev) => [conv, ...prev]);
    persistInboxConversationToCollection(conv);
    track('create', 'inbox_conversation', conv.contactName);
  };
  const updateInboxConversation = (conv: InboxConversation) => {
    setInboxConversations((prev) => prev.map((c) => (c.id === conv.id ? conv : c)));
    persistInboxConversationToCollection(conv);
    track('update', 'inbox_conversation', conv.contactName);
  };
  const deleteInboxConversation = (id: string) => {
    setInboxConversations((prev) => prev.filter((c) => c.id !== id));
    void mysqlAdmin.deleteInboxConversation(id).catch(() => {});
    track('delete', 'inbox_conversation', id);
  };

  return {
    adminAiConfig, setAdminAiConfigLocal, setAdminAiConfig,
    aiAgentConfig, setAiAgentConfigState, setAiAgentConfig,
    messagingChannels, setMessagingChannelsState, setMessagingChannels,
    fbLeadAdsConfig, setFbLeadAdsConfigState, setFbLeadAdsConfig,
    inboxConversations, setInboxConversations, addInboxConversation, updateInboxConversation, deleteInboxConversation,
  };
}
