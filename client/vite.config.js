import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';

const API = process.env.VITE_API_TARGET || 'http://localhost:4000';

// `vite build --mode demo` (npm run build:demo) produces dist-demo/index.html: one
// self-contained file with the in-browser simulator, openable without any server.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    plugins: [react(), ...(demo ? [viteSingleFile()] : [])],
    define: demo ? { 'import.meta.env.VITE_DEMO': JSON.stringify('true') } : {},
    resolve: {
      // The demo bundles server modules (normaliser, store, adapters) that use Node's EventEmitter.
      alias: { 'node:events': fileURLToPath(new URL('./src/demo/events-shim.js', import.meta.url)) },
    },
    build: demo ? { outDir: 'dist-demo' } : {},
    server: {
      port: 5173,
      fs: { allow: ['..'] },
      proxy: {
        '/api': API,
        '/socket.io': { target: API, ws: true },
      },
    },
  };
});
