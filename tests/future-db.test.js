/*
 * EquipRite Future's story in DuckDB (desktop/lib/futureDb.js) and the store's upgrade of older stories
 * (fxStore.upgrade): saved, reloaded after a reopen, the story as SQL tables, read-only SQL, snapshots, history, and a
 * version-3 story (before hourly billing) upgraded instead of thrown away.
 *
 * Run:  node tests/future-db.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');
const F = require('./e2e/future-fixture');
const DB = require('../desktop/lib/futureDb');

const T = H.makeAsserter();

function loadStore() {
  const dir = path.join(__dirname, '..', 'webApps', 'equiprite-future', 'resources', 'js', 'future');
  const mods = {};
  function load(name) {
    if (mods[name]) return mods[name];
    const sb = { console, JSON, Math, Date, Object, Array, String, Number, Error, setTimeout, clearTimeout, window: {} };
    sb.define = (deps, factory) => { mods[name] = factory(...deps.map((d) => load(d.split('/').pop()))); };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(dir, name + '.js'), 'utf8'), sb, { filename: name + '.js' });
    return mods[name];
  }
  return load('fxStore');
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxdb-'));
  const file = path.join(tmp, 'future.duckdb');
  try {
    T.section('DuckDB');
    T.check('DuckDB loads on this computer', DB.available);
    let db = await DB.open(file);
    const info = await db.info();
    T.eq('engine and version', [info.engine, /^v1\.4/.test(info.version)].join(), 'duckdb,true');
    T.eq('nothing saved yet', await db.load(), null);
    const story = F.state('settled');
    await db.save(JSON.stringify(story));
    await db.close();
    db = await DB.open(file);
    const back = JSON.parse(await db.load());
    T.eq('saved, closed, reopened: the same story', [back.requests.length, back.tx.length, back.today].join(), [story.requests.length, story.tx.length, story.today].join());

    T.section('the story as tables');
    const t = await db.query('SELECT count(*) AS n FROM requests');
    T.eq('requests', Number(t.rows[0].n), story.requests.length);
    const tb = await db.query('SELECT legal_entity, round(sum(debit), 2) AS dr, round(sum(credit), 2) AS cr FROM fusion_tx_lines GROUP BY 1 ORDER BY 1');
    T.check('each company\'s accounting balances in SQL too', tb.rows.length === 3 && tb.rows.every((r) => Number(r.dr) === Number(r.cr)), JSON.stringify(tb.rows));
    const ic = await db.query(`SELECT s.number, sum(c.amount) AS charged FROM charges c JOIN statements s ON s.id = c.statement GROUP BY 1 ORDER BY 1`);
    T.check('joins work: charges by statement', ic.rows.length === 2 && ic.rows.every((r) => Number(r.charged) > 0));
    T.check('the request lines know who sources them', (await db.query("SELECT DISTINCT sourcing_bu FROM request_lines ORDER BY 1")).rows.map((r) => r.sourcing_bu).join() === 'BU-FC,BU-PF');
    for (const bad of ['DELETE FROM requests', 'DROP TABLE story', 'SELECT 1; DELETE FROM story', 'ATTACH \'x.db\'', "COPY requests TO 'x.csv'"]) {
      let err = '';
      try { await db.query(bad); } catch (e) { err = e.message; }
      T.check('refused: ' + bad, /read-only/.test(err), err);
    }
    T.eq('the story still there after the refusals', JSON.parse(await db.load()).requests.length, story.requests.length);

    T.section('snapshots and history');
    const s1 = await db.saveSnapshot('After scenario 1', JSON.stringify(story));
    const fresh = F.state('fresh');
    await db.save(JSON.stringify(fresh));
    const list = await db.snapshots();
    T.eq('a named snapshot', [list.length, list[0].name, list[0].requests].join(' | '), '1 | After scenario 1 | ' + story.requests.length);
    T.eq('restored as it was', JSON.parse(await db.loadSnapshot(s1.id)).requests.length, story.requests.length);
    const hist = await db.history();
    T.check('every save kept in the history (newest first)', hist.length === 2 && hist[0].requests === 0 && hist[1].requests === story.requests.length);
    for (let i = 0; i < 55; i++) await db.save(JSON.stringify(fresh));
    T.eq('history keeps the last 50', (await db.history()).length, 50);
    await db.deleteSnapshot(s1.id);
    T.eq('a snapshot deleted', (await db.snapshots()).length, 0);
    await db.close();

    T.section('an older story is upgraded, not thrown away');
    const Store = loadStore();
    const old = JSON.parse(JSON.stringify(F.state('onHire')));
    old.version = 3;
    old.agreements.forEach((a) => { delete a.billing; delete a.minHours; Object.keys(a.rates).forEach((k) => { delete a.rates[k].hour; }); });
    old.requests.forEach((r) => r.lines.forEach((l) => { if (l.price) { delete l.price.billing; delete l.price.hour; delete l.price.minHours; } }));
    const up = Store.upgrade(JSON.parse(JSON.stringify(old)));
    T.eq('version 3 → 5, the same requests', [up.version, up.upgradedFrom, up.requests.length].join(), '5,3,' + old.requests.length);
    T.eq('Customer Y\'s agreement now bills by the hour, with hour rates', [up.agreements.find((a) => a.id === 'RA-01').billing, up.agreements.find((a) => a.id === 'RA-01').rates.GEN.hour].join(), 'HOURLY,52.5');
    T.check('its lines carry the billing', up.requests.every((r) => r.lines.every((l) => !l.price || l.price.billing)));
    T.eq('a story from a newer version is not guessed at', Store.upgrade(Object.assign({}, old, { version: 99 })), null);
    const eng = F.Engine.apply(up, 'advance', { days: 1 });
    T.check('the upgraded story plays on', eng.ok, eng.error);
  } catch (e) {
    T.check('run finished', false, e && e.stack);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
