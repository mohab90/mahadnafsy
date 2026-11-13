import { useCallback, useEffect, useState } from 'react';
import { mysqlAdmin } from './mysqlapi';
import { CRM_CHANGED_EVENT } from './crmChanged';

// What one client owes and has paid — the server's answer (api/lib/clientMoney.js, GET /api/admin/clients/:id/money), the same one for the client's page,
// the payment dialog and the receipt (7 Nov 2026: «سعر الكورس رقم في صفحة العميل ورقم تاني عند زر دفع وحجز»). A screen asks for it when it opens and again
// whenever any screen announces a change (announceCrmChanged, lib/crmChanged.ts — every price or payment write does), so nothing here is a copy that can age.
export interface MoneyItem {
  item: string; kind: 'course' | 'track'; partOf?: string | null; title: string; currency: string;
  catalogue: number; agreed: number; source: 'client' | 'booking' | 'catalogue' | 'none';
  paid: number; priorPaid: number; remaining: number;
}
export interface MoneyCertificate {
  id: string; type: string; courseId: string | null; status: string; currency: string;
  list: number; agreed: number; source: 'client' | 'list' | 'request' | 'none'; paid: number; remaining: number | null;
}
export interface MoneyExtra { kind: string; title: string; currency: string; agreed: number; source: string; paid: number; remaining: number }
export interface ClientMoney {
  subscriberId: string; nationality: string | null;
  items: MoneyItem[]; certificates: MoneyCertificate[]; extras: MoneyExtra[];
  totals: Record<string, { agreed: number; paid: number; remaining: number }>;
}

/** The client's money, fresh: null while it loads (or for no client), `failed` when the server could not answer. */
export function useClientMoney(subscriberId: string | null | undefined): { money: ClientMoney | null; loading: boolean; failed: boolean; refetch: () => void } {
  const [state, setState] = useState<{ id: string; money: ClientMoney | null; failed: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick(value => value + 1), []);
  useEffect(() => {
    window.addEventListener(CRM_CHANGED_EVENT, refetch);
    return () => window.removeEventListener(CRM_CHANGED_EVENT, refetch);
  }, [refetch]);
  useEffect(() => {
    if (!subscriberId) return undefined;
    let alive = true;
    mysqlAdmin.adminGet<ClientMoney>(`/admin/clients/${encodeURIComponent(subscriberId)}/money`)
      .then(money => { if (alive) setState({ id: subscriberId, money, failed: false }); })
      .catch(() => { if (alive) setState({ id: subscriberId, money: null, failed: true }); });
    return () => { alive = false; };
  }, [subscriberId, tick]);
  // Never another client's figures while this one's are on their way.
  const current = state && state.id === subscriberId ? state : null;
  return { money: current?.money ?? null, loading: Boolean(subscriberId) && !current, failed: Boolean(current?.failed), refetch };
}
