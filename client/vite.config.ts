import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// sw.js is a static file (public/), so Vite's asset hashing never touches it. Without
// this, its cache name stays fixed forever and the activate handler never purges old
// cached bundles across deploys — found live 2026-07-15 causing returning visitors to
// get stuck on stale JS/CSS indefinitely. The cache name is derived from the names of
// the files the build wrote — content hashes — so a deploy that changed something gets
// a fresh cache, and one that changed nothing (a re-deploy, an API-only release) keeps
// the visitor's cache instead of throwing it away. It used to be the build's minute.
function swVersionPlugin(): Plugin {
  return {
    name: 'sw-version-stamp',
    writeBundle(_options, bundle) {
      const swPath = path.resolve(__dirname, 'dist/sw.js');
      if (!fs.existsSync(swPath)) return;
      const version = createHash('sha256').update(Object.keys(bundle).sort().join('\n')).digest('hex').slice(0, 12);
      const contents = fs.readFileSync(swPath, 'utf8').replace(/__SW_VERSION__/g, version);
      fs.writeFileSync(swPath, contents);
    },
  };
}


// The three Tajawal weights the first screen draws (body, extra-bold, black —
// Arabic subset) are asked for together with the page instead of after the CSS
// is parsed, so the text is laid out once, in the right font, and does not jump.
function preloadFontsPlugin(): Plugin {
  const wanted = ['tajawal-400-arabic', 'tajawal-800-arabic', 'tajawal-900-arabic'];
  return {
    name: 'preload-first-screen-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return [];
        const files = Object.keys(ctx.bundle).filter(name => wanted.some(w => name.includes(`${w}-`)) && name.endsWith('.woff2'));
        return files.map(file => ({
          tag: 'link',
          attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `${ctx.server?.config.base ?? ''}/${file}`.replace(/^\/\//, '/'), crossorigin: '' },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const appBase = env.VITE_APP_BASE || (mode === 'production' ? '/' : '/');
    const apiTarget = env.VITE_API_PROXY_TARGET || 'https://mahadnafsy.com';
    const isLocalTarget = apiTarget.startsWith('http://');
    // Lets the dev proxy reach a backend sitting behind HTTP Basic Auth (e.g.
    // a staging gate) — http-proxy does not pick this up from userinfo
    // embedded in the target URL, it needs its own `auth` option.
    const apiProxyBasicAuth = env.VITE_API_PROXY_BASIC_AUTH || '';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: apiTarget,
            changeOrigin: true,
            secure: !isLocalTarget,
            ...(apiProxyBasicAuth ? { auth: apiProxyBasicAuth } : {}),
            ...(isLocalTarget ? {} : { headers: { origin: 'https://mahadnafsy.com' } }),
          },
        },
      },
      plugins: [react(), swVersionPlugin(), preloadFontsPlugin()],
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
              if (id.includes('react-dom') || id.includes('react-router') || id.includes('react-is') || /node_modules\/(react|scheduler)\//.test(id)) return 'react-vendor';
              // Charts library → only loaded when stats pages render
              if (id.includes('/d3-') || id.includes('victory-vendor')) return 'd3-vendor';
              if (id.includes('recharts')) return 'recharts-vendor';
              // HLS video streaming → only loaded with the video player (heavy, rarely changes)
              if (id.includes('hls.js')) return 'hls-vendor';
              // Icon set
              if (id.includes('lucide-react')) return 'icons';
              // Everything else (the certificate QR code, the HTML sanitiser…)
              // stays with the lazy pages that use it, instead of riding in a
              // shared chunk that every first visit downloads.
              return undefined;
            },
            assetFileNames: 'assets/[name]-[hash][extname]',
            // Named by content alone. A build timestamp used to be appended to every
            // chunk, so each deploy renamed every file — unchanged React, icons and
            // charts included — and every visitor downloaded the whole app again.
            // index.html is never cached (nginx: no-store), so a changed chunk is still
            // picked up at once; an unchanged one keeps its name and stays cached.
            chunkFileNames: 'assets/[name]-[hash].js',
            entryFileNames: 'assets/[name]-[hash].js',
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
