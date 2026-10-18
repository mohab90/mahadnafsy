import { mysqlAdmin } from './mysqlapi';

/** The client a lead became: its id and the code the client page opens by. */
export type LeadClient = { id: string; clientCode: string | null };

/**
 * The client each of these leads became, asked of the server (GET /admin/leads/clients): the lead's own link, else
 * the same e-mail, else the same phone — the rule the conversion applies before it makes a new client.
 *
 * The table's «✓ مشترك» badge and the booking dialog looked for the client in the list of every client the browser
 * held, which for an employee was the whole list of their own clients, downloaded at sign-in.
 */
export async function fetchLeadClients(leadIds: string[]): Promise<Record<string, LeadClient>> {
  const ids = [...new Set(leadIds.filter(Boolean))].slice(0, 100);
  if (!ids.length) return {};
  const answer = await mysqlAdmin.adminGet<{ clients: Record<string, LeadClient> }>(`/admin/leads/clients?ids=${ids.map(encodeURIComponent).join(',')}`);
  return answer.clients || {};
}

/** The one client of one lead, or null. */
export async function findLeadClient(leadId: string): Promise<LeadClient | null> {
  return (await fetchLeadClients([leadId]))[leadId] || null;
}
