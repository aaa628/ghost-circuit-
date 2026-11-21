// Optional end-to-end smoke test (needs Playwright + Chromium installed).
// Start the game first with `npm run dev`, then: `npm run smoke`.
// Env: GC_BASE (default http://localhost:5173), GC_SHOTS (screenshot dir, default ./.data/shots)
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const BASE = process.env.GC_BASE || 'http://localhost:5173';
const OUT = process.env.GC_SHOTS || path.join(__dirname, '..', '.data', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
function watch(page, tag) {
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`); });
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  // 1. Desktop manual
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page, 'desktop');
  await page.goto(BASE + '/');
  await page.waitForSelector('.loading.gone', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/1-prestart.png` });
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1200);
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(250); await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(1300);
  const t1 = await page.textContent('.t-main');
  await page.screenshot({ path: `${OUT}/2-racing.png` });
  await page.keyboard.up('ArrowUp');
  const tR0 = Date.now();
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => document.querySelector('.t-main')?.textContent === '00.000', null, { timeout: 2000 });
  console.log('manual timer after ~2.8s:', t1, '| reset to 00.000 in', Date.now() - tR0, 'ms (incl. roundtrip)');
  await ctx.close();

  // 2. Autopilot full lap → submit → post-run
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await ctx2.newPage(); watch(p2, 'autopilot');
  await p2.goto(BASE + '/?autopilot=1');
  await p2.waitForSelector('.loading.gone', { timeout: 20000 });
  await p2.waitForTimeout(6000);
  await p2.screenshot({ path: `${OUT}/3-autopilot-mid.png` });
  await p2.waitForSelector('.postrun:not(.hidden)', { timeout: 60000 });
  await p2.waitForFunction(() => !document.querySelector('.pr-board')?.textContent?.includes('Loading'), null, { timeout: 10000 });
  await p2.waitForTimeout(600);
  console.log('postrun title:', await p2.textContent('.pr-title'), '| time:', await p2.textContent('.pr-time'), '| standing:', await p2.textContent('.pr-standing'));
  console.log('board rows:', await p2.$$eval('.pr-board .lb-row', (r) => r.map((x) => x.textContent)));
  await p2.screenshot({ path: `${OUT}/4-postrun.png` });
  await p2.click('.btn-share');
  await p2.waitForSelector('.share:not(.hidden)', { timeout: 5000 });
  await p2.waitForTimeout(400);
  const snippet = await p2.inputValue('.share-text');
  console.log('share snippet:', snippet);
  await p2.screenshot({ path: `${OUT}/5-share.png` });
  const link = snippet.match(/https?:\/\/\S+/)?.[0];
  await ctx2.close();

  // 3. Challenge link from a different player
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p3 = await ctx3.newPage(); watch(p3, 'challenge');
  await p3.goto(link);
  await p3.waitForSelector('.loading.gone', { timeout: 20000 });
  await p3.waitForTimeout(1500);
  console.log('challenge banner:', await p3.textContent('.mode-banner'));
  console.log('chips:', await p3.$$eval('.chip', (c) => c.map((x) => `${x.textContent}:${x.disabled ? 'absent' : 'on'}`)));
  await p3.keyboard.down('ArrowUp'); await p3.waitForTimeout(1800);
  console.log('delta target:', await p3.textContent('.delta-target'));
  await p3.screenshot({ path: `${OUT}/6-challenge.png` });
  await p3.keyboard.up('ArrowUp');
  await ctx3.close();

  // 4. Mobile
  const ctx4 = await browser.newContext({ ...devices['iPhone 13'] });
  const p4 = await ctx4.newPage(); watch(p4, 'mobile');
  await p4.goto(BASE + '/');
  await p4.waitForSelector('.loading.gone', { timeout: 20000 });
  await p4.waitForTimeout(1200);
  console.log('touch controls visible:', await p4.isVisible('.touch-controls.visible'));
  await p4.screenshot({ path: `${OUT}/7-mobile.png` });
  await ctx4.close();

  // 5. Splash inline sizes
  for (const [w, h] of [[390, 512], [640, 512]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p = await c.newPage(); watch(p, `splash${w}`);
    await p.goto(BASE + '/splash.html');
    await p.waitForTimeout(2500);
    console.log(`splash ${w}: rec=`, await p.textContent('#rec'), 'racers=', await p.textContent('#racers'), 'name=', await p.textContent('#track-name'));
    await p.screenshot({ path: `${OUT}/8-splash-${w}.png` });
    await c.close();
  }

  // 6. Offline (API blocked)
  const ctx6 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx6.route('**/api/**', (r) => r.abort('connectionrefused'));
  const p6 = await ctx6.newPage(); watch(p6, 'offline');
  await p6.goto(BASE + '/');
  await p6.waitForSelector('.loading.gone', { timeout: 20000 });
  await p6.waitForTimeout(1500);
  console.log('offline badge visible:', await p6.isVisible('.offline-badge'));
  await p6.click('button[aria-label="Leaderboard"]');
  await p6.waitForTimeout(1200);
  console.log('offline board:', await p6.$$eval('.panel .lb-row', (r) => r.map((x) => x.textContent)));
  await p6.screenshot({ path: `${OUT}/9-offline-board.png` });
  await ctx6.close();

  await browser.close();
  const real = errors.filter((e) => !e.startsWith('[offline]'));
  console.log('ERRORS:', real.length ? real.join('\n') : 'none');
  console.log(`Screenshots in ${OUT}`);
  if (real.length) process.exit(1);
})().catch((e) => { console.error('E2E FAILED', e); console.log('ERRORS:', errors.join('\n')); process.exit(1); });
