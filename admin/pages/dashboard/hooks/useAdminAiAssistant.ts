import React, { useEffect, useState } from 'react';
import type { AdminAiConfig } from '../../../types';

type AdminAiDraft = {
  provider: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt: string;
};

/**
 * Admin AI Assistant settings draft (separate from the customer-facing AI
 * agent) plus the Z.AI dev-assistant chat log, lifted out of the Dashboard
 * god-hub. Owns two localStorage-backed useState values and the two effects
 * that persist/sync them — behavior is unchanged, only the location moved.
 */
export function useAdminAiAssistant(adminAiConfig: AdminAiConfig | null) {
  const [adminAiDraft, setAdminAiDraft] = useState<AdminAiDraft>(() => {
    const DEPRECATED_MODELS = ['gemini-2.0-flash'];
    try {
      const raw = localStorage.getItem('mahad-admin-ai-config');
      if (raw) {
        const saved = JSON.parse(raw) as { provider: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt?: string };
        // Auto-fix deprecated model names
        if (saved.provider === 'gemini' && DEPRECATED_MODELS.includes(saved.model)) {
          saved.model = 'gemini-2.0-flash-lite';
          localStorage.setItem('mahad-admin-ai-config', JSON.stringify(saved));
        }
        return { ...saved, systemPrompt: saved.systemPrompt || '' };
      }
    } catch {}
    return { provider: 'gemini', apiKey: '', model: 'gemini-2.0-flash-lite', temperature: 0.7, maxTokens: 1500, systemPrompt: '' };
  });

  // -- Z.AI Dev Assistant ------------------------------------------------
  const [aiDevMessages, setAiDevMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('mahad-ai-dev-messages') || '[]') as { role: 'user' | 'assistant'; text: string }[]; } catch { return []; }
  });
  const aiDevChatEndRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { localStorage.setItem('mahad-ai-dev-messages', JSON.stringify(aiDevMessages.slice(-80))); } catch { /* quota exceeded — trim further */ try { localStorage.setItem('mahad-ai-dev-messages', JSON.stringify(aiDevMessages.slice(-30))); } catch { /* silent */ } }
  }, [aiDevMessages]);

  // Sync adminAiDraft once from MySQL when adminAiConfig loads (cross-device)
  const adminAiSyncedRef = React.useRef(false);
  React.useEffect(() => {
    if (adminAiConfig && !adminAiSyncedRef.current) {
      adminAiSyncedRef.current = true;
      setAdminAiDraft({
        provider: adminAiConfig.provider || 'gemini',
        apiKey: adminAiConfig.apiKey || '',
        model: adminAiConfig.model || 'gemini-2.0-flash-lite',
        temperature: adminAiConfig.temperature ?? 0.7,
        maxTokens: adminAiConfig.maxTokens ?? 1500,
        systemPrompt: adminAiConfig.systemPrompt || '',
      });
    }
  }, [adminAiConfig]);

  return { adminAiDraft, setAdminAiDraft, aiDevMessages, setAiDevMessages, aiDevChatEndRef };
}
