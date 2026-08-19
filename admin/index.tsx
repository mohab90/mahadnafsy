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

// The app mounted, so whatever chunk was missing is no longer a problem — the
// next deploy is allowed its own recovery attempt.
sessionStorage.removeItem(CHUNK_RELOAD_KEY);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
