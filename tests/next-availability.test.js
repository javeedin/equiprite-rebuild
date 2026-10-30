/*
 * EquipRite Next, Availability (webApps/equiprite-next/resources/js/availability.js and availabilityData.js): units as
 * rows, bookings as bars, clashes and tight turnarounds, free capacity per class for a window, the timeline's
 * geometry, export, and the calls (New EquipRite's schedule calls, paged without truncating). Loads the real modules.
 *
 * Run:  node tests/next-availability.test.js
 */
'use strict';

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

const rules = load('rules');
const Progress = load('requestProgress');
const requestData = load('requestData', { 'resources/js/rules': rules });
const av = load('availability', { 'resources/js/requestProgress': Progress, 'resources/js/rules': rules });
const data = load('availabilityData');

// Wednesday 4 Nov 2026. d(n) is n days from it.
const TODAY = '2026-11-04';
const d = (n) => av.addDays(TODAY, n);
const iso = (n) => d(n) + 'T00:00:00Z';

const SERIALS = [
  { id: 1, serialNumber: 'EX-2201', equipmentId: 11, currentLocationId: 501, faAssetRefId: '100482', maintenanceAssetNumber: 'MA-2201' },
  { id: 2, serialNumber: 'EX-2203', equipmentId: 11, currentLocationId: 501 },
  { id: 3, serialNumber: 'EX-2210', equipmentId: 12, currentLocationId: 502, maintenanceAssetNumber: 'MA-2210' },
  { id: 4, serialNumber: 'MC-07', equipmentId: 21, currentLocationId: 502 },
  { id: 5, serialNumber: 'TC-02', equipmentId: 22 },
  { id: 6, serialNumber: 'EX-2299', equipmentId: 12, currentLocationId: 501 },
  { id: 7, serialNumber: 'EX-2300', equipmentId: 12, currentLocationId: 501, maintenanceAssetNumber: 'MA-2300' },
  { id: 8, serialNumber: 'TC-05', equipmentId: 22, currentLocationId: 502 },
  { id: 9, serialNumber: 'TC-05', equipmentId: 22, currentLocationId: 502 }, // a repeated serial-ref: one row
  { id: 10, equipmentId: 22 }, // no serial: no row (New's rule)
];
const MASTERS = { 11: { id: 11, equipmentName: 'CAT 320 Excavator', equipmentClassId: 1 }, 12: { id: 12, equipmentName: 'PC210 Excavator', equipmentClassId: 1 },
  21: { id: 21, equipmentName: 'Mobile Crane 50t', equipmentClassId: 2 }, 22: { id: 22, equipmentName: 'Tower Crane', equipmentClassId: 2 } };
const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Cranes' }];
const LOCS = { 501: { locationName: 'Houston Yard', locationCode: 'HOU-Y1' }, 502: { locationName: 'Dallas Yard', locationCode: 'DAL-Y2' } };
const line = (id, serial, req, reqId, project, status, from, to, extra) => Object.assign({
  eqrRequestLineId: id, eqrEquipmentRequestId: reqId, requestNumber: req, lineNumber: 1, projectName: project, taskName: 'Earthworks',
  requestorName: 'Pat Lee', allocatedSerial: serial, allocStatus: status, requestedStartDate: iso(from), requestedEndDate: iso(to), deploymentLocation: 'Gate 3' }, extra || {});
const LINES = [
  line(9001, 'EX-2201', 'REQ-10511', 511, 'Pipeline North', 'ALLOCATED', -5, 10),
  line(9002, 'EX-2201', 'REQ-10530', 530, 'Plant Expansion B', 'PENDING', 5, 30),
  line(9003, 'EX-2203', 'REQ-10530', 530, 'Plant Expansion B', 'PENDING', 2, 40, { lineNumber: 2 }),
  line(9004, 'EX-2210', 'REQ-10540', 540, 'Pipeline North', 'ALLOCATED', 3, 12),
  line(9005, 'MC-07', 'REQ-10498', 498, 'Plant Expansion B', 'ALLOCATED', -20, 6),
  line(9010, 'MC-07', 'REQ-10560', 560, 'Harbour Wall', 'ALLOCATED', 8, 20),
  line(9006, 'TC-02', 'REQ-10470', 470, 'Harbour Wall', 'CANCELLED', -10, 5),
  line(9006, 'TC-02', 'REQ-10470', 470, 'Harbour Wall', 'CANCELLED', -10, 5), // the view repeats a line
  line(9007, 'MC-07', 'REQ-10400', 400, 'Harbour Wall', 'ALLOCATED', -60, -30),
  line(9008, 'MC-07', 'REQ-10401', 401, 'Harbour Wall', 'ALLOCATED', -40, -25), // overlapped, but over
  line(9011, 'ZZ-9', 'REQ-10600', 600, '', 'ALLOCATED', 1, 3, { equipmentName: 'Light Tower', className: 'Lighting' }),
  line(9012, 'EX-2299', 'REQ-10380', 380, 'Old job', 'ALLOCATED', -15, 9),
  line(9013, 'TC-05', 'REQ-10610', 610, 'Plant Expansion B', 'ALLOCATED', 0, 5),
  line(9014, 'EX-2203', 'REQ-10620', 620, 'No start', 'ALLOCATED', 0, 5, { requestedStartDate: null }), // no start: no bar
];
const REQS = [{ requestNumber: 'REQ-10600', eqrEquipmentRequestId: 600, status: 'IN_PROCESS', customerName: 'Lone Star Paving', requestOrigin: 'External' }];
const MY_LINES = requestData.indexLines([
  { requestNumber: 'REQ-10511', lineNumber: 1, lineStatus: 'DEPLOYED' },
  { requestNumber: 'REQ-10530', lineNumber: 1, lineStatus: 'IN_PROCESS' },
  { requestNumber: 'REQ-10530', lineNumber: 2, lineStatus: 'IN_PROCESS' },
  { requestNumber: 'REQ-10540', lineNumber: 1, lineStatus: 'SHIP_TO_SITE' },
  { requestNumber: 'REQ-10498', lineNumber: 1, lineStatus: 'DEPLOYED' },
  { requestNumber: 'REQ-10560', lineNumber: 1, lineStatus: 'SCHEDULED_FOR_PICKING' },
  { requestNumber: 'REQ-10380', lineNumber: 1, lineStatus: 'RETURNED' },
]);
const WOS = {
  'MA-2210': [{ WorkOrderNumber: 'WO-55821', WorkOrderType: 'Preventive', WorkOrderDescription: '500 h service', PlannedStartDate: iso(8), PlannedCompletionDate: iso(14) }],
  'MA-2300': [{ WorkOrderNumber: 'WO-60000', PlannedStartDate: iso(10), PlannedCompletionDate: iso(11) }, { WorkOrderNumber: 'WO-60001' }], // no planned start: no bar
};
const INPUT = { serials: SERIALS, classes: CLASSES, lines: LINES, masterById: MASTERS, locationsById: LOCS, requests: REQS, linesByRequest: MY_LINES, workOrdersByAsset: WOS };
const model = av.build(INPUT, TODAY);
const unit = (id) => model.units.find((u) => u.id === id);
const bars = (id) => model.byUnit[id] || [];
const bk = (req, serial) => model.bookings.find((b) => b.requestNumber === req && (!serial || b.unitId === serial));

T.section('units as rows');
T.eq('one row per serial (repeated serial-ref once, no serial no row), plus an allocated serial the list lacks',
  model.units.map((u) => u.id).join(), 'EX-2201,EX-2203,EX-2210,MC-07,TC-02,EX-2299,EX-2300,TC-05,ZZ-9');
T.eq('name and class from the equipment master and the classes', [unit('EX-2210').name, unit('EX-2210').cls, unit('MC-07').cls].join(' | '), 'PC210 Excavator | Excavators | Cranes');
T.eq('yard from the location: code · name; none recorded', [unit('EX-2201').yard, unit('TC-02').yard].join(' | '), 'HOU-Y1 · Houston Yard | No yard recorded');
T.eq('a serial not in the unit list: named and classed from its booking', [unit('ZZ-9').name, unit('ZZ-9').cls, unit('ZZ-9').known].join(' | '), 'Light Tower | Lighting | false');
T.check('search reads the unit and its bookings', unit('EX-2201').hay.includes('pipeline north') && unit('EX-2201').hay.includes('req-10530') && unit('EX-2201').hay.includes('100482'));

T.section('bookings as bars');
T.eq('a repeated view row is one booking', model.bookings.filter((b) => b.requestNumber === 'REQ-10470').length, 1);
T.check('a line with no start date has no bar', !bk('REQ-10620'));
T.eq('dates: start to end, both days counted', [bk('REQ-10511').start, bk('REQ-10511').end, bk('REQ-10511').days].join(), [d(-5), d(10), 16].join());
T.eq('hard and soft reserve from the allocation', [bk('REQ-10511').reserve, bk('REQ-10530', 'EX-2201').reserve, bk('REQ-10470').reserve].join(), 'hard,soft,cancelled');
T.eq('the journey stage from the line in my-request-lines', ['REQ-10511', 'REQ-10540', 'REQ-10560', 'REQ-10380'].map((r) => bk(r).stage + ':' + bk(r).stageLabel).join(' | '),
  'onsite:On site | out:On the way to site | ready:Waiting to be picked | done:Back at the yard');
T.eq('no line status: read from the allocation and the request, in words', [bk('REQ-10600').stage, bk('REQ-10600').stageLabel, bk('REQ-10530', 'EX-2201').stageLabel].join(' | '),
  'ready | Unit assigned | Unit held, not confirmed yet');
T.eq('the party: the project, else the request\'s customer', [bk('REQ-10511').party, bk('REQ-10600').party, String(bk('REQ-10600').external)].join(' | '), 'Pipeline North | Lone Star Paving | true');
T.eq('holds the unit: not cancelled, not back at the yard', ['REQ-10511', 'REQ-10470', 'REQ-10380'].map((r) => bk(r).holds).join(), 'true,false,false');
T.eq('maintenance: a bar per work order with a planned start', bars('EX-2300').filter((b) => b.kind === 'maintenance').map((b) => b.wo + ':' + b.start + '..' + b.end).join(), 'WO-60000:' + d(10) + '..' + d(11));
T.eq('the request id for its tab, from the line or the request', [bk('REQ-10511').requestId, bk('REQ-10600').requestId].join(), '511,600');

T.section('clashes and tight turnarounds');
T.eq('clashes still open today: a double booking and a booking during maintenance', model.clashes.map((c) => c.unitId + ':' + c.type + ':' + c.from + '..' + c.to + ':' + c.days).join(' | '),
  ['EX-2201:double:' + d(5) + '..' + d(10) + ':6', 'EX-2210:maintenance:' + d(8) + '..' + d(12) + ':5'].join(' | '));
T.check('a clash that is over is not counted', !model.clashes.some((c) => c.unitId === 'MC-07'));
T.check('a cancelled booking clashes with nothing', !model.clashes.some((c) => c.unitId === 'TC-02'));
T.eq('both bars of a clash are marked', model.bookings.filter((b) => b.clash).map((b) => b.requestNumber || b.wo).sort().join(), 'REQ-10511,REQ-10530,REQ-10540,WO-55821');
T.eq('tight: back and out again within two days', model.tight.map((c) => c.unitId + ':' + c.back + '>' + c.out + ':' + c.gap).join(), 'MC-07:' + d(6) + '>' + d(8) + ':2');
T.eq('the clash rule itself', av.findClashes([{ id: 'x', n: 1, unitId: 'U', kind: 'maintenance', start: d(1), end: d(5), holds: true },
  { id: 'y', n: 2, unitId: 'U', kind: 'maintenance', start: d(2), end: d(3), holds: true }], TODAY).length, 0);
T.eq('a turnaround of three days is not tight', av.findTight([{ id: 'a', n: 1, unitId: 'U', kind: 'booking', start: d(1), end: d(5), holds: true },
  { id: 'b', n: 2, unitId: 'U', kind: 'booking', start: d(8), end: d(9), holds: true }], TODAY).length, 0);
T.eq('what each unit is doing today', [unit('EX-2201').now.text, unit('EX-2299').now.text].join(' | '),
  'On site · Pipeline North · until ' + av.fmtDay(d(10)) + ' | Free now · nothing booked ahead');

T.section('free capacity for a window');
const win = av.windowOf(d(7), d(19), TODAY);
T.eq('the window in words', win.text, '11 – 23 Nov 2026 · 13 days');
const state = (id) => av.windowState(model.byUnit[id], win.from, win.to);
T.eq('each unit in the window', ['EX-2201', 'EX-2210', 'EX-2299', 'EX-2300', 'TC-02', 'TC-05', 'ZZ-9'].map((id) => id + ':' + state(id).state).join(' '),
  'EX-2201:booked EX-2210:booked EX-2299:free EX-2300:maint TC-02:free TC-05:tight ZZ-9:free');
T.eq('why: the booking, the maintenance, the turnaround', [state('EX-2201').why, state('EX-2300').why, state('TC-05').why].join(' | '),
  'REQ-10511 · Pipeline North · 30 Oct – 14 Nov 2026 (+1 more) | Maintenance WO-60000 · 14 – 15 Nov 2026 | Back from REQ-10610 on 9 Nov');
const cap = av.capacity(model, model.units.map((u) => u.id), win);
T.eq('per class: free of total, tight, booked, maintenance', cap.classes.map((c) => c.label + ' ' + c.headline + ' (' + c.note + ')').join(' | '),
  'Cranes 2 of 3 free (1 tight · 1 booked) | Excavators 1 of 5 free (3 booked · 1 in maintenance) | Lighting 1 of 1 free (All free)');
T.eq('all classes', cap.total.headline, '4 of 9 free');
T.eq('the capacity bar adds up', cap.classes[1].segs.map((s) => s.k + ' ' + s.w).join(', '), 'free 20%, booked 60%, maint 20%');
T.eq('a window ending before it starts ends on its first day', av.windowOf(d(9), d(3), TODAY).to, d(9));

T.section('the timeline');
const fit = av.fitView(win, 'week');
T.eq('the view opens a few days before the window, on a Monday', fit.viewStart + ' ' + fit.zoom, '2026-11-02 week');
T.eq('a window over three weeks opens the month view', av.fitView(av.windowOf(d(0), d(40), TODAY), 'week').zoom, 'month');
const opts = { from: win.from, to: win.to, viewStart: fit.viewStart, zoom: 'week', groupBy: 'class', chip: 'all', text: '', cls: '', yard: '', collapsed: {}, more: {} };
const v = av.view(model, opts);
T.eq('groups by class, then units (clashes first)', v.items.map((i) => (i.type === 'group' ? '[' + i.label + ']' : i.key)).join(' '),
  '[Cranes] MC-07 TC-02 TC-05 [Excavators] EX-2201 EX-2210 EX-2203 EX-2299 EX-2300 [Lighting] ZZ-9');
T.eq('a group says how many are free in the window', v.items[0].text, '3 units · 2 free 11 – 23 Nov 2026');
const row = v.items.find((i) => i.key === 'EX-2201');
T.eq('bars placed on the four weeks, clipped at the edges', row.bars.map((b) => b.l + '/' + b.w + (b.cutL ? '<' : '') + (b.cutR ? '>' : '')).join(' '), '0%/46.429%< 25%/75%>');
T.eq('overlapping bars stack in lanes; the row grows', row.bars.map((b) => b.t).join() + ' ' + row.h, '6px,30px 58px');
T.check('bars coloured by journey stage, hard or soft, clash outlined', row.bars[0].cls.includes('nx-stage--onsite') && row.bars[0].cls.includes('nx-av-bar--hard')
  && row.bars[1].cls.includes('nx-av-bar--soft') && row.bars.every((b) => b.cls.includes('nx-av-bar--clash')), row.bars.map((b) => b.cls).join(' ; '));
T.eq('the clash band on the row', row.marks.map((m) => m.cls.split('--')[1] + ' ' + m.l + '/' + m.w).join(), 'clash 25%/21.429%');
T.check('a bar says what it is, the clash, and the stored status', row.bars[0].title.includes('REQ-10511 · Pipeline North') && row.bars[0].title.includes('Clashes with REQ-10530')
  && row.bars[0].title.includes('Stored: allocation ALLOCATED, line DEPLOYED'), row.bars[0].title);
T.eq('a booking bar opens its request; maintenance does not', v.items.find((i) => i.key === 'EX-2210').bars.map((b) => b.kind + ':' + b.open + ':' + b.requestId).join(), 'booking:true:540,maintenance:false:');
T.check('a cancelled booking is not drawn', v.items.find((i) => i.key === 'TC-02').bars.length === 0);
T.check('back at the yard: drawn faded', v.items.find((i) => i.key === 'EX-2299').bars[0].cls.includes('nx-av-bar--past'));
T.eq('the unit says if it is free in your window', ['EX-2201', 'TC-05', 'EX-2299'].map((k) => v.items.find((i) => i.key === k).stateLabel).join(), 'Booked,Free, tight,Free');
T.eq('header: one month, 28 days from Monday', [v.head.months.map((m) => m.label).join(), v.head.ticks.length, v.head.ticks[0].wd + v.head.ticks[0].label, v.head.ticks[5].weekend].join(' | '), 'November 2026 | 28 | M2 | true');
T.eq('today line and the window band', v.head.today + ' ' + v.head.band.l + '/' + v.head.band.w, '8.929% 32.143%/46.429%');
const vm2 = av.view(model, Object.assign({}, opts, { zoom: 'month', viewStart: av.fitView(win, 'month').viewStart }));
T.eq('month view: thirteen weeks', [vm2.range.label, vm2.head.ticks.length, vm2.head.months.map((m) => m.label).join()].join(' | '), '2 Nov 2026 – 31 Jan 2027 | 13 | November 2026,December 2026,January 2027');

T.section('filters and chips');
T.eq('chips count the units in the search', v.chips.map((c) => c.key + ':' + c.count).join(' '), 'all:9 free:4 booked:4 maint:1 clash:2 tight:1');
const only = (o) => av.view(model, Object.assign({}, opts, o)).items.filter((i) => i.type === 'unit').map((i) => i.key).join();
T.eq('free in your window', only({ chip: 'free' }), 'TC-02,TC-05,EX-2299,ZZ-9');
T.eq('clashes', only({ chip: 'clash' }), 'EX-2201,EX-2210');
T.eq('a class from the capacity panel', only({ cls: 'Cranes' }), 'MC-07,TC-02,TC-05');
T.eq('search by request', only({ text: 'req-10560' }), 'MC-07');
T.eq('yard', only({ yard: 'DAL-Y2' }), 'MC-07,TC-05,EX-2210');
T.eq('no yard recorded', only({ yard: '-' }), 'TC-02,ZZ-9');
T.eq('the answer for a class', av.view(model, Object.assign({}, opts, { cls: 'Cranes' })).answer, '2 of 3 units Cranes free 11 – 23 Nov 2026 (1 with a tight turnaround)');
T.eq('group by yard', av.view(model, Object.assign({}, opts, { groupBy: 'yard' })).items.filter((i) => i.type === 'group').map((i) => i.label).join(' | '),
  'DAL-Y2 · Dallas Yard | HOU-Y1 · Houston Yard | No yard recorded');
const col = av.view(model, Object.assign({}, opts, { collapsed: { 'c:Excavators': true } }));
T.eq('a folded group shows its heading only', col.items.filter((i) => i.type === 'unit').length, 4);
{
  // 70 more units in two big classes: every class heading shows, each with a page of rows and "Show more".
  const many = [];
  for (let i = 1; i <= 70; i++) many.push({ serialNumber: (i <= 40 ? 'GEN-' : 'PMP-') + (100 + i), equipmentId: i <= 40 ? 31 : 32, currentLocationId: 501 });
  const big = av.build(Object.assign({}, INPUT, { serials: SERIALS.concat(many), classes: CLASSES.concat([{ id: 3, className: 'Generators' }, { id: 4, className: 'Pumps' }]),
    masterById: Object.assign({}, MASTERS, { 31: { id: 31, equipmentName: 'Generator', equipmentClassId: 3 }, 32: { id: 32, equipmentName: 'Pump', equipmentClassId: 4 } }) }), TODAY);
  const count = (vv) => vv.items.filter((i) => i.type === 'group').map((g) => g.label + ':' + vv.items.filter((i) => i.type === 'unit' && big.units.find((u) => u.id === i.key).cls === g.label).length).join(' ');
  const paged = av.view(big, opts);
  T.eq('every class heading, a page of rows each (80 shared out)', count(paged), 'Cranes:3 Excavators:5 Generators:16 Lighting:1 Pumps:16');
  T.eq('a group says what it holds back', paged.items.filter((i) => i.type === 'more').map((i) => i.text).join(' | '),
    'Show 24 more of Generators (24 not shown) | Show 14 more of Pumps (14 not shown)');
  T.eq('Show more in one group', count(av.view(big, Object.assign({}, opts, { more: { 'c:Generators': av.MORE_ROWS } }))), 'Cranes:3 Excavators:5 Generators:40 Lighting:1 Pumps:16');
  T.eq('one class picked: its rows get the whole page', av.view(big, Object.assign({}, opts, { cls: 'Generators' })).items.filter((i) => i.type === 'unit').length, 40);
}
T.eq('clashes and turnarounds listed, earliest first', v.problems.map((p) => p.type + ':' + p.unitId).join(), 'clash:EX-2201,maint:EX-2210,tight:MC-07');
T.eq('a clash in words, with both bookings', [v.problems[0].title, v.problems[0].when, v.problems[0].items.map((i) => i.label + ' ' + i.dates).join(' & ')].join(' | '),
  'Double booking | 9 – 14 Nov 2026 · 6 days at once | REQ-10511 30 Oct – 14 Nov 2026 & REQ-10530 9 Nov – 4 Dec 2026');
{
  // A messy fleet: 45 double bookings. The panel lists 40 and says how to see the rest; the counts are all of them.
  const ser = [];
  const lns = [];
  for (let i = 1; i <= 45; i++) {
    ser.push({ serialNumber: 'X-' + i, equipmentId: 11 });
    lns.push(line(70000 + i * 2, 'X-' + i, 'REQ-7' + i, 7000 + i, 'A', 'ALLOCATED', 1, 9), line(70001 + i * 2, 'X-' + i, 'REQ-8' + i, 8000 + i, 'B', 'ALLOCATED', 5, 12));
  }
  const messy = av.view(av.build({ serials: ser, classes: CLASSES, lines: lns, masterById: MASTERS }, TODAY), opts);
  T.eq('a long clash list is capped, with the way to the rest', [messy.problems.length, messy.clashCount, messy.unlisted, messy.unlistedText].join(' | '),
    '40 | 45 | 5 | 5 more not listed here: the Clashes and Tight turnarounds chips show every unit with one.');
}
T.eq('the yards to pick', av.yards(model).map((y) => y.key + ':' + y.count).join(), 'DAL-Y2:3,HOU-Y1:4,-:2');
T.eq('summary', av.summary(model), '9 units in 3 classes · 8 bookings now or ahead · 2 clashes · 1 tight turnaround');

T.section('export the bookings shown');
const rows = av.exportRows(model, v.ordered, v.range);
T.eq('the bookings of the units shown, in the view, maintenance too', rows.map((r) => r.unit + ':' + r.ref).join(' '),
  'MC-07:REQ-10498 MC-07:REQ-10560 TC-05:REQ-10610 EX-2201:REQ-10511 EX-2201:REQ-10530 EX-2210:REQ-10540 EX-2210:WO-55821 EX-2203:REQ-10530 EX-2299:REQ-10380 EX-2300:WO-60000 ZZ-9:REQ-10600');
const r1 = rows.find((r) => r.ref === 'REQ-10511');
T.eq('a row: unit, words, dates, the clash, the stored statuses', [r1.equipment, r1.cls, r1.yard, r1.where, r1.reserve, r1.start, r1.end, r1.days, r1.clash, r1.alloc, r1.line].join(' | '),
  'CAT 320 Excavator | Excavators | HOU-Y1 · Houston Yard | On site | Unit assigned (hard reserve) | ' + d(-5) + ' | ' + d(10) + ' | 16 | REQ-10530 (9 – 14 Nov 2026) | ALLOCATED | DEPLOYED');
T.eq('tight turnaround on both bookings', rows.filter((r) => r.tight).map((r) => r.ref + ' ' + r.tight).join(' | '), 'REQ-10498 back 10 Nov 2026, out 12 Nov 2026 | REQ-10560 back 10 Nov 2026, out 12 Nov 2026');
T.eq('export columns', av.exportColumns().map((c) => c.label).slice(0, 7).join(), 'Unit (serial),Equipment,Class,Yard,What,Request or work order,Project or customer');

(async () => {
  T.section('the calls: New EquipRite\'s, paged without truncating');
  const calls = [];
  const pages = { 0: { data: [{ id: 1 }, { id: 2 }], hasMore: true, pageSize: 2 }, 1: { data: [{ id: 3 }], hasMore: false } };
  const fake = (handler) => (o) => { calls.push(o.endpoint.replace('eqp-v1/', '') + ' ' + JSON.stringify(o.uriParams)); return Promise.resolve(handler(o)); };
  let r = await data.readAll(fake((o) => ({ ok: true, body: pages[o.uriParams.page || 0] })), 'eqp-v1/getSerialRefs', { size: 10000 });
  T.eq('the first call as New makes it, then the next page at the size the server used', calls.join(' ; '), 'getSerialRefs {"size":10000} ; getSerialRefs {"size":2,"page":1}');
  T.eq('every row', r.rows.map((x) => x.id).join(), '1,2,3');
  calls.length = 0;
  r = await data.readAll(fake((o) => (o.uriParams.page ? { ok: false, status: 500 } : { ok: true, body: { data: [{ id: 1 }], recordCount: 5, pageSize: 1 } })), 'eqp-v1/getEquipmentClasses', { page: 0, size: 200 });
  T.eq('a later page failing keeps what came and says so', [r.ok, r.partial, r.rows.length].join(), 'true,true,1');
  r = await data.readAll(fake(() => ({ ok: false, status: 503 })), 'eqp-v1/getSerialRefs', { size: 10000 });
  T.eq('a first page failing is a failure', [r.ok, r.status].join(), 'false,503');

  calls.length = 0;
  const core = await data.loadCore(fake((o) => {
    const e = o.endpoint;
    if (e.endsWith('getSerialRefs')) return { ok: true, body: { data: SERIALS.slice(0, 4), hasMore: false } };
    if (e.endsWith('getEquipmentClasses')) return { ok: true, body: { data: CLASSES, hasMore: false } };
    if (e.endsWith('WorkbenchLines')) return { ok: true, body: { data: LINES, hasMore: false } };
    if (e.endsWith('getEquipriteV1EquipmentMaster')) return { ok: true, body: { data: Object.values(MASTERS), recordCount: 4 } };
    if (e.endsWith('getLocationById')) return o.uriParams.id === 501 ? { ok: true, body: LOCS[501] } : { ok: false, status: 404 };
    return { ok: false, status: 404 };
  }));
  T.eq('reads units, classes, bookings and masters together, then each location once', calls.join(' ; '),
    'getSerialRefs {"size":10000} ; getEquipmentClasses {"page":0,"size":200} ; getEquipriteV1ViewsWorkbenchLines {"page":0,"size":2000} ; '
    + 'getEquipriteV1EquipmentMaster {"page":0,"size":200} ; getLocationById {"id":501} ; getLocationById {"id":502}');
  T.eq('a missing location is said, not hidden', core.notes.join(), '1 of 2 unit locations could not be loaded: those units show no yard.');
  T.eq('the masters by id, the locations', [Object.keys(core.masterById).join(), core.locationsById['501'].locationCode].join(' | '), '11,12,21,22 | HOU-Y1');

  calls.length = 0;
  const wo = await data.workOrders(fake((o) => {
    const q = o.uriParams.q || '';
    if (o.endpoint.endsWith('getInstalledBaseAssets')) return { ok: true, body: { items: q.includes('MA-2210') ? [{ AssetId: 300100, OperatingOrganizationCode: 'HOU' }] : [] } };
    if (o.endpoint.endsWith('getMaintenanceWorkOrders')) return { ok: true, body: { items: q === 'AssetId=300100' ? WOS['MA-2210'] : [] } };
    return { ok: false };
  }), SERIALS);
  T.eq('per asset: the Fusion asset, then the widening ladder until one answers', calls.filter((c) => c.includes('MA-2210') || c.includes('300100')).join(' ; '),
    'ProjectLOV/getInstalledBaseAssets {"q":"AssetNumber=\'MA-2210\'","limit":1} ; '
    + 'ProjectLOV/getMaintenanceWorkOrders {"q":"AssetNumber=\'MA-2210\'","limit":100,"orderBy":"PlannedStartDate:desc"} ; '
    + 'ProjectLOV/getMaintenanceWorkOrders {"q":"AssetNumber=\'MA-2210\' and OrganizationCode=\'HOU\'","limit":100,"orderBy":"PlannedStartDate:desc"} ; '
    + 'ProjectLOV/getMaintenanceWorkOrders {"q":"AssetId=300100","limit":100,"orderBy":"PlannedStartDate:desc"}');
  T.check('no work orders asked for an asset Fusion does not know', !calls.some((c) => c.includes('getMaintenanceWorkOrders') && c.includes('MA-2201')));
  T.eq('work orders by asset', [wo.assets, Object.keys(wo.byAsset).join(), wo.byAsset['MA-2210'][0].WorkOrderNumber].join(' | '), '3 | MA-2210 | WO-55821');
  T.eq('a quote in an asset number is doubled', data.qLit("MA-'7"), "'MA-''7'");
  T.report();
})();
