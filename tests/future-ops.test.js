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
  logHours: 'p-pm', fillHours: 'p-pcfin', approveHours: 'p-site', reportBreakdown: 'p-pcfin', offHire: 'p-pcfin', redeploy: 'p-pcfin', moveToCompany: 'p-site', reportLoss: 'p-yard' };
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
T.eq('who may do what: Omar (site)', json(v.can), '{"receive":true,"fill":true,"log":true,"approve":false,"breakdown":true,"offHire":true,"redeploy":true,"handover":false,"loss":true}');
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
  'A credit of AED 800.00 a day off this month\'s charges (ICA-FC-PC-2026). | The hire stops today: charged up to 8 Nov 2026. Minimum hire 7 days: 1 more day charged. Transport back AED 1,500.00. | Charged at AED 462,000.00: net book value AED 420,000.00 + 10 % (OD-11).');
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
  'false | false | The customer has it: off hire it, then raise a request for the group company.');
T.eq('the desk receives and off-hires; the site\'s own moves are not hers', json(O.site(s).can), '{"receive":true,"fill":false,"log":false,"approve":true,"breakdown":false,"offHire":true,"redeploy":true,"handover":true,"loss":false}');

T.report();
