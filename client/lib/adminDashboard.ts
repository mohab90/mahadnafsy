/**
 * Where the staff dashboard lives.
 *
 * It is a separate app on a separate host, so it cannot be reached with
 * react-router. /auth tried to, with `navigate('/dashboard')` — and this app
 * registers /dashboard as `<Navigate to="/" replace />`, so a staff member who
 * signed in on the public site was bounced silently to the home page. The
 * checkIsStaff() call that decided it worked perfectly; the destination was
 * simply not somewhere this router could go.
 */
export function adminDashboardUrl(): string {
  return ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    ? 'http://127.0.0.1:4100'
    : 'https://admin.mahadnafsy.com';
}
