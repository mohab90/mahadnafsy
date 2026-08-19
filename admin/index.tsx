import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Fix malformed URLs like /?#/dashboard → /#/dashboard
// These can appear when Apache redirects clean up empty query strings
if (window.location.search && window.location.hash) {
  window.location.replace(window.location.origin + window.location.pathname + window.location.hash);
}

const CHUNK_RELOAD_KEY = '_chunk_reload';

// Auto-reload when a lazy chunk 404s after a new deploy.
//
// The guard stops a genuinely missing chunk from looping the tab. But it was
// set once and never cleared, so it only worked for the first stale chunk in a
// session — after a second deploy the same tab showed "Failed to fetch
// dynamically imported module" and sat there, which is what people reported.
// Clearing it on a successful mount gives each deploy its own single attempt.
const recoverFromStaleChunk = (message: string) => {
  if (
    !message.includes('Failed to fetch dynamically imported module') &&
    !message.includes('Importing a module script failed') &&
    !message.includes('error loading dynamically imported module') &&
    !message.includes('Unable to preload CSS')
  ) return;
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return;
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  // Past any cached index.html: the stale document is what points at the chunk
  // that no longer exists, so re-reading it would fail the same way.
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now().toString(36));
  window.location.replace(url.toString());
};

window.addEventListener('unhandledrejection', (event) => {
  recoverFromStaleChunk((event.reason as Error)?.message ?? '');
});
// A failed lazy import surfaces as a plain error event too, depending on where
// it is awaited — React's lazy boundary swallows the rejection in some paths.
window.addEventListener('error', (event) => {
  recoverFromStaleChunk(event.message ?? '');
});

// Release the guard only once the app has been up long enough to prove the
// reload worked.
//
// Clearing it here at module scope cleared it on every load, including the load
// the recovery itself triggered — and location.replace keeps the same route, so
// the same lazy import runs again immediately. A chunk that is genuinely absent
// from the server (a half-finished deploy, not a stale tab) therefore failed,
// reloaded, failed and reloaded in a tight loop, which is the exact runaway the
// guard exists to prevent.
//
// A stale chunk resolves on the first reload, so ten seconds is far more than
// that path needs; a missing one now costs one reload per attempt instead of a
// loop.
setTimeout(() => sessionStorage.removeItem(CHUNK_RELOAD_KEY), 10_000);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
