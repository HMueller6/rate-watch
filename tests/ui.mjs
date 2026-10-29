// End-to-end check in headless Chromium against SYNTHETIC data (never touches real data).
//   node tests/make-fixture.mjs && node tests/ui.mjs [screenshotDir]
// Requires Playwright to be resolvable (dev-only; the app itself has no dependencies).
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const shots = resolve(process.argv[2] || join(tmpdir(), 'rw-shots'));
mkdirSync(shots, { recursive: true });

// serve a copy of the app with the synthetic data in place
const app = mkdtempSync(join(tmpdir(), 'rw-app-'));
for (const d of ['css', 'js', 'data', 'icons', 'scripts']) cpSync(join(root, d), join(app, d), { recursive: true });
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest']) copyFileSync(join(root, f), join(app, f));
copyFileSync(join(root, 'tests/fixtures/dashboard.synthetic.json'), join(app, 'data/dashboard.json'));
const { createApp } = await import(join(app, 'scripts/serve.mjs'));
const server = createApp();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL', msg); } else console.log('  ok  ', msg); };

const browser = await chromium.launch();
const TABS = ['overview', 'canada', 'us', 'bonds', 'housing', 'data'];
for (const [vpName, viewport, extra] of [['phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['desktop', { width: 1280, height: 900 }, {}]]) {
  for (const scheme of ['light', 'dark']) {
    console.log(`\n${vpName} / ${scheme}`);
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, serviceWorkers: 'allow', ...extra });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
    for (const tab of TABS) {
      await page.goto(`${base}#/${tab}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('main .card, main .banner');
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, cards: document.querySelectorAll('main .card').length, svgs: document.querySelectorAll('main .chart svg').length, tiles: document.querySelectorAll('.tile').length }));
      check(m.sw <= m.iw, `${tab}: no horizontal overflow (${m.sw} <= ${m.iw})`);
      check(m.cards > 0, `${tab}: ${m.cards} cards, ${m.svgs} charts, ${m.tiles} tiles`);
      const minCharts = { canada: 12, us: 11, bonds: 4, housing: 2 }[tab];
      if (minCharts) check(m.svgs >= minCharts, `${tab}: at least ${minCharts} charts rendered`);
      await page.screenshot({ path: join(shots, `${vpName}-${scheme}-${tab}.png`), fullPage: true });
    }
    check(problems.length === 0, `no console errors/warnings${problems.length ? ': ' + problems.slice(0, 3).join(' | ') : ''}`);
    if (scheme === 'light') {
      // interactions
      await page.goto(`${base}#/canada`, { waitUntil: 'networkidle' });
      const box = await page.locator('main .chart svg').first().boundingBox();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
      check(await page.locator('.tip:not([hidden])').count() > 0, 'hover shows tooltip');
      await page.locator('button.linkbtn').first().click();
      check(await page.locator('.table-wrap:not([hidden]) table tbody tr').count() > 3, 'table view opens with rows');
      await page.locator('.rangebar button', { hasText: '1Y' }).click();
      check(await page.locator('.rangebar button[aria-pressed="true"]').innerText() === '1Y', 'range button switches to 1Y');
      await page.goto(`${base}#/housing`, { waitUntil: 'networkidle' });
      const btTable = () => page.locator('section.card', { hasText: 'Backtest: what followed' }).locator('table').innerText();
      const before = await btTable();
      await page.locator('.seg button', { hasText: '24 months' }).click();
      check(before !== await btTable(), 'backtest horizon switch changes the table');
      const ticks = await page.locator('main .chart svg').first().locator('text.tick').evaluateAll((els) => els.map((e) => e.textContent));
      check(ticks.length > 3 && !ticks.some((t) => /\.\d0%$/.test(t)), `y-axis tick labels are compact (${ticks.slice(0, 5).join(' ')})`);
      await page.fill('#c-amount', '400000'); await page.fill('#c-years', '30'); await page.fill('#c-rate', '4');
      await page.selectOption('#c-kind', 'fixed');
      const calc = await page.locator('main section.card', { hasText: 'Payment calculator' }).innerText();
      check(/\$1,902/.test(calc), 'calculator: $400k, 30y, 4% fixed => $1,902/month (independent reference)');
      await page.fill('#c-rate', '');
      await page.locator('#theme').click();
      check(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light', 'theme toggle cycles to light');
      // overview content
      await page.goto(`${base}#/overview`, { waitUntil: 'networkidle' });
      const ov = await page.locator('main').innerText();
      check(/2\.50%/.test(ov) && /4\.70%/.test(ov), 'overview shows 2.50% policy and 4.70% prime');
      check(/Dec 9/.test(ov), 'overview shows next decision Dec 9');
      await page.goto(`${base}#/canada`, { waitUntil: 'networkidle' });
      const ca = await page.locator('main').innerText();
      for (const t of ['Mortgage delinquency at banks', 'Bank of Canada balance sheet', 'Bank loan growth', 'Employment, monthly change', '5-year fixed mortgage rate', 'No free, current Canadian equivalent']) check(ca.includes(t), `canada tab has: ${t}`);
      await page.goto(`${base}#/overview`, { waitUntil: 'networkidle' });
      check(/SYNTHETIC TEST DATA/.test(ov), 'synthetic banner visible');
      check(/Matches Bank of Canada data/.test(ov), 'announcement reconciles with (synthetic) feed');
      // installability + offline
      const mf = await page.evaluate(async () => (await (await fetch('manifest.webmanifest')).json()).icons.length);
      check(mf >= 3, 'manifest has icons');
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload({ waitUntil: 'networkidle' });
      await ctx.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main .card, main .banner', { timeout: 5000 }).catch(() => {});
      check(await page.locator('main .card').count() > 0, 'offline reload still shows the dashboard (service worker cache)');
      await ctx.setOffline(false);
    }
    await ctx.close();
  }
}
// first-run state: no dashboard.json yet -> honest empty state, announcement still shown, nothing invented
{
  rmSync(join(app, 'data/dashboard.json'));
  console.log('\nfirst run (no dashboard.json)');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (const tab of ['overview', 'canada', 'bonds', 'housing', 'data']) {
    await page.goto(`${base}#/${tab}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main .card, main .banner');
    const txt = await page.locator('main').innerText();
    check(/No market data yet/.test(txt), `${tab}: shows the setup banner`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab}: no overflow`);
    if (tab === 'overview') {
      check(/2\.50%/.test(txt) && /4\.70%/.test(txt), 'overview: announcement rate and prime still shown');
      check(/Announced rate \(no data feed loaded\)/.test(txt), 'overview: says no feed is loaded');
      await page.screenshot({ path: join(shots, 'phone-firstrun-overview.png'), fullPage: true });
    }
  }
  check(errs.length === 0, 'first run: no page errors' + (errs[0] ? ': ' + errs[0] : ''));
  await ctx.close();
}
await browser.close();
server.close();
rmSync(app, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL UI CHECKS PASSED');
console.log('screenshots in', shots);
process.exit(failures.length ? 1 : 0);
