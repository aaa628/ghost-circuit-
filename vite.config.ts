/**
 * Devvit (Reddit) build. `devvit playtest` / `devvit upload` run this via the
 * scripts in devvit.json. Produces dist/client (splash.html + game.html) and
 * dist/server/index.cjs (the server entry is src/server/index.ts).
 */
import { defineConfig } from 'vite';
import { devvit } from '@devvit/start/vite';

export default defineConfig({
  plugins: [
    devvit({
      client: {
        build: {
          chunkSizeWarningLimit: 2000,
          // Keep the uploaded web-view bundle small (server keeps its source maps).
          sourcemap: false,
        },
      },
    }),
  ],
});
