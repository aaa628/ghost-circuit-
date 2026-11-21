/** Entry point for game.html (Reddit expanded view, or the standalone page). */
import './styles/game.css';
import { GameApp } from './app/GameApp';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const app = new GameApp(root);
app.start().catch((err: unknown) => {
  console.error('[ghost-circuit] failed to start', err);
  const msg = document.createElement('div');
  msg.className = 'fatal';
  msg.textContent = 'Ghost Circuit failed to start. Please reload.';
  root.append(msg);
});

window.addEventListener('pagehide', () => app.dispose(), { once: true });
