import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Auto-reload when a lazy chunk 404s after a new deploy (stale index.html cached by browser).
// Only reloads once per session to avoid infinite loops.
window.addEventListener('unhandledrejection', (event) => {
  const msg: string = (event.reason as Error)?.message ?? '';
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Unable to preload CSS')
  ) {
    if (!sessionStorage.getItem('_chunk_reload')) {
      sessionStorage.setItem('_chunk_reload', '1');
      window.location.reload();
    }
  }
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
