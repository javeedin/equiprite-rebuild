'use strict';
/*
 * EquipRite Next · Fleet's data (resources/js/fleetData.js over equipmentBoard.build): the three views read page by
 * page and each on its own; when nothing can be read the page names each part and its HTTP status; a part missing
 * or only partly read is said; an odd row (null, a number where text was expected) is left out and counted, never
 * empties the board. Run: node tests/next-fleet.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js');
function load(name, deps) {
  const sandbox = { console, TextEncoder, URLSearchParams, Intl, Date, setTimeout, Promise };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}
const av = load('availabilityData');
const dr = load('directReturn');
const board = load('equipmentBoard');
const F = load('fleetData', { 'resources/js/availabilityData': av, 'resources/js/equipmentBoard': board });

const NOW = Date.UTC(2026, 10, 2, 9);
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const unit = (i, extra) => Object.assign({ unitNumber: 'U-' + String(i).padStart(4, '0'), unitType: 'SERIAL', equipmentName: 'Unit ' + i, className: 'Cls', invOrgName: 'Yard', invOrgId: 1, unitStatus: 'AVAILABLE' }, extra || {});

/** A fake backend: `answers[endpoint]` = rows, a status number (that HTTP error), or 'throw'; pages honour a server cap. */
function backend(answers, cap) {
  const calls = [];
  const call = (o) => {
    calls.push(o.endpoint.split('/')[1] + '?' + Object.keys(o.uriParams).map((k) => k + '=' + o.uriParams[k]).join('&'));
    const a = answers[o.endpoint];
    if (a === 'throw') return Promise.reject(new Error('net::ERR_CONNECTION_RESET'));
    if (typeof a === 'number') return Promise.resolve({ ok: false, status: a, body: { error: 'x' } });
    const rows = a || [];
    const size = Math.min(Number(o.uriParams.size) || 50, cap || 1e9);
    const page = Number(o.uriParams.page) || 0;
    const data = rows.slice(page * size, page * size + size);
    return Promise.resolve({ ok: true, status: 200, body: { data, recordCount: rows.length, hasMore: (page + 1) * size < rows.length, pageSize: size } });
  };
  return { call, calls };
}
const EP = { stock: 'eqp-v1/getEquipriteV1ViewsYardStock', dep: 'eqp-v1/searchDeployedUnits', lines: 'eqp-v1/getEquipriteV1ViewsWorkbenchLines' };

(async () => {
  T.section('a fleet bigger than one page: every unit, read 500 at a time (never one 10,000-row call)');
  const stock = Array.from({ length: 1234 }, (_, i) => unit(i, i === 5 ? { unitStatus: 'RENTED' } : {}));
  const dep = [{ requestLineId: 1, serialNumber: 'U-0005', requestId: 9, requestNumber: 'REQ-9', lineStatus: 'DEPLOYED', startDate: day(-10), endDate: day(-2), overdue: true }];
  const lines = [{ requestNumber: 'REQ-11', requestStatus: 'ALLOCATED', startDate: day(3), endDate: day(9), allocatedSerial: 'U-0007' }];
  let b = backend({ [EP.stock]: stock, [EP.dep]: dep, [EP.lines]: lines });
  let r = await F.load(b.call, NOW);
  T.eq('all 1,234 units, the overdue one and the one going out', [r.units.length, r.ok, r.error, r.notes.length, board.summary(r.units).overdue, board.summary(r.units).going].join(' | '), '1234 | true |  | 0 | 1 | 1');
  T.eq('yard stock in three pages of 500', b.calls.filter((c) => c.startsWith('getEquipriteV1ViewsYardStock')).join(' ; '),
    'getEquipriteV1ViewsYardStock?page=0&size=500 ; getEquipriteV1ViewsYardStock?page=1&size=500 ; getEquipriteV1ViewsYardStock?page=2&size=500');
  T.check('units out: on their way, on site and returning', b.calls.some((c) => c.startsWith('searchDeployedUnits') && c.includes('lineStatus=SHIP_TO_SITE,DEPLOYED,RETURN_INITIATED')));

  T.section('a server that caps the page at 200: it still reads them all, at the size the server used');
  b = backend({ [EP.stock]: stock, [EP.dep]: dep, [EP.lines]: lines }, 200);
  r = await F.load(b.call, NOW);
  T.eq('all 1,234 units over 7 pages', [r.units.length, b.calls.filter((c) => c.startsWith('getEquipriteV1ViewsYardStock')).length].join(), '1234,7');

  T.section('nothing answers: the page says which part and the HTTP status, not just "could not be loaded"');
  r = await F.load(backend({ [EP.stock]: 500, [EP.dep]: 404, [EP.lines]: 'throw' }).call, NOW);
  T.eq('the error names each part', r.error, 'The fleet could not be loaded: the unit list (yard stock) (HTTP 500), units out on rent (HTTP 404), bookings (no answer).');
  T.eq('…and no units', [r.ok, r.units.length].join(), 'false,0');
  r = await F.load(backend({ [EP.stock]: 401, [EP.dep]: 401, [EP.lines]: 401 }).call, NOW);
  T.check('a login problem shows as 401 on each', r.error.split('HTTP 401').length === 4, r.error);

  T.section('one part missing: the rest is shown, and the missing part named');
  r = await F.load(backend({ [EP.stock]: stock.slice(0, 10), [EP.dep]: dep, [EP.lines]: 503 }).call, NOW);
  T.eq('ten units, a note about the bookings', [r.ok, r.units.length, r.notes.join(' ')].join(' | '), 'true | 10 | Not loaded: bookings (HTTP 503). The rest is shown.');

  T.section('a deployed row reads as directReturn reads it (the fields the board uses)');
  const raw = { requestLineId: 3, serialNumber: 'EX-1', unitType: 'SERIAL', requestId: '42', requestNumber: 'REQ-42', customerName: 'Lone Star', lineStatus: 'DEPLOYED',
    startDate: day(-3), endDate: day(4), overdue: false, yardOrgId: '7', yardOrgName: 'Houston Yard', equipmentName: 'Excavator', className: 'Excavators' };
  const mine = F.deployedRow(raw);
  const keys = Object.keys(mine);
  T.check('same values as directReturn\'s own search for every field the board uses', await (async () => {
    const res = await dr.findDeployedUnits(null, { callRest: async () => ({ ok: true, status: 200, body: { data: [raw] } }) }, {});
    return keys.every((k) => JSON.stringify(res.rows[0][k]) === JSON.stringify(mine[k]));
  })(), JSON.stringify(mine));

  T.section('odd rows: left out and counted, never an empty board');
  const odd = [unit(1), null, unit(2, { unitNumber: 4711, equipmentName: 99, className: 7 }), unit(3)];
  r = await F.load(backend({ [EP.stock]: odd, [EP.dep]: [], [EP.lines]: [null, lines[0]] }).call, NOW);
  T.eq('the numeric serial is a unit like any other (null rows dropped)', [r.units.length, r.units.map((u) => u.unit).join(), r.notes.length].join(' | '), '3 | U-0001,4711,U-0003 | 0');
  let lanesOk = true;
  try { board.lanes(r.units, 40); board.options(r.units, 'cls', 10); } catch (e) { lanesOk = false; }
  T.check('…and sorting the lanes with it does not fail', lanesOk);
  const boom = Object.defineProperty(unit(9), 'unitStatus', { get() { throw new Error('bad unitStatus'); }, enumerable: true });
  const out = {};
  const built = board.build([unit(1), boom, unit(3)], [], [], NOW, out);
  T.eq('a row that cannot be read is left out and counted', [built.length, out.skipped, out.firstError].join(' | '), '2 | 1 | bad unitStatus');

  T.report();
})();
