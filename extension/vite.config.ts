import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

// Builds the MV3 extension to dist/. @crxjs wires the manifest entry points
// (service worker, content script, popup) into the Rollup build and emits a
// loadable unpacked extension. Build-only usage; no dev server is exposed.
export default defineConfig({
  plugins: [crx({ manifest })],
  // Bake the backend URL into the bundle at build time. Set PRIVVY_BACKEND_URL in
  // the build environment; falls back to a placeholder for local builds.
  define: {
    __PRIVVY_BACKEND_URL__: JSON.stringify(process.env.PRIVVY_BACKEND_URL ?? ''),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
