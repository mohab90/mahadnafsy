// «معاينة حساب الموظف»: the owner opens the panel as an employee, read-only, in a tab of its own (3 Nov 2026: «اقدر اشوف هو بيشوف ايه وبيقدر يعدل ايه»).
// The tab remembers who in sessionStorage — it dies with the tab, so the owner's other tabs stay the owner's — and every request to /api carries
// `X-Preview-Staff: <id>`; the server (api/middleware/auth.js applyPreview) then answers every read as that employee and refuses every write.

const KEY = 'mahad-preview-staff';

export type Preview = { id: string; name: string };

export function getPreview(): Preview | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.id === 'string' ? { id: parsed.id, name: String(parsed.name || '') } : null;
  } catch { return null; }
}

/** The link that opens the preview of one employee in a new tab. */
export function previewUrl(staff: Preview): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?preview=${encodeURIComponent(staff.id)}&pname=${encodeURIComponent(staff.name)}#/dashboard`;
}

/** Read the preview out of the address (before anything strips the query) and keep it for the tab. */
export function capturePreviewFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('preview');
    if (!id) return;
    sessionStorage.setItem(KEY, JSON.stringify({ id, name: params.get('pname') || '' }));
  } catch { /* storage may be blocked: no preview */ }
}

/** After this the tab is the owner's again. */
export function leavePreview(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to remove */ }
  if (window.opener) window.close();
  else window.location.replace(`${window.location.origin}${window.location.pathname}#/dashboard`);
}

/** Every /api request of this tab says whose account it is reading as. */
export function installPreviewFetch(): void {
  const preview = getPreview();
  if (!preview) return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const toApi = url.startsWith('/api') || url.startsWith(`${window.location.origin}/api`);
    if (!toApi) return original(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Preview-Staff', preview.id);
    return original(input, { ...init, headers });
  };
}
