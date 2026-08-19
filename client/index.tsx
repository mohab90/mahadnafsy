import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Auto-reload when a lazy chunk 404s after a new deploy.
//
// The guard stops a genuinely missing chunk from looping the tab. But it was
// set once and never cleared, so it only worked for the first stale chunk in a
// session — after a second deploy the same tab showed the error and sat there.
// Clearing it on a successful mount gives each deploy its own single attempt.
const CHUNK_RELOAD_KEY = '_chunk_reload';

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
window.addEventListener('error', (event) => {
  recoverFromStaleChunk(event.message ?? '');
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {/* SW optional */});
  });
} else if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => registrations.forEach((registration) => registration.unregister()))
    .catch(() => {/* SW cleanup optional in dev */});
}

// Mounted, so the missing chunk is behind us — the next deploy may try again.
sessionStorage.removeItem(CHUNK_RELOAD_KEY);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
