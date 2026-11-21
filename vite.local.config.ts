/**
 * Standalone (non-Reddit) build & dev server.
 *   npm run dev          → this dev server on :5173, /api proxied to :8787
 *   npm run build:local  → dist/local (served by `npm start`)
 */
import { defineConfig, type Plugin } from 'vite';

/** Serve the game at "/" (query string preserved for challenge links). */
function rootIsGame(): Plugin {
  return {
    name: 'ghost-circuit-root-is-game',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '/';
        if (url === '/' || url.startsWith('/?')) req.url = `/game.html${url.slice(1)}`;
        next();
      });
    },
  };
}

export default defineConfig({
  appType: 'mpa',
  publicDir: false,
  plugins: [rootIsGame()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    outDir: 'dist/local',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { game: 'game.html', splash: 'splash.html' },
    },
  },
});
