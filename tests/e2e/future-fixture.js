'use strict';
/**
 * EquipRite Future e2e fixture: the demo story played in Node with the real engine up to a chosen point, then put in
 * the browser's localStorage before the app loads, so a screen can be tested at that point without the others.
 *
 *   const F = require('./future-fixture');
 *   const s = F.state('invoiced');                 // 'fresh' | 'raised' | 'onHire' | 'monthEnd' | 'released' | 'agreed' | 'invoiced' | 'settled' | 'returned'
 *   const env = await E.start({ port, app: 'future', init: F.init(s, 'p-fin') });   // optionally play as someone
 *   F.ids(s)  → { r1, r2, rk, r3, rl }: the requests of the story (S1, S2, KSA, S3, same company)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', '..', 'webApps', 'equiprite-future', 'resources', 'js', 'future');
const KEY = 'equiprite-future:state:v3';
const mods = {};
function load(name) {
  if (mods[name]) return mods[name];
  const sandbox = { console, JSON, Math, Date, Object, Array, String, Number, Error };
  sandbox.define = (deps, factory) => { mods[name] = factory(...deps.map((d) => load(d.split('/').pop()))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(DIR, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mods[name];
}
const Seed = load('fxSeed');
const Engine = load('fxEngine');
const Views = load('fxViews');

const STEPS = ['fresh', 'raised', 'onHire', 'monthEnd', 'released', 'agreed', 'invoiced', 'settled', 'returned'];

function state(upTo) {
  const stop = STEPS.indexOf(upTo || 'fresh');
  if (stop === -1) throw new Error('Unknown fixture point ' + upTo);
  let s = Seed.seed();
  const as = (id) => { s = Engine.apply(s, 'setPersona', { id }).state; };
  const act = (type, payload) => {
    const r = Engine.apply(s, type, payload);
    if (!r.ok) throw new Error('fixture: ' + type + ' failed: ' + r.error);
    s = r.state;
    return r.result;
  };
  const line = (id) => s.requests.find((r) => r.id === id).lines[0];
  if (stop < 1) return s;
  as('p-pm');
  const r1 = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-03', to: '2026-12-20', lines: [{ cls: 'EXC', unitId: 'U-EX1' }] }).id;
  const r2 = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-EXT', from: '2026-11-03', to: '2026-12-31', lines: [{ cls: 'CRN', unitId: 'U-CR1' }] }).id;
  as('p-pk');
  const rk = act('createRequest', { requestingBu: 'BU-PK', projectId: 'P-KSA', from: '2026-11-05', to: '2026-12-31', lines: [{ cls: 'GEN', unitId: 'U-GN1' }] }).id;
  as('p-desk');
  const r3 = act('createRequest', { requestingBu: 'BU-FC', customerId: 'C-Y', from: '2026-11-06', to: '2026-11-25', lines: [{ cls: 'GEN', unitId: 'U-GN2' }] }).id;
  as('p-pm');
  const rl = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-07', to: '2026-11-30', lines: [{ cls: 'TWR', unitId: 'U-TW1' }] }).id;
  s.fixtureIds = { r1, r2, rk, r3, rl };
  if (stop < 2) return s;
  as('p-desk'); act('takeDeposit', { requestId: r3 });
  as('p-em');
  [[r1, 'U-EX1'], [r2, 'U-CR1'], [rk, 'U-GN1'], [r3, 'U-GN2']].forEach(([r, u]) => act('approveLine', { requestId: r, lineId: line(r).id, unitId: u }));
  as('p-pf'); act('approveLine', { requestId: rl, lineId: line(rl).id, unitId: 'U-TW1' }); act('shipLine', { requestId: rl, lineId: line(rl).id });
  as('p-yard'); [r1, r2, rk, r3].forEach((r) => act('shipLine', { requestId: r, lineId: line(r).id }));
  act('advance', { days: 5 });
  as('p-site'); [r1, r2, rl].forEach((r) => act('receiveLine', { requestId: r, lineId: line(r).id }));
  as('p-pk'); act('receiveLine', { requestId: rk, lineId: line(rk).id });
  as('p-desk'); act('receiveLine', { requestId: r3, lineId: line(r3).id });
  if (stop < 3) return s;
  as('p-fin'); act('toMonthEnd');
  as('p-site'); [r1, r2, rl].forEach((r) => act('fillHours', { requestId: r, lineId: line(r).id }));
  as('p-pm'); [r1, r2, rl].forEach((r) => act('approveHours', { requestId: r, lineId: line(r).id }));
  as('p-pk'); act('fillHours', { requestId: rk, lineId: line(rk).id }); act('approveHours', { requestId: rk, lineId: line(rk).id });
  as('p-fin'); act('runCharges', {});
  if (stop < 4) return s;
  s.statements.forEach((st) => act('releaseStatement', { statementId: st.id }));
  if (stop < 5) return s;
  as('p-pcfin'); act('acceptStatement', { statementId: s.statements.find((x) => x.receiver === 'BU-PC').id });
  as('p-pk'); act('acceptStatement', { statementId: s.statements.find((x) => x.receiver === 'BU-PK').id });
  if (stop < 6) return s;
  as('p-fin'); s.statements.forEach((st) => act('createInvoicePair', { statementId: st.id }));
  act('postInternal', {});
  as('p-desk'); act('invoiceCustomer', {});
  if (stop < 7) return s;
  as('p-fin'); s.statements.forEach((st) => act('settle', { statementId: st.id }));
  as('p-pcfin'); act('billProject', { projectId: 'P-EXT' });
  if (stop < 8) return s;
  as('p-desk'); act('offHire', { requestId: r3, lineId: line(r3).id });
  as('p-site'); act('offHire', { requestId: r1, lineId: line(r1).id });
  as('p-yard'); [r3, r1].forEach((r) => { act('returnLine', { requestId: r, lineId: line(r).id }); act('inspectLine', { requestId: r, lineId: line(r).id, damage: r === r3 ? 1500 : 0, note: r === r3 ? 'Cracked panel' : '', photos: 3 }); });
  return s;
}

function ids(s) { return s.fixtureIds || {}; }

/** An init script for E.start: the state (and who is played) in localStorage before the app loads. */
function init(s, personaId) {
  const st = Object.assign({}, s, personaId ? { personaId } : {});
  const json = JSON.stringify(st);
  return new Function('try { if (!sessionStorage.getItem("fx-fixture")) { localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(json)
    + '); sessionStorage.setItem("fx-fixture", "1"); } } catch (e) {}');
}

module.exports = { state, ids, init, Seed, Engine, Views, KEY, STEPS };
