import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { LeadItem, SubscriberItem } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

const isValidClientCodeFormat = (c: string | undefined): boolean =>
  !!c && /^C\d+$/.test(c) && parseInt(c.slice(1), 10) >= 10000;

// Atomic-ish client-code issuance: MySQL counter is the source of truth, with a local
// high-water-mark fallback so codes stay monotonic even if the server call fails.
export function useClientCodeIssuance(
  initialLeads: LeadItem[],
  initialSubscribers: SubscriberItem[],
  subscribersRef: MutableRefObject<SubscriberItem[]>,
  leadsRef: MutableRefObject<LeadItem[]>,
) {
  const highWaterCodeRef = useRef<number>((() => {
    const allInitial = [
      ...initialLeads.map((l: LeadItem) => l.clientCode),
      ...initialSubscribers.map((s: SubscriberItem) => s.clientCode),
    ].filter(isValidClientCodeFormat).map((c) => parseInt(c!.slice(1), 10));
    return allInitial.length > 0 ? Math.max(...allInitial) : 10000;
  })());

  const issueClientCodeAsync = async (): Promise<string> => {
    const liveNums = [
      ...subscribersRef.current.map(s => s.clientCode),
      ...leadsRef.current.map(l => l.clientCode),
    ].filter(isValidClientCodeFormat).map(c => parseInt(c!.slice(1), 10));
    const liveMax = liveNums.length > 0 ? Math.max(...liveNums) : 10000;
    const localFloor = Math.max(highWaterCodeRef.current, liveMax);
    highWaterCodeRef.current = localFloor + 1;
    try {
      const { code } = await mysqlAdmin.issueClientCode();
      const num = parseInt(code.slice(1), 10);
      if (num > highWaterCodeRef.current) highWaterCodeRef.current = num;
      return code;
    } catch {
      return `C${localFloor + 1}`;
    }
  };

  const issueClientCode = (): string => {
    const liveNums = [
      ...subscribersRef.current.map(s => s.clientCode),
      ...leadsRef.current.map(l => l.clientCode),
    ].filter(isValidClientCodeFormat).map(c => parseInt(c!.slice(1), 10));
    const liveMax = liveNums.length > 0 ? Math.max(...liveNums) : 10000;
    const next = Math.max(highWaterCodeRef.current, liveMax) + 1;
    highWaterCodeRef.current = next;
    return `C${next}`;
  };

  return { issueClientCode, issueClientCodeAsync, isValidClientCodeFormat };
}
