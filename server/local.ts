/**
 * Standalone Ghost Circuit server (no Reddit, no external services).
 *
 *   npm run dev      → this server on :8787 + Vite dev client on :5173 (proxied /api)
 *   npm start        → builds the client and serves everything from :8787
 *
 * Storage: MemoryRedis persisted to .data/ghost-circuit-db.json.
 * Identity: the `x-gc-player` header (a local nickname chosen in the game).
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUsername } from '../src/shared/api';
import { createApiRouter } from './app';
import { MemoryRedis } from './MemoryRedis';
import { RunStore } from './RunStore';

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.GC_DB_FILE ?? path.join(ROOT, '.data', 'ghost-circuit-db.json');
const SERVE_DIST = process.argv.includes('--serve');

const redis = new MemoryRedis(DB_FILE);
const store = new RunStore(redis);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '96kb' }));
app.use(
  '/api',
  createApiRouter({
    platform: 'local',
    store,
    now: Date.now,
    getUsername: async (req) => {
      const name = req.header('x-gc-player');
      return isUsername(name) ? name : null;
    },
  }),
);

if (SERVE_DIST) {
  const dist = path.join(ROOT, 'dist', 'local');
  app.get('/', (_req, res) => res.sendFile(path.join(dist, 'game.html')));
  app.use(express.static(dist, { index: false }));
}

const server = app.listen(PORT, () => {
  console.log(`[ghost-circuit] API ready on http://localhost:${PORT}/api  (db: ${path.relative(ROOT, DB_FILE)})`);
  if (SERVE_DIST) console.log(`[ghost-circuit] Game on http://localhost:${PORT}/`);
});

const shutdown = (): void => {
  try {
    redis.flush();
  } catch (err) {
    console.error('[ghost-circuit] failed to flush db', err);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
