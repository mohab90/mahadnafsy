import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Fix malformed URLs like /?#/dashboard → /#/dashboard
// These can appear when Apache redirects clean up empty query strings
if (window.location.search && window.location.hash) {
  window.location.replace(window.location.origin + window.location.pathname + window.location.hash);
}

// Auto-reload when a lazy chunk 404s after a new deploy
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
