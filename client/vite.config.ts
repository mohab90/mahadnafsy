import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// sw.js is a static file (public/), so Vite's asset hashing never touches it. Without
// this, its cache name stays fixed forever and the activate handler never purges old
// cached bundles across deploys — found live 2026-07-15 causing returning visitors to
// get stuck on stale JS/CSS indefinitely. Stamps the same per-build timestamp used for
// chunk filenames into the cache name so each deploy gets an isolated cache.
function swVersionPlugin(version: string): Plugin {
  return {
    name: 'sw-version-stamp',
    writeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js');
      if (!fs.existsSync(swPath)) return;
      const contents = fs.readFileSync(swPath, 'utf8').replace(/__SW_VERSION__/g, version);
      fs.writeFileSync(swPath, contents);
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const appBase = env.VITE_APP_BASE || (mode === 'production' ? '/' : '/');
    const apiTarget = env.VITE_API_PROXY_TARGET || 'https://mahadnafsy.com';
    const isLocalTarget = apiTarget.startsWith('http://');
    const d = new Date();
    const buildVersion = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
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
      plugins: [react(), swVersionPlugin(buildVersion)],
      esbuild: {
        charset: 'ascii',
      },
      build: {
        emptyOutDir: true,
        outDir: 'dist',
        minify: 'terser',
        terserOptions: { output: { ascii_only: true } },
        // Keep the heavy HLS runtime out of modulepreload. It is imported from
        // inside the fullscreen video player only when an HLS lecture opens.
        modulePreload: {
          resolveDependencies: (_filename, deps) => deps.filter(dep =>
            !dep.includes('hls-vendor') &&
            !dep.includes('recharts-vendor') &&
            !dep.includes('d3-vendor')
          ),
        },
        rollupOptions: {
          output: {
            // Split the bundle into parallel-loadable chunks for better caching + faster loads
            manualChunks: (id) => {
              if (!id.includes('node_modules')) return;
              // React core → separate chunk (cached for long periods)
              if (id.includes('react-dom') || id.includes('react-router') || id.includes('react-is')) return 'react-vendor';
              // Charts library → only loaded when stats pages render
              if (id.includes('/d3-') || id.includes('victory-vendor')) return 'd3-vendor';
              if (id.includes('recharts')) return 'recharts-vendor';
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
          react: path.resolve(__dirname, 'node_modules/react'),
          'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
          'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
          'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
          dompurify: path.resolve(__dirname, 'node_modules/dompurify'),
          'hls.js': path.resolve(__dirname, 'node_modules/hls.js/dist/hls.light.mjs'),
        }
      }
    };
});
