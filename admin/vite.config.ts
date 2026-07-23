import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3101';
  const appBase = env.VITE_APP_BASE || '/';
  const isLocalApiProxy = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(apiProxyTarget);
  return {
    server: {
      port: 4000,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: !isLocalApiProxy,
          ...(isLocalApiProxy ? {} : {
            headers: {
              origin: apiProxyTarget,
            },
          }),
        },
      },
    },
    plugins: [react()],
    esbuild: {
      charset: 'ascii',
    },
    build: {
      emptyOutDir: true,
      outDir: 'dist',
      minify: 'terser',
      terserOptions: { output: { ascii_only: true } },
      chunkSizeWarningLimit: 600,
      // Vite's default modulePreload conservatively preloads any chunk reachable
      // via a *statically discoverable* import() call, even one nested inside a
      // React.lazy() that only actually runs on user action (e.g. FinancialTab's
      // PDF export button) — so the 650KB+ pdf-vendor chunk was being fetched on
      // every admin page load regardless of whether anyone ever exports a PDF.
      // Explicitly drop it (and excel-vendor, same shape) from the preload list.
      modulePreload: {
        resolveDependencies: (_filename, deps) => deps.filter(dep =>
          !dep.includes('pdf-') &&
          !dep.includes('excel-vendor') &&
          !dep.includes('recharts-vendor') &&
          !dep.includes('d3-vendor')
        ),
      },
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (!id.includes('node_modules')) return;
            // React core — rarely changes, cached long-term
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('react-is')) return 'react-vendor';
            // Charts (recharts + its d3 internals) — only on stats/financial pages
            if (id.includes('/d3-') || id.includes('victory-vendor')) return 'd3-vendor';
            if (id.includes('recharts')) return 'recharts-vendor';
            // Icon set
            if (id.includes('lucide-react')) return 'icons';
            // Realtime client (used on every admin page for live updates) — kept
            // eager but in its own chunk, not lumped into the catch-all 'vendor'
            // bucket, so it doesn't get cache-busted every time an unrelated
            // small dependency changes (BUILD-02).
            if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'socket-vendor';
            // dompurify is used by the always-loaded SafeHtml component (via
            // Dashboard.tsx) — keep it OUT of pdf-vendor, otherwise Vite's
            // modulePreload sees dompurify as eagerly-reachable and preloads
            // the whole merged chunk, dragging jspdf/html2canvas along with it.
            if (id.includes('dompurify')) return 'vendor';
            // PDF export stack — heavy, loaded only when exporting PDFs.
            // Keep renderer-only dependencies in their own chunk so the core
            // PDF action does not produce one oversized vendor file.
            if (id.includes('html2canvas') || id.includes('canvg')) return 'pdf-renderer-vendor';
            if (id.includes('jspdf-autotable')) return 'pdf-table-vendor';
            if (id.includes('jspdf')) return 'pdf-core-vendor';
            // Excel export — loaded only when exporting spreadsheets
            if (id.includes('write-excel-file') || id.includes('xlsx')) return 'excel-vendor';
            // Everything else
            return 'vendor';
          },
          assetFileNames: 'assets/[name]-[hash][extname]',
          chunkFileNames: (chunkInfo) => {
            const d = new Date();
            const v = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
            return `assets/${chunkInfo.name}-[hash]-${v}.js`;
          },
          entryFileNames: (chunkInfo) => {
            const d = new Date();
            const v = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
            return `assets/${chunkInfo.name}-[hash]-${v}.js`;
          },
        },
      },
    },
    base: appBase,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        react: path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
        'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
        dompurify: path.resolve(__dirname, 'node_modules/dompurify'),
      },
    },
  };
});
