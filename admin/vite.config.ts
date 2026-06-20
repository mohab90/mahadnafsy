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
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (!id.includes('node_modules')) return;
            // React core — rarely changes, cached long-term
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('react-is')) return 'react-vendor';
            // Charts (recharts + its d3 internals) — only on stats/financial pages
            if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'charts';
            // Icon set
            if (id.includes('lucide-react')) return 'icons';
            // PDF export stack — heavy, loaded only when exporting PDFs
            if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('canvg') || id.includes('dompurify')) return 'pdf-vendor';
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
      },
    },
  };
});
