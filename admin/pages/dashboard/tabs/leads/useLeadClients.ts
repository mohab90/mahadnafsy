import { useEffect, useState } from 'react';
import { fetchLeadClients, type LeadClient } from '../../../../lib/leadClients';

/**
 * The client each converted lead on screen became, for the table's «✓ مشترك» badge — asked of the server for the
 * rows being drawn (GET /admin/leads/clients), not looked up in a list of every client the browser holds.
 */
export function useLeadClients(rows: { id: string; status?: string }[]): Record<string, LeadClient> {
  const [clients, setClients] = useState<Record<string, LeadClient>>({});
  const key = rows.filter(row => row.status === 'converted').map(row => row.id).join(',');
  useEffect(() => {
    if (!key) {
      setClients({});
      return undefined;
    }
    let alive = true;
    fetchLeadClients(key.split(',')).then(
      found => { if (alive) setClients(found); },
      () => { /* the badge is a convenience; the row still works without it */ },
    );
    return () => { alive = false; };
  }, [key]);
  return clients;
}
