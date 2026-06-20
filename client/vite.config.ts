import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const appBase = env.VITE_APP_BASE || (mode === 'production' ? '/' : '/');
    const apiTarget = env.VITE_API_PROXY_TARGET || 'https://mahadnafsy.com';
    const isLocalTarget = apiTarget.startsWith('http://');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: apiTarget,
            changeOrigin: true,
            secure: !isLocalTarget,
            ...(isLocalTarget ? {} : { headers: { origin: 'https://mahadnafsy.com' } }),
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
        rollupOptions: {
          output: {
            // Split the bundle into parallel-loadable chunks for better caching + faster loads
            manualChunks: (id) => {
              if (!id.includes('node_modules')) return;
              // React core → separate chunk (cached for long periods)
              if (id.includes('react-dom') || id.includes('react-router') || id.includes('react-is')) return 'react-vendor';
              // Charts library → only loaded when stats pages render
              if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'charts';
              // HLS video streaming → only loaded with the video player (heavy, rarely changes)
              if (id.includes('hls.js')) return 'hls-vendor';
              // Icon set
              if (id.includes('lucide-react')) return 'icons';
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
        }
      }
    };
});
