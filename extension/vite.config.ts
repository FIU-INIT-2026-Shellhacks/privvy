import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

// Builds the MV3 extension to dist/. @crxjs wires the manifest entry points
// (service worker, content script, popup) into the Rollup build and emits a
// loadable unpacked extension. Build-only usage; no dev server is exposed.
export default defineConfig(({ mode }) => {
  const backendUrl = process.env.PRIVVY_BACKEND_URL ?? '';

  // A production build MUST have a real backend URL. Refuse to build otherwise,
  // so a release can never silently ship the placeholder and fail at runtime.
  // Dev/local builds (e.g. `--mode development`, or testing against the mock with
  // PRIVVY_BACKEND_URL set) are allowed to fall back to the placeholder.
  if (mode === 'production' && !backendUrl) {
    throw new Error(
      'PRIVVY_BACKEND_URL is required for a production build. ' +
        'Set it to the deployed /analyze backend origin, or build with --mode development for a local placeholder build.',
    );
  }

  return {
    plugins: [crx({ manifest })],
    // Bake the backend URL into the bundle at build time.
    define: {
      __PRIVVY_BACKEND_URL__: JSON.stringify(backendUrl),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
