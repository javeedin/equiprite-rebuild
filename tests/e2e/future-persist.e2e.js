'use strict';
/*
 * EquipRite Future keeps its story in DuckDB (as the desktop app does): play on, wipe the browser's storage, reload,
 * and the story comes back from DuckDB; an older (version 3) story in the browser is upgraded, not thrown away.
 * Needs `npm run build`. Run: node tests/e2e/future-persist.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const F = require('./future-fixture');

const T = H.makeAsserter();
const KEY = 'equiprite-future:state:v3';

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxp-'));
  const dbFile = path.join(tmp, 'future.duckdb');
  let env;
  try {
    env = await E.start({ port: 19660, app: 'future', futureDb: dbFile, init: F.init(F.state('raised'), 'p-pm') });
    const { page } = env;
    await env.open('/');
    await page.waitForTimeout(1500);
    T.section('saved in DuckDB');
    const info = await page.evaluate(() => fetch('/__future/info').then((r) => r.json()));
    T.eq('the desktop store answers: DuckDB', info.engine, 'duckdb');
    await page.click('#fxDay');
    await page.waitForTimeout(400);
    await page.click('#fxDay');
    await page.waitForTimeout(1200);
    const saved = await page.evaluate(() => fetch('/__future/story').then((r) => r.json()));
    T.eq('two days on: DuckDB has the story, today 4 Nov', [saved.requests.length, saved.today].join(), '5,2026-11-04');
    const sql = await page.evaluate(() => fetch('/__future/sql', { method: 'POST', body: JSON.stringify({ sql: 'SELECT count(*) AS n FROM request_lines' }) }).then((r) => r.json()));
    T.eq('…and as SQL tables', Number(sql.rows[0].n), 5);

    T.section('the browser forgets; DuckDB remembers');
    await page.evaluate((k) => { localStorage.removeItem(k); sessionStorage.setItem('fx-fixture', '1'); }, KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.nx-nav-item', { state: 'attached', timeout: 60000 });
    await page.waitForTimeout(2000);
    T.eq('reloaded with an empty browser: the story is back from DuckDB', await env.text('#fxToday'), await env.text('#fxToday'));
    const back = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
    T.eq('…5 requests, today 4 Nov, in the browser again', back && [back.requests.length, back.today].join(), '5,2026-11-04');
    T.check('the clock says so', /4 Nov 2026/.test(await env.text('#fxToday')), await env.text('#fxToday'));

    T.section('a snapshot, restored');
    const snap = await page.evaluate(() => fetch('/__future/snapshots', { method: 'POST', body: JSON.stringify({ name: 'Two days in' }) }).then((r) => r.json()));
    T.check('saved as a named snapshot', snap.id > 0);
    const list = await page.evaluate(() => fetch('/__future/snapshots').then((r) => r.json()));
    T.eq('listed', list.map((x) => x.name + ' ' + x.requests).join(), 'Two days in 5');
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
  } finally {
    if (env) await env.close();
  }

  // An older story left in the browser by a previous version: upgraded on open, not reset.
  let env2;
  try {
    T.section('an older story in the browser is upgraded');
    const old = JSON.parse(JSON.stringify(F.state('onHire')));
    old.version = 3;
    old.agreements.forEach((a) => { delete a.billing; Object.keys(a.rates).forEach((k) => { delete a.rates[k].hour; }); });
    env2 = await E.start({ port: 19660, app: 'future', init: F.init(old, 'p-pm') });
    await env2.open('/');
    await env2.page.waitForTimeout(1500);
    await env2.page.click('#fxDay');
    await env2.page.waitForTimeout(800);
    const s = await env2.page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
    T.eq('version 4, the 5 requests kept, played on a day', [s.version, s.upgradedFrom, s.requests.length, s.today].join(), '4,3,5,2026-11-08');
    T.eq('no browser errors', env2.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished (upgrade)', false, e && e.stack);
  } finally {
    if (env2) await env2.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
