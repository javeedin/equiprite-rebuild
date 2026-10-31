/*
 * EquipRite Future · the owner and the site (resources/js/future/fxOps.js): what Approve & allocate, Yard and Receive,
 * hours, moves show beyond their views, and the confirmation every action shows first (a dry run of the engine: what
 * EquipRite does, what Fusion would do, who is told). The story is played through the real engine (fxEngine.apply).
 * Also: the roles fxOps gives each action are the engine's own, a preview never changes the state, and every list exports.
 *
 * Run:  node tests/future-ops.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const APP = path.join(__dirname, '..', 'webApps', 'equiprite-future');
const mods = {};
function load(id) {
  if (mods[id]) return mods[id];
  const file = path.join(APP, id + '.js');
  const sandbox = { console, JSON, Math, Date, Object, Array, String, Number, Boolean, Error };
  sandbox.define = (deps, factory) => { mods[id] = factory(...deps.map(load)); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return mods[id];
}
const Seed = load('resources/js/future/fxSeed');
const E = load('resources/js/future/fxEngine');
const O = load('resources/js/future/fxOps');

let s = Seed.seed();
const as = (id) => { s = E.apply(s, 'setPersona', { id }).state; };
const act = (type, payload) => { const r = E.apply(s, type, payload); if (r.ok) s = r.state; else T.check(type + ' worked', false, r.error); return r; };
const line = (rid) => s.requests.find((r) => r.id === rid).lines[0];
const json = (x) => JSON.stringify(x);

T.section('the roles of each action are the engine\'s');
const someone = { approveLine: 'p-pm', rejectLine: 'p-yard', shipLine: 'p-em', returnLine: 'p-desk', inspectLine: 'p-site', repairDone: 'p-pm', receiveLine: 'p-em',
  logHours: 'p-pm', fillHours: 'p-pcfin', logHoursBulk: 'p-pcfin', approveHours: 'p-site', reportBreakdown: 'p-pcfin', offHire: 'p-pcfin', redeploy: 'p-pcfin', moveToCompany: 'p-site', reportLoss: 'p-yard' };
T.eq('every action fxOps knows', Object.keys(O.WHO).sort().join(), Object.keys(someone).sort().join());
const wrong = [];
Seed.PERSONAS.forEach((p) => {
  Object.keys(O.WHO).forEach((type) => {
    const st = E.apply(Seed.seed(), 'setPersona', { id: p.id }).state;
    const r = E.apply(st, type, {});
    const engineRefusesRole = !r.ok && /cannot do this/.test(r.error);
    if (O.may(st, type) === engineRefusesRole) wrong.push(p.name + ' ' + type);
  });
});
T.eq('a button shows exactly when the engine would take the action from that person', wrong.join('; '), '');

T.section('Approve & allocate: the sourcing BU\'s lines');
as('p-pm');
const r1 = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-03', to: '2026-12-20', lines: [{ cls: 'EXC', unitId: 'U-EX1' }] }).result.id;
as('p-pk');
const rk = act('createRequest', { requestingBu: 'BU-PK', projectId: 'P-KSA', from: '2026-11-05', to: '2026-12-31', lines: [{ cls: 'GEN', unitId: 'U-GN1' }] }).result.id;
as('p-desk');
const r3 = act('createRequest', { requestingBu: 'BU-FC', customerId: 'C-Y', from: '2026-11-06', to: '2026-11-25', lines: [{ cls: 'GEN', unitId: 'U-GN2' }] }).result.id;
as('p-pm');
const rl = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-07', to: '2026-11-30', lines: [{ cls: 'TWR', unitId: 'U-TW1' }] }).result.id;
as('p-em');
let a = O.approvals(s);
T.eq('Ana: FleetCo\'s lines, by the sourcing BU', [a.scope, a.rows.map((x) => x.number).join()].join(' | '), 'Lines that use the fleet of FleetCo Fleet | FR-1001,FR-1002,FR-1003');
T.eq('the empty words name the BU', a.empty, 'Nothing to approve for FleetCo Fleet');
const a1 = a.rows[0];
T.eq('a line\'s facts', [a1.company, a1.buName, a1.forMain, a1.site, a1.country, a1.dates, a1.days, a1.relationLabel, a1.agreement, a1.price, a1.requester.name].join(' | '),
  'ProjectCo | ProjectCo Projects | PC-INT-014 · ProjectCo head office fit-out | Business Bay, Dubai | United Arab Emirates | 3 Nov – 20 Dec 2026 | 48 days | Intercompany · domestic | ICA-FC-PC-2026 v1 | AED 3,500.00/week or AED 800.00/day | Priya Raman');
T.eq('options: the preferred first, then the usable, each with why', a1.options.map((o) => o.serial + (o.preferred ? '*' : '') + (o.usable ? '+' : '-')).join(), 'EX-1001*+,EX-1002+,EX-1003+');
T.eq('…chosen by default: the preferred one', a1.defaultPick, 'U-EX1');
const ak = a.rows.find((x) => x.requestId === rk);
T.eq('a unit without the site country\'s certificate cannot go, and says so', ak.options.map((o) => o.serial + ': ' + o.why).join(' | '),
  'GN-3001: Free for these dates · Electrical test to 31 Aug 2027 | GN-3002: No certificate for Saudi Arabia');
T.check('what approving stock across the border sets off: the yard, a transfer order inside FleetCo (GR-6), a temporary import',
  /yard \(Ravi Kumar\) is told to ship GN-3001/.test(ak.options[0].setsOff.map((x) => x.text).join(' '))
  && /transfer order inside FleetCo: FleetCo Jebel Ali Yard → FleetCo deployed · KSA sites \(GR-6\)/.test(ak.options[0].setsOff.map((x) => x.text).join(' '))
  && /temporary import opens when it ships/.test(ak.options[0].setsOff.map((x) => x.text).join(' ')));
T.check('…an asset: a location update, no accounting', /location of asset FA-10021: no accounting/.test(a1.options[0].setsOff.map((x) => x.text).join(' ')));
T.eq('the relationship chips', a.chips.map((c) => c.key + ':' + c.count).join(), 'all:3,IC_DOMESTIC:1,IC_CROSS_BORDER:1,CUSTOMER:1');
T.eq('…and a chip filters', O.byRelation(a.rows, 'IC_CROSS_BORDER').map((x) => x.number).join(), 'FR-1002');
const a3 = a.rows.find((x) => x.requestId === r3);
T.check('the customer rental without its deposit says so; the desk plays it', a3.needsDeposit && /deposit \(25 % of a month\) has not been received/.test(a3.depositText) && a3.depositBy.id === 'p-desk');
as('p-pf');
T.eq('Huda: Facilities\' own line only', O.approvals(s).rows.map((x) => x.number).join(), 'FR-1004');
as('p-pm');
T.eq('Priya approves nothing', [O.approvals(s).count, O.approvals(s).canApprove].join(), '0,false');

T.section('the confirmation: a dry run, never a change');
as('p-em');
const before = json(s);
let q = O.ask(s, 'approve', { requestId: r1, lineId: line(r1).id, unitId: 'U-EX1' }, null);
T.eq('nothing changes before Confirm', json(s) === before, true);
T.eq('approve: words, action and payload', [q.def.title, q.def.confirm, q.preview.type, json(q.preview.payload), q.preview.ok].join(' | '),
  'Approve FR-1001 with EX-1001 | Approve and allocate EX-1001 | approveLine | {"requestId":"R1001","lineId":"L1","unitId":"U-EX1"} | true');
T.eq('…nothing in Fusion yet', [q.preview.txs.length, q.preview.fusion[0]].join(' | '), '0 | Nothing in Fusion at approval.');
T.eq('…who is told', q.preview.told.map((t) => t.who + ': ' + t.text).join(' / '),
  'Priya Raman and Omar Haddad: FR-1001: EX-1001 approved by FleetCo Fleet. / Ana Costa and Ravi Kumar: Ship EX-1001 for FR-1001 to Business Bay, Dubai (AE).');
q = O.ask(s, 'refuse', { requestId: r1, lineId: line(r1).id }, null);
T.eq('refuse without a reason: the engine\'s words, before', [q.def.fields.map((f) => f.key + (f.required ? '*' : '')).join(), q.preview.ok, q.preview.warn].join(' | '), 'reason* | false | Say why (the requester sees it).');
q = O.ask(s, 'refuse', { requestId: r1, lineId: line(r1).id }, { reason: '  Booked  ' });
T.eq('…with one: the payload carries it, trimmed', [q.preview.ok, q.preview.payload.reason].join(), 'true,Booked');
T.eq('a line gone: said in words', O.ask(s, 'ship', { requestId: 'R9', lineId: 'L9' }).preview.warn, 'This line is not here any more.');
[[r1, 'U-EX1'], [rk, 'U-GN1']].forEach(([r, u]) => act('approveLine', { requestId: r, lineId: line(r).id, unitId: u }));

T.section('the yard: ship (asset, stock across the border), the fleet');
as('p-yard');
let y = O.yard(s);
T.eq('to ship, with what Fusion does', y.toShip.map((x) => x.number + ': ' + x.fusion + (x.cross ? ' + ' + x.crossText : '')).join(' | '),
  'FR-1001: Asset location update, no accounting | FR-1002: Transfer order inside FleetCo: FleetCo Jebel Ali Yard → FleetCo deployed · KSA sites + Temporary import into Saudi Arabia: pro-forma invoice, packing list, certificates');
q = O.ask(s, 'ship', { requestId: rk, lineId: line(rk).id });
T.eq('shipping stock: the transfer order inside FleetCo and its accounting (shown)', q.preview.txs.map((t) => [t.kindText, t.company, t.number, t.lines.map((l) => l.account + (l.dr ? ' Dr ' + l.dr : ' Cr ' + l.cr)).join(', ')].join(' · ')).join(),
  'Transfer order shipped · FleetCo · FC-TO-000001 · 1310 Dr 95,000.00, 1300 Cr 95,000.00');
T.eq('…the temporary import', q.preview.customs.map((c) => c.permit).join(), 'TI-SA-00001');
T.check('…and the GR-6 words', /transfer order inside FleetCo, from FleetCo Jebel Ali Yard to FleetCo deployed · KSA sites \(GR-6/.test(q.preview.fusion[0]));
q = O.ask(s, 'ship', { requestId: r1, lineId: line(r1).id });
T.eq('shipping an asset: a location update, no accounting', q.preview.txs.map((t) => t.kindText + ':' + t.lines.length + ':' + t.noAccounting).join(), 'Asset location update:0:true');
T.eq('…the transport out', q.preview.money.join(), 'Transport out: AED 1,500.00 on this month\'s charges (ICA-FC-PC-2026).');
[r1, rk].forEach((r) => act('shipLine', { requestId: r, lineId: line(r).id }));
y = O.yard(s);
T.eq('out: where each unit is', y.out.map((x) => x.serial + ' · ' + x.where + ' · ' + x.whereCountry + (x.customs ? ' · ' + x.customs : '')).join(' | '),
  'EX-1001 · On the way to Business Bay, Dubai · United Arab Emirates | GN-3001 · On the way to Riyadh · United Arab Emirates · TI-SA-00001 · re-export by 30 Jan 2027');
const gn = y.fleet.find((u) => u.serial === 'GN-3001');
T.eq('the fleet: status, asset or stock, value, certificates by country, customs', [gn.statusText, gn.holdText, gn.ref, gn.value, gn.certs.map((c) => c.text).join('; '), gn.customs.map((c) => c.text).join()].join(' | '),
  'Out | Stock | EQ-GEN-200 | AED 95,000.00 | AE · Electrical test · to 31 Aug 2027; SA · Electrical test · to 31 Aug 2027 | TI-SA-00001 · AE → SA · re-export by 30 Jan 2027');
act('advance', { days: 20 });
const ex3 = O.yard(s).fleet.find((u) => u.serial === 'EX-1003').certs.find((c) => c.country === 'SA');
T.eq('an expired certificate is marked', [ex3.expired, ex3.text].join(' | '), 'true | SA · SASO conformity · expired 20 Nov 2026');

T.section('on site: receive, the hours grid, the moves');
s = Seed.seed();
as('p-pm');
const p1 = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-03', to: '2026-12-20', lines: [{ cls: 'EXC', unitId: 'U-EX3' }] }).result.id;
as('p-em'); act('approveLine', { requestId: p1, lineId: line(p1).id, unitId: 'U-EX3' });
as('p-yard'); act('shipLine', { requestId: p1, lineId: line(p1).id });
as('p-site');
let v = O.site(s);
T.eq('to receive: stock, so the transfer order is received into FleetCo\'s UAE deployment org', v.toReceive.map((x) => x.serial + ': ' + x.fusion).join(), 'EX-1003: Transfer order FC-TO-000001 received into FleetCo deployed · UAE sites');
q = O.ask(s, 'receive', { requestId: p1, lineId: line(p1).id });
T.eq('…its confirmation: the hire starts, the transfer order received (accounting shown)', [q.preview.does[1], q.preview.txs.map((t) => t.kindText + ' · ' + t.lines.map((l) => l.account).join('/')).join()].join(' | '),
  'The hire starts 2 Nov 2026 (OD-05: at receipt on site), at AED 3,500.00/week or AED 800.00/day. | Transfer order received · 1320/1310');
act('advance', { days: 1 });
act('receiveLine', { requestId: p1, lineId: line(p1).id });
act('advance', { days: 6 });
v = O.site(s);
let hr = v.onHire[0];
T.eq('the days on hire up to today, the UAE weekend marked', hr.grid.map((g) => g.dow + g.day + (g.weekend ? 'w' : '')).join(' '), 'Tue3 Wed4 Thu5 Fri6 Sat7w Sun8w Mon9');
T.eq('who may do what: Omar (site)', json(v.can), '{"receive":true,"fill":true,"log":true,"approve":false,"breakdown":true,"offHire":true,"redeploy":true,"handover":false,"loss":true,"timesheet":true}');
q = O.ask(s, 'fill', { requestId: p1, lineId: line(p1).id });
T.check('Record standard hours: how many working days, the weekend left out', /^Records 5 working days not yet recorded, 3 Nov – 9 Nov/.test(q.preview.does[0]) && /\(Sat–Sun\)/.test(q.preview.does[1]));
act('fillHours', { requestId: p1, lineId: line(p1).id });
q = O.ask(s, 'log', { requestId: p1, lineId: line(p1).id, date: '2026-11-07' }, { usage: '5', standby: '2' });
T.eq('one day: its fields and payload', [q.def.fields.map((f) => f.key + '=' + f.initial).join(), json(q.preview.payload)].join(' | '),
  'usage=0,standby=0 | {"requestId":"R1001","lineId":"L1","date":"2026-11-07","usage":5,"standby":2}');
act('logHours', q.preview.payload);
hr = O.site(s).onHire[0];
T.eq('the grid: waiting days, the weekend day worked', hr.grid.map((g) => g.state + ':' + g.text).join(' '), 'waiting:8 h waiting:8 h waiting:8 h waiting:8 h waiting:5 h weekend:Off waiting:4 h');
T.eq('…the totals', [hr.recorded, hr.usage, hr.standby, hr.waiting, hr.approvers].join(' | '), '6 | 41 | 6 | 6 | Priya Raman or Mark Lee');
T.eq('the moves and what each means for the money', [hr.moves.breakdown, hr.moves.offHire, hr.moves.loss].join(' | '),
  'A credit of AED 800.00 a day off this month\'s charges (ICA-FC-PC-2026). | Pick the return date: the hire stops that day (a later date is booked and happens by itself), with the final timesheet and the final bill. '
  + 'By the day: returned today, charged up to 8 Nov 2026. Minimum hire 7 days: 1 more day charged. Transport back AED 1,500.00. | Charged at AED 462,000.00: net book value AED 420,000.00 + 10 % (OD-11).');
q = O.ask(s, 'breakdown', { requestId: p1, lineId: line(p1).id }, { days: '3', reason: 'Track' });
T.eq('a breakdown: the credit', q.preview.money.join(), 'A credit of 3 × AED 800.00 = AED −2,400.00 on this month\'s charges (ICA-FC-PC-2026 gives a breakdown credit).');
q = O.ask(s, 'redeploy', { requestId: p1, lineId: line(p1).id });
T.eq('another project of the same BU', [q.def.fields[0].options.map((o) => o.value).join(), q.preview.ok, q.preview.does[1]].join(' | '),
  'P-EXT | true | Charges from today go to PC-C-2207; up to 8 Nov 2026 they stay on PC-INT-014.');
as('p-pm');
q = O.ask(s, 'handover', { requestId: p1, lineId: line(p1).id });
T.eq('another group company on site: only the same country\'s, never the owner', q.def.fields[0].options.map((o) => o.value).join(), 'P-FAC');
T.check('…no sub-lending', q.preview.ok && /No sub-lending: FleetCo bills ProjectCo Facilities directly under ICA-FC-PF-2026/.test(q.preview.does.join(' ')));
as('p-pcfin');
q = O.ask(s, 'loss', { requestId: p1, lineId: line(p1).id });
T.eq('lost: Mark (finance) may not; the site or the owner may', [q.preview.ok, O.may(s, 'reportLoss')].join(), 'false,false');
as('p-site');
q = O.ask(s, 'loss', { requestId: p1, lineId: line(p1).id });
T.eq('…the stock issued out of FleetCo\'s inventory, from the deployment org', q.preview.txs.map((t) => t.kindText + ' · ' + t.lines.map((l) => l.account).join('/')).join(), 'Stock issued (lost) · 1520/1320/4310');
as('p-pm');
q = O.ask(s, 'approveHours', { requestId: p1, lineId: line(p1).id });
T.eq('approve the hours: how many, who is told', [q.preview.does[0], q.preview.told.map((t) => t.who).join()].join(' | '),
  'Approves 6 days of hours, 3 Nov – 9 Nov: 41 h of use, 6 h of standby. | Ana Costa');

T.section('return and inspect: damage, the threshold, photos');
as('p-site'); act('offHire', { requestId: p1, lineId: line(p1).id });
as('p-yard');
y = O.yard(s);
T.eq('to collect: a return transfer order inside FleetCo', y.toCollect.map((x) => x.fusion).join(), 'Return transfer order inside FleetCo: FleetCo deployed · UAE sites → FleetCo Jebel Ali Yard');
T.eq('…returned by the site on its date', y.toCollect.map((x) => x.offHire).join(), 'Returned by the site on 9 Nov 2026, to collect');
q = O.ask(s, 'return', { requestId: p1, lineId: line(p1).id });
T.eq('…its accounting, shown', q.preview.txs.map((t) => t.kindText + ' · ' + t.lines.length + ' lines').join(), 'Return transfer order · 4 lines');
act('returnLine', { requestId: p1, lineId: line(p1).id });
q = O.ask(s, 'inspect', { requestId: p1, lineId: line(p1).id }, null);
T.eq('inspect: passed by default', [q.form.result, json(q.preview.payload), q.preview.ok].join(' | '), 'pass | {"requestId":"R1001","lineId":"L1","damage":0,"note":"","photos":0} | true');
q = O.ask(s, 'inspect', { requestId: p1, lineId: line(p1).id }, { result: 'damage', damage: '7500', photos: '0', note: 'Dent' });
T.eq('damage without photos: refused in words', q.preview.warn, 'A damage charge needs photos (MC-FR-29).');
q = O.ask(s, 'inspect', { requestId: p1, lineId: line(p1).id }, { result: 'damage', damage: '7500', photos: '2', note: 'Dent' });
T.eq('damage above the threshold needs the user\'s acceptance (OD-11)', q.preview.does[1], 'Above AED 5,000.00 (OD-11): ProjectCo Projects must accept it on the statement before it is invoiced.');
act('inspectLine', q.preview.payload);
y = O.yard(s);
T.eq('in repair, with the damage and the inspection', y.repairs.map((x) => [x.serial, x.damage, x.note].join(' | ')).join(), 'EX-1003 | AED 7,500.00 on FR-1001 | Dent · 2 photos · 9 Nov 2026 by Ravi Kumar');

T.section('every list exports');
const lists = { approvals: (as('p-em'), O.approvals(s)), yard: (as('p-yard'), O.yard(s)), site: (as('p-pm'), O.site(s)) };
const specs = ['toShip', 'out', 'toCollect', 'toInspect', 'repairs', 'fleet'].map((k) => O.exportSpec(lists.yard, k)).concat([O.exportSpec(lists.site, 'toReceive'), O.exportSpec(lists.site, 'onHire'), O.exportSpec(lists.approvals, 'approvals')]);
T.check('each with columns and a title', specs.every((x) => x.columns.length > 3 && x.title), specs.map((x) => x.title + ':' + x.columns.length).join());
T.eq('the fleet: one row a unit', [O.exportSpec(lists.yard, 'fleet').rows.length, O.exportSpec(lists.yard, 'fleet').name].join(), '8,yard-the-fleet');
const csv = load('resources/js/exportKit').csv(O.exportSpec(lists.yard, 'repairs').rows, O.exportSpec(lists.yard, 'repairs').columns);
T.check('…exportKit writes it', csv.indexOf('EX-1003') !== -1 && csv.indexOf('Unit,Equipment,Yard,Damage,Inspection') !== -1, csv);

T.section('a customer rental on site (Lena, the rental desk)');
const fx3 = require('./e2e/future-fixture').state('onHire');
s = E.apply(fx3, 'setPersona', { id: 'p-desk' }).state;
const rent = O.site(s).onHire;
T.eq('her customer\'s unit, shown with the customer, not a project', rent.map((x) => [x.serial, x.rental, x.forLabel, x.customer, x.segments.length].join(' | ')).join(),
  'GN-3002 | true | Customer | Customer Y · Gulf Builders · customer rental | 0');
T.eq('no project to move to, no group company to hand it to', [rent[0].canRedeploy, rent[0].canHandover, rent[0].moves.handover].join(' | '),
  'false | false | The customer has it: return it, then raise a request for the group company.');
T.eq('the desk receives, records the customer\'s hours (the engine lets the desk log and fill them) and returns; the site\'s own moves are not hers', json(O.site(s).can),
  '{"receive":true,"fill":true,"log":true,"approve":true,"breakdown":false,"offHire":true,"redeploy":true,"handover":true,"loss":false,"timesheet":true}');
T.eq('…billed by the hour, said on the card', [rent[0].billingText, rent[0].price, rent[0].moves.breakdown].join(' | '),
  'Billed by the hour | AED 52.50/hour, by the hour (at least 16 h per hire) | Billed by the hour: the hours it cannot work stay off the timesheet, so nothing is charged for them (no credit needed).');

T.section('the return on a date: the final timesheet and the final bill (fxReturn)');
const Rt = load('resources/js/future/fxReturn');
act('advance', { days: 7 });
const ry = fx3.fixtureIds.r3;
const ly = line(ry).id;
act('fillHours', { requestId: ry, lineId: ly });
let o = Rt.open(s, { requestId: ry, lineId: ly });
const rowsOf = (rows) => rows.map((r) => r.label + (r.weekend ? 'w' : '') + (r.planned ? 'p' : '') + (r.returnDay ? 'R' : '') + ':' + r.usage).join(' ');
T.eq('Return opens on the request\'s end (after today), the timesheet from the start of the hire to the return day (by the hour), planned after today',
  [o.def.mode, o.def.title, o.draft.date, o.def.datesText, rowsOf(o.def.rows)].join(' | '),
  'return | Return GN-3002 | 2026-11-25 | Requested 6 Nov – 25 Nov 2026 · on hire since 7 Nov 2026 | Sat 7 Novw: Sun 8 Novw: Mon 9 Nov:8 Tue 10 Nov:8 Wed 11 Nov:8 Thu 12 Nov:8 Fri 13 Nov:4 Sat 14 Novw: '
  + 'Sun 15 Novwp: Mon 16 Novp:8 Tue 17 Novp:8 Wed 18 Novp:8 Thu 19 Novp:8 Fri 20 Novp:8 Sat 21 Novwp: Sun 22 Novwp: Mon 23 Novp:8 Tue 24 Novp:8 Wed 25 NovpR:8');
T.eq('…the rental desk may agree the hours up to today: signed by the customer', [o.def.canApprove, o.def.approveLabel].join(' | '), 'true | The hours up to today are agreed (signed by the customer, Customer Y)');
let draft = { date: '2026-11-12', usage: {}, standby: {}, approve: true };
let dv = Rt.def(s, { requestId: ry, lineId: ly }, '2026-11-12', draft);
T.eq('two days ago, by the hour: the rows run to the return day, labelled so', [dv.rows.map((r) => r.date.slice(8)).join(), dv.rows.filter((r) => r.returnDay).map((r) => r.date).join(), dv.ruleText, dv.approveLabel].join(' | '),
  '07,08,09,10,11,12 | 2026-11-12 | By the hour, the return day counts: its hours are on the timesheet. | These hours are agreed (signed by the customer, Customer Y)');
const before3 = json(s);
let pv = Rt.preview(s, dv, draft);
T.eq('the preview changes nothing', json(s) === before3, true);
T.eq('what it says: the date, the return day\'s hours counted, the hours after it dropped', [pv.ok, pv.planned, pv.whenText, pv.droppedText].join(' | '),
  'true | false | Returned on Thu 12 Nov 2026: the hire stops that day; by the hour, the hours of the return day count too. | Hours recorded on 13 Nov are dropped: the hire stops on 12 Nov 2026 (its hours count, not the days after).');
T.eq('the final bill: hours × the hour rate (the return day\'s too), transport out and back, VAT for the customer', [pv.bill.heading, pv.bill.rows.map((r) => r.label + ' ' + r.detail + ' ' + r.amountText).join(' ; '), pv.bill.totalText, pv.bill.vat.amountText, pv.bill.grossText, pv.bill.chargedText, pv.bill.toChargeText].join(' | '),
  'The final bill | Rental 32 h of use × AED 52.50 an hour AED 1,680.00 ; Transport out to the site AED 2,200.00 ; Transport back when the yard collects it AED 2,200.00 | AED 6,080.00 | AED 304.00 | AED 6,384.00 | AED 0.00 | AED 6,080.00');
T.check('…damage after the inspection', pv.bill.damageNote === 'Damage, if any, is added after the yard’s inspection.');
T.eq('the payloads: the timesheet agreed (nothing changed), then the return', json([pv.bulk, pv.offHire]),
  '[{"requestId":"R1004","lineId":"L4","days":[],"approve":true,"until":"2026-11-12"},{"requestId":"R1004","lineId":"L4","date":"2026-11-12"}]');
draft = Object.assign({}, draft, { usage: { '2026-11-10': '6' }, standby: { '2026-11-10': '2' } });
pv = Rt.preview(s, dv, draft);
T.eq('a day changed: only it goes, and the bill follows', [json(pv.bulk.days), pv.states['2026-11-10'].text, pv.bill.rows.map((r) => r.label + ' ' + r.amountText).slice(0, 2).join(', '), pv.bill.totalText].join(' | '),
  '[{"date":"2026-11-10","usage":6,"standby":2}] | Changed | Rental AED 1,575.00, Standby AED 52.50 | AED 6,027.50');
T.eq('the toast', pv.toast, 'GN-3002 returned on 12 Nov 2026: 6 days with the return day, 30 h of use, final bill AED 6,027.50 + VAT 5 % AED 301.38.');
T.eq('more than 24 hours a day: said, not sent', Rt.preview(s, dv, Object.assign({}, draft, { usage: { '2026-11-10': '23' } })).warn, 'Tue 10 Nov 2026: give hours from 0 to 24, use and standby together at most 24.');
T.eq('before the hire started: the engine\'s words', Rt.preview(s, Rt.def(s, { requestId: ry, lineId: ly }, '2026-11-05', draft), Object.assign({}, draft, { date: '2026-11-05' })).warn,
  'The return date cannot be before the hire started (7 Nov 2026).');
const mini = Rt.preview(s, Rt.def(s, { requestId: ry, lineId: ly }, '2026-11-09', draft), Object.assign({}, draft, { date: '2026-11-09', usage: {}, standby: {} }));
T.eq('a short hire (returned on 9 Nov, its 8 h counted): the minimum of 16 hours tops it up at the return', mini.bill.rows.filter((r) => r.kind !== 'TRANSPORT').map((r) => r.label + ' · ' + r.detail + ' · ' + r.amountText).join(' ; '),
  'Rental · 8 h of use × AED 52.50 an hour · AED 420.00 ; Minimum 16 hours per hire · top-up of 8 h × AED 52.50 · AED 420.00');
const mini2 = Rt.preview(s, Rt.def(s, { requestId: ry, lineId: ly }, '2026-11-10', draft), Object.assign({}, draft, { date: '2026-11-10', usage: {}, standby: {} }));
T.eq('…returned on 10 Nov: 9 and 10 Nov make the 16 hours, no top-up', mini2.bill.rows.filter((r) => r.kind !== 'TRANSPORT').map((r) => r.label + ' · ' + r.detail + ' · ' + r.amountText).join(' ; '),
  'Rental · 16 h of use × AED 52.50 an hour · AED 840.00');
act(pv.bulk ? 'logHoursBulk' : 'x', pv.bulk);
act('offHire', pv.offHire);
const ly2 = line(ry);
const hy = s.hours.filter((x) => x.lineId === ly).sort((a, b) => a.date.localeCompare(b.date));
T.eq('returned on the date, the hours agreed, signed by the customer, the return day\'s kept, none after it', [ly2.status, ly2.events.offHire, hy.map((x) => x.date.slice(8) + ':' + x.usage + '/' + x.standby).join(' '),
  hy.every((x) => x.approved && x.approvedBy === 'Lena Novak (signed by the customer)')].join(' | '), 'OFF_HIRED | 2026-11-12 | 09:8/0 10:6/2 11:8/0 12:8/0 | true');
let bl = Rt.bill(s, ry, ly, null);
T.eq('the bill afterwards (the request\'s Money tab): the same total, all still to charge', [bl.mode, bl.modeText, bl.basisShort, bl.totalText, bl.chargedText, bl.toChargeText].join(' | '),
  'final | Returned 12 Nov 2026: on hire 7 Nov – 12 Nov 2026 (6 days, the return day included) | By the hour: from the approved timesheet | AED 6,027.50 | AED 0.00 | AED 6,027.50');
T.eq('…and no timesheet left open', O.returned(s).length, 0);

T.section('a planned return: booked, then the clock reaches it (Omar)');
s = E.apply(require('./e2e/future-fixture').state('onHire'), 'setPersona', { id: 'p-site' }).state;
const rx = s.fixtureIds.r1;
const lx = line(rx).id;
o = Rt.open(s, { requestId: rx, lineId: lx });
T.eq('Omar may not agree the hours: who does is named', [o.def.canApprove, o.def.waitText].join(' | '), 'false | They wait for the approval of Priya Raman or Mark Lee; the bill counts them once approved.');
draft = { date: '2026-11-12', usage: {}, standby: {}, approve: false };
dv = Rt.def(s, { requestId: rx, lineId: lx }, '2026-11-12', draft);
pv = Rt.preview(s, dv, draft);
T.eq('in 5 days: a planned return; by the day the timesheet stops the day before the return, planned after today', [pv.planned, pv.whenText, pv.confirm, dv.rows.map((r) => r.date.slice(8) + (r.planned ? 'p' : '') + (r.returnDay ? 'R' : '')).join(), dv.ruleText].join(' | '),
  'true | Planned return: the hire stops by itself on 12 Nov 2026. Until then, record the hours as the days pass; the final timesheet is asked for on the day. | Book the return for 12 Nov 2026 | 07,08p,09p,10p,11p | '
  + 'By the day, the return day is not charged: the timesheet stops the day before.');
T.eq('…the estimated bill at the return: by the day, the actual day and the planned ones apart', [pv.bill.mode, pv.bill.heading, pv.bill.rows.map((r) => r.label + ' ' + r.amountText).join(', '), pv.bill.totalText, pv.bill.notes[0]].join(' | '),
  'planned | Estimated final bill | Rental, actual AED 800.00, Rental, planned AED 2,700.00, Transport out AED 1,500.00, Transport back AED 1,500.00 | AED 6,500.00 | '
  + 'The planned days are an estimate (standard hours unless changed): the bill follows the hours recorded as the days pass, and the final timesheet is asked for on 12 Nov 2026.');
T.eq('…only the return goes', json([pv.bulk, pv.offHire]), '[null,{"requestId":"R1001","lineId":"L1","date":"2026-11-12"}]');
act('offHire', pv.offHire);
const card = O.site(s).onHire.find((x) => x.requestId === rx);
T.eq('booked: still on hire, the card says when', [line(rx).status, line(rx).plannedReturn, card.plannedText].join(' | '), 'ON_HIRE | 2026-11-12 | Return planned for 12 Nov 2026');
act('advance', { days: 7 });
T.eq('a week on: returned by itself on the date', [line(rx).status, line(rx).events.offHire].join(), 'OFF_HIRED,2026-11-12');
T.check('…the site is asked for the final timesheet', s.notifications.some((n) => n.text === 'EX-1001 was returned on 12 Nov 2026: send the final timesheet.' && E.visibleTo(n, Seed.PERSONAS.find((p) => p.id === 'p-site'))));
const back = O.returned(s).find((x) => x.requestId === rx);
T.eq('Returned: the final timesheet to send', [back.serial, back.returnedText, back.sheetText].join(' | '), 'EX-1001 | Returned 12 Nov 2026 · 5 days on hire from 7 Nov | 3 working days without hours');
o = Rt.open(s, { requestId: rx, lineId: lx });
const filled = Rt.fill(s, o.def, o.draft);
pv = Rt.preview(s, o.def, filled.draft);
T.eq('…its dialog: the timesheet only, filled with standard hours', [o.def.mode, o.def.title, filled.filled, json(filled.reset.slice(0, 2)), pv.confirm, json(pv.bulk.days.map((d) => d.date.slice(8) + ':' + d.usage))].join(' | '),
  'timesheet | The final timesheet of EX-1001 | 3 | [{"id":"stRetU-2026-11-09","value":"8"},{"id":"stRetS-2026-11-09","value":"0"}] | Send the final timesheet | ["09:8","10:8","11:8"]');

T.section('delivered early: the Return dialog follows the request\'s dates (Lena, Customer Y, 9 Nov – 6 Dec, delivered 2 Nov)');
s = require('./e2e/future-fixture').state('fresh');
as('p-desk');
const re = act('createRequest', { requestingBu: 'BU-FC', customerId: 'C-Y', from: '2026-11-09', to: '2026-12-06', lines: [{ cls: 'EXC', unitId: 'U-EX2' }] }).result.id;
act('takeDeposit', { requestId: re });
as('p-em'); act('approveLine', { requestId: re, lineId: line(re).id, unitId: 'U-EX2' });
as('p-yard'); act('shipLine', { requestId: re, lineId: line(re).id });
as('p-desk'); act('receiveLine', { requestId: re, lineId: line(re).id });
const le = line(re).id;
const ie = { requestId: re, lineId: le };
T.eq('received on 2 Nov, on hire from the request\'s start', [s.today, line(re).events.received, line(re).events.onHire, json(line(re).earlyDelivery)].join(' | '),
  '2026-11-02 | 2026-11-02 | 2026-11-09 | {"arrived":"2026-11-02","startsOn":"2026-11-09"}');
let ce = O.site(s).onHire.find((x) => x.requestId === re);
T.eq('the card: the request\'s dates, delivered early, the hours from the hire\'s start', [ce.number, ce.earlyText, ce.sinceLabel, ce.since, ce.daysText, ce.requested, ce.requestedText, ce.grid.length, ce.startsText].join(' | '),
  'FR-1001 | Delivered early on 2 Nov: on hire from 9 Nov | On hire from | 9 Nov 2026 | Starts in 7 days | 9 Nov – 6 Dec 2026 | 28 days requested | 0 | The hours start on 9 Nov 2026, the hire\'s start (delivered early on 2 Nov).');
o = Rt.open(s, ie);
T.eq('Return: the request\'s end by default, not before the hire\'s start (9 Nov), the request\'s dates in the head', [o.draft.date, o.def.minDate, o.def.datesText, o.def.dateNote].join(' | '),
  '2026-12-06 | 2026-11-09 | Requested 9 Nov – 6 Dec 2026 · on hire from 9 Nov (delivered early on 2 Nov) | The request’s end (6 Dec 2026) unless you pick another day; not before the hire’s start (9 Nov 2026). A day after today books the return.');
T.eq('…the rows from the hire\'s start to the return day, every one planned, prefilled with standard hours (the UAE weekend empty)',
  [o.def.rows[0].date, o.def.rows[o.def.rows.length - 1].date, o.def.rows.length, o.def.rows.every((r) => r.planned), o.def.rows.filter((r) => r.returnDay).map((r) => r.label).join(),
    o.def.rows.slice(0, 7).map((r) => r.date.slice(8) + ':' + r.usage + '/' + r.standby).join(' '), o.def.rangeText].join(' | '),
  '2026-11-09 | 2026-12-06 | 28 | true | Sun 6 Dec | 09:8/0 10:8/0 11:8/0 12:8/0 13:8/0 14:/ 15:/ | 9 Nov – 6 Dec 2026 · 28 days (28 planned)');
T.eq('…nothing to record yet, said so', [o.def.notYetText, o.def.hasActual].join(' | '), 'The hire starts on 9 Nov 2026 (delivered early on 2 Nov): no day to record yet. | false');
pv = Rt.preview(s, o.def, o.draft);
T.eq('a planned return: the days after today planned, not saved', [pv.ok, pv.planned, pv.states['2026-11-09'].text, pv.whenText, pv.sheetText].join(' | '),
  'true | true | Planned | Planned return: the hire stops by itself on 6 Dec 2026. Until then, record the hours as the days pass; the final timesheet is asked for on the day. | '
  + 'Actual: none yet — Planned: 20 days with hours · 160 h of use · 0 h of standby (an estimate)');
const eb = pv.bill;
T.eq('the estimated final bill: planned hours × AED 140, transport out and back, no minimum top-up (160 h > 16 h)', [eb.heading, eb.modeText, eb.rows.map((r) => r.label + ' ' + r.detail + ' ' + r.amountText).join(' ; '),
  eb.rows.some((r) => r.kind === 'MIN_HIRE')].join(' | '),
  'Estimated final bill | Return planned for 6 Dec 2026: on hire 9 Nov – 6 Dec 2026 (28 days, the return day included) · delivered early on 2 Nov | '
  + 'Rental, planned 9 Nov – 6 Dec 2026 · 160 h of use × AED 140.00 an hour (estimate) AED 22,400.00 ; Transport out to the site AED 2,200.00 ; Transport back when the yard collects it AED 2,200.00 | false');
T.eq('…= 160 h × 140 + 2 × 2,200, with VAT for the customer', [eb.total, 160 * 140 + 2 * 2200, eb.totalLabel, eb.totalText, eb.vat.amountText, eb.grossLabel, eb.grossText].join(' | '),
  '26800 | 26800 | Estimated total for the hire | AED 26,800.00 | AED 1,340.00 | Estimated, with VAT, to the customer | AED 28,140.00');
T.eq('…the actual days and the planned ones apart', [eb.split.actual.text, eb.split.planned.text, eb.split.usageText].join(' | '),
  'None yet: the hire starts on 9 Nov 2026 (delivered early on 2 Nov) | 9 Nov – 6 Dec 2026 · 28 days · 160 h of use | 0 h of use actual · 160 h planned');
const ebs = Rt.preview(s, o.def, Object.assign({}, o.draft, { standby: { '2026-11-10': '2' }, usage: { '2026-11-10': '6' } })).bill;
T.eq('…a planned day changed: the estimate follows, standby at 50 %', [ebs.rows.filter((r) => r.kind !== 'TRANSPORT').map((r) => r.label + ' ' + r.amountText).join(', '), ebs.totalText].join(' | '),
  'Rental, planned AED 22,120.00, Standby, planned AED 140.00 | AED 26,660.00');
T.eq('Confirm: books the return, sends no hours', [json([pv.bulk, pv.offHire]), pv.confirm, pv.toast].join(' | '),
  '[null,{"requestId":"R1001","lineId":"L1","date":"2026-12-06"}] | Book the return for 6 Dec 2026 | Return booked for 6 Dec 2026 (EX-1002). Until then, record the hours as the days pass; the final timesheet is asked for on the day.');
const r13 = Rt.def(s, ie, '2026-11-13', o.draft);
T.eq('a return on the 13th lists 9–13 Nov, the 13th labelled the return day', r13.rows.map((r) => r.label + (r.returnDay ? ' (Return day)' : '')).join(', '),
  'Mon 9 Nov, Tue 10 Nov, Wed 11 Nov, Thu 12 Nov, Fri 13 Nov (Return day)');
T.eq('…before the hire\'s start: refused in the engine\'s words', Rt.preview(s, Rt.def(s, ie, '2026-11-05', o.draft), Object.assign({}, o.draft, { date: '2026-11-05' })).warn,
  'The return date cannot be before the hire started (9 Nov 2026).');
T.eq('the request\'s Money before the start: nothing to bill yet', [Rt.bill(s, re, le, null).started, Rt.bill(s, re, le, null).modeText].join(' | '),
  'false | The hire starts on 9 Nov 2026 (delivered early on 2 Nov): nothing to bill yet.');
act('offHire', pv.offHire);
T.eq('booked: still on hire, the return planned, no hours saved', [line(re).status, line(re).plannedReturn, s.hours.filter((x) => x.lineId === le).length].join(' | '), 'ON_HIRE | 2026-12-06 | 0');
act('advance', { days: 13 });
o = Rt.open(s, ie);
T.eq('at 15 Nov: the booked date, 9–15 Nov the actual timesheet (to fill in), the rest planned', [s.today, o.draft.date, o.def.rows.filter((r) => !r.planned).map((r) => r.date.slice(8) + ':' + r.usage).join(' '),
  o.def.rows.filter((r) => r.planned)[0].date, o.def.rows.filter((r) => r.planned).length, o.def.rangeText, o.def.hasActual, o.def.notYetText].join(' | '),
  '2026-11-15 | 2026-12-06 | 09: 10: 11: 12: 13: 14: 15: | 2026-11-16 | 21 | 9 Nov – 6 Dec 2026 · 28 days (7 actual, 21 planned) | true | ');
pv = Rt.preview(s, o.def, o.draft);
T.eq('…the return stays booked: nothing to send until the days are recorded', [pv.ok, pv.warn, pv.states['2026-11-09'].text, pv.states['2026-11-16'].text].join(' | '),
  'false | The return is booked for 6 Dec 2026 already: record the days up to today, or pick another date. | — | Planned');
const fe = Rt.fill(s, o.def, Object.assign({}, o.draft, { approve: true }));
pv = Rt.preview(s, o.def, fe.draft);
T.eq('…filled and agreed: the actual days go (approved), the planned ones stay an estimate, the return stays booked', [pv.ok, json(pv.bulk.days.map((d) => d.date.slice(8) + ':' + d.usage)), pv.bulk.approve, json(pv.offHire), pv.confirm].join(' | '),
  'true | ["09:8","10:8","11:8","12:8","13:8"] | true | null | Record the hours, keep the return on 6 Dec 2026');
T.eq('…the estimate: actual 40 h, planned 120 h, at AED 140', [pv.bill.rows.filter((r) => r.kind === 'RENTAL').map((r) => r.label + ' ' + r.detail + ' ' + r.amountText).join(' ; '), pv.bill.split.usageText, pv.bill.totalText].join(' | '),
  'Rental, actual 9 Nov – 15 Nov 2026 · 40 h of use × AED 140.00 an hour AED 5,600.00 ; Rental, planned 16 Nov – 6 Dec 2026 · 120 h of use × AED 140.00 an hour (estimate) AED 16,800.00 | 40 h of use actual · 120 h planned | AED 26,800.00');
T.eq('…the toast', pv.toast, 'Return booked for 6 Dec 2026 (EX-1002, 5 days of hours recorded and agreed). Until then, record the hours as the days pass; the final timesheet is asked for on the day.');
act('logHoursBulk', pv.bulk);
T.eq('sent: 9–13 Nov saved and approved, signed by the customer; the return still on 6 Dec', [s.hours.filter((x) => x.lineId === le).map((x) => x.date.slice(8) + ':' + x.usage + (x.approved ? 'A' : '')).join(' '), line(re).plannedReturn].join(' | '),
  '09:8A 10:8A 11:8A 12:8A 13:8A | 2026-12-06');
ce = O.site(s).onHire.find((x) => x.requestId === re);
T.eq('the card now: on hire since 9 Nov, delivered early, the grid from 9 Nov', [ce.sinceLabel, ce.daysText, ce.earlyText, ce.grid.map((g) => g.day).join(), ce.startsText].join(' | '),
  'On hire since | 7 days on hire | Delivered early on 2 Nov: on hire from 9 Nov | 9,10,11,12,13,14,15 | ');

T.report();
