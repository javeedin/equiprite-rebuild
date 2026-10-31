/*
 * EquipRite Next, Availability's yard grid (webApps/equiprite-next/resources/js/availabilityPivot.js): equipment (or
 * units) as rows grouped by class, yards as columns ("No yard recorded" last), a tick where the equipment is with how
 * many and how many are free in your window, coloured all / some / none free; row and yard totals; the page's search,
 * class, yard and chip; the units grain; folding and paging; export; the legend. Loads the real modules, on the same
 * fleet as tests/next-availability.test.js.
 *
 * Run:  node tests/next-pivot.test.js
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
const pv = load('availabilityPivot', { 'resources/js/availability': av });

// Wednesday 4 Nov 2026. d(n) is n days from it.
const TODAY = '2026-11-04';
const d = (n) => av.addDays(TODAY, n);
const iso = (n) => d(n) + 'T00:00:00Z';

const SERIALS = [
  { id: 1, serialNumber: 'EX-2201', equipmentId: 11, currentLocationId: 501, maintenanceAssetNumber: 'MA-2201' },
  { id: 2, serialNumber: 'EX-2203', equipmentId: 11, currentLocationId: 501 },
  { id: 3, serialNumber: 'EX-2210', equipmentId: 12, currentLocationId: 502, maintenanceAssetNumber: 'MA-2210' },
  { id: 4, serialNumber: 'MC-07', equipmentId: 21, currentLocationId: 502 },
  { id: 5, serialNumber: 'TC-02', equipmentId: 22 },
  { id: 6, serialNumber: 'EX-2299', equipmentId: 12, currentLocationId: 501 },
  { id: 7, serialNumber: 'EX-2300', equipmentId: 12, currentLocationId: 501, maintenanceAssetNumber: 'MA-2300' },
  { id: 8, serialNumber: 'TC-05', equipmentId: 22, currentLocationId: 502 },
  { id: 9, serialNumber: 'TC-05', equipmentId: 23, currentLocationId: 502 }, // a repeated serial-ref: the first id counts
  { id: 10, equipmentId: 22 }, // no serial: no row
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
  line(9011, 'ZZ-9', 'REQ-10600', 600, '', 'ALLOCATED', 1, 3, { equipmentName: 'Light Tower', className: 'Lighting' }),
  line(9012, 'EX-2299', 'REQ-10380', 380, 'Old job', 'ALLOCATED', -15, 9),
  line(9013, 'TC-05', 'REQ-10610', 610, 'Plant Expansion B', 'ALLOCATED', 0, 5),
];
const MY_LINES = requestData.indexLines([
  { requestNumber: 'REQ-10511', lineNumber: 1, lineStatus: 'DEPLOYED' },
  { requestNumber: 'REQ-10540', lineNumber: 1, lineStatus: 'SHIP_TO_SITE' },
  { requestNumber: 'REQ-10380', lineNumber: 1, lineStatus: 'RETURNED' },
]);
const WOS = { 'MA-2300': [{ WorkOrderNumber: 'WO-60000', PlannedStartDate: iso(10), PlannedCompletionDate: iso(11) }] };
const INPUT = { serials: SERIALS, classes: CLASSES, lines: LINES, masterById: MASTERS, locationsById: LOCS, requests: [], linesByRequest: MY_LINES, workOrdersByAsset: WOS };
const model = av.build(INPUT, TODAY);
const EQ_IDS = pv.equipmentIds(SERIALS);

// The page's choices: your window day 7 to day 19, every filter off. ids() is what the page's search, class, yard and
// chip let through (availability.view().ordered), as applyChain hands it over.
const BASE = { from: d(7), to: d(19), viewStart: '2026-11-02', zoom: 'week', groupBy: 'class', chip: 'all', text: '', cls: '', yard: '', collapsed: {}, more: {} };
const ids = (o) => av.view(model, Object.assign({}, BASE, o)).ordered;
const vars = (o) => Object.assign({}, BASE, { equipmentIds: EQ_IDS, gridCollapsed: {}, gridMore: {}, grain: 'equipment' }, o);
const gridOf = (o, g) => pv.grid(model, pv.optionsFrom(vars(o), ids(o), g));
const rowsOf = (gr) => gr.items.filter((i) => i.type === 'row');
const cellText = (r) => r.cells.map((c) => c.text || '·').join(' | ');

T.section('columns: one per yard, "No yard recorded" last');
const g = gridOf({});
T.eq('the yards, in the yard filter\'s order', g.columns.map((c) => c.key).join(), 'DAL-Y2,HOU-Y1,-');
T.eq('a yard\'s code and name, for the header', g.columns.map((c) => c.code + '/' + c.name).join(' | '), 'DAL-Y2/Dallas Yard | HOU-Y1/Houston Yard | No yard recorded/');
T.eq('the CSS columns: the name, one per yard, the two totals', g.cols, 'var(--pv-first) repeat(3, minmax(var(--pv-col), 1fr)) var(--pv-num) var(--pv-num)');
T.eq('one yard picked: that column alone', gridOf({ yard: 'HOU-Y1' }).columns.map((c) => c.key).join(), 'HOU-Y1');
T.eq('"No yard recorded" picked', gridOf({ yard: '-' }).columns.map((c) => c.label).join(), 'No yard recorded');

T.section('rows: equipment, grouped by class');
T.eq('classes as the timeline groups them, equipment by name inside each', g.items.map((i) => (i.type === 'group' ? '[' + i.label + ']' : i.main)).join(' '),
  '[Cranes] Mobile Crane 50t Tower Crane [Excavators] CAT 320 Excavator PC210 Excavator [Lighting] Light Tower');
T.eq('the group rows: the timeline\'s keys, what each holds', g.items.filter((i) => i.type === 'group').map((i) => i.group + ' ' + i.text).join(' | '),
  'c:Cranes 2 items · 3 units · 2 free | c:Excavators 2 items · 5 units · 1 free | c:Lighting 1 item · 1 unit · 1 free');
const row = (gr, main) => rowsOf(gr).find((r) => r.main === main);

T.section('ticks: how many there, how many free in your window');
T.eq('CAT 320 Excavator: two at Houston, none free', cellText(row(g, 'CAT 320 Excavator')), '· | ✓ 2 · 0 free | ·');
T.eq('PC210 Excavator: one at Dallas, two at Houston (one free)', cellText(row(g, 'PC210 Excavator')), '✓ 1 · 0 free | ✓ 2 · 1 free | ·');
T.eq('Tower Crane: a tight one at Dallas counts as free; one with no yard', cellText(row(g, 'Tower Crane')), '✓ 1 · 1 free | · | ✓ 1 · 1 free');
T.eq('coloured by the window: all, some, none free; empty cells stay empty', row(g, 'PC210 Excavator').cells.map((c) => c.state || 'empty').join() + ' ' + row(g, 'Tower Crane').cells.map((c) => c.state || 'empty').join(),
  'none,some,empty all,empty,all');
T.check('the cell\'s class and its tick\'s class carry the state', row(g, 'PC210 Excavator').cells[1].cls.includes('nx-pv-c--some') && row(g, 'PC210 Excavator').cells[1].tickCls === 'nx-pv-tick nx-pv-tick--some'
  && row(g, 'PC210 Excavator').cells[2].cls.includes('nx-pv-c--empty') && row(g, 'PC210 Excavator').cells[2].tickCls === '');
T.eq('the counts behind a cell', ['n', 'free', 'tight', 'booked', 'maint'].map((k) => row(g, 'PC210 Excavator').cells[1][k]).join(), '2,1,0,0,1');
T.check('a cell says it in words on hover, with its serials', row(g, 'PC210 Excavator').cells[1].title.startsWith('PC210 Excavator at HOU-Y1 · Houston Yard: 2 units, 1 free · 1 in maintenance 11 – 23 Nov 2026')
  && row(g, 'PC210 Excavator').cells[1].title.includes('EX-2299, EX-2300'), row(g, 'PC210 Excavator').cells[1].title);
T.eq('row totals: units and free', rowsOf(g).map((r) => r.main + ' ' + r.units + '/' + r.free).join(' | '),
  'Mobile Crane 50t 1/0 | Tower Crane 2/2 | CAT 320 Excavator 2/0 | PC210 Excavator 3/1 | Light Tower 1/1');
T.eq('where each is, in words', rowsOf(g).map((r) => r.sub).join(' | '), 'All at DAL-Y2 | At 2 yards | All at HOU-Y1 | At 2 yards | No yard recorded');
T.eq('the equipment\'s id, when its units name one', rowsOf(g).map((r) => r.equipmentId || '-').join(), '21,22,11,12,-');

T.section('totals per yard');
T.eq('a totals row: units and free per yard', g.totals.cells.map((c) => c.text).join(' | '), '3 · 1 free | 4 · 1 free | 2 · 2 free');
T.eq('and in all, as the capacity panel says', g.totals.units + ' units, ' + g.totals.free + ' free / ' + av.view(model, BASE).capTotal.headline, '9 units, 4 free / 4 of 9 free');
T.eq('the group rows subtotal per yard', g.items.filter((i) => i.type === 'group').map((i) => i.cells.map((c) => c.text || '·').join(' | ')).join(' // '),
  '2 · 1 free | · | 1 · 1 free // 1 · 0 free | 4 · 1 free | · // · | · | 1 · 1 free');
T.eq('the column header knows its count', g.columns.map((c) => c.n + '/' + c.free).join(), '3/1,4/1,2/2');
T.eq('the line above the grid', g.note, '5 equipment items · 9 units in 3 yards · 4 free 11 – 23 Nov 2026');
T.eq('the export menu\'s note', g.exportNote, '5 equipment items by 3 yards, free 11 – 23 Nov 2026');

T.section('free follows your window');
const early = gridOf({ from: d(0), to: d(1) });
T.eq('today and tomorrow: EX-2210 is only out from day 3, EX-2300\'s maintenance is later', cellText(row(early, 'PC210 Excavator')) + ' / ' + cellText(row(early, 'Mobile Crane 50t')), '✓ 1 · 1 free | ✓ 2 · 2 free | · / ✓ 1 · 0 free | · | ·');
const late = gridOf({ from: d(45), to: d(50) });
T.eq('in seven weeks everything is free', late.totals.free + ' of ' + late.totals.units + ' · ' + rowsOf(late).map((r) => r.cells.filter((c) => c.n).map((c) => c.state).join('')).join(','),
  '9 of 9 · all,allall,all,allall,all');
T.check('the cell says which window', row(late, 'PC210 Excavator').cells[1].title.includes(av.range(d(45), d(50))));

T.section('the page\'s search, class, yard and chips');
T.eq('search: a request finds its unit\'s equipment only, every yard still a column', (() => { const s = gridOf({ text: 'req-10560' }); return s.items.map((i) => i.main || '[' + i.label + ']').join(' ') + ' | ' + s.columns.length + ' | ' + s.columns.map((c) => c.n).join(); })(),
  '[Cranes] Mobile Crane 50t | 3 | 1,0,0');
T.check('a column the search leaves empty is marked so', gridOf({ text: 'req-10560' }).columns[1].cls.includes('nx-pv-yard--empty'));
T.eq('search by equipment name', rowsOf(gridOf({ text: 'pc210' })).map((r) => r.main + ' ' + cellText(r)).join(), 'PC210 Excavator ✓ 1 · 0 free | ✓ 2 · 1 free | ·');
T.eq('a class from the capacity panel', gridOf({ cls: 'Excavators' }).items.map((i) => i.main || '[' + i.label + ']').join(' '), '[Excavators] CAT 320 Excavator PC210 Excavator');
T.eq('a yard', rowsOf(gridOf({ yard: 'DAL-Y2' })).map((r) => r.main + ' ' + cellText(r)).join(' / '), 'Mobile Crane 50t ✓ 1 · 0 free / Tower Crane ✓ 1 · 1 free / PC210 Excavator ✓ 1 · 0 free');
T.eq('the chip "Free in your window": only free units counted', rowsOf(gridOf({ chip: 'free' })).map((r) => r.main + ' ' + cellText(r)).join(' / '),
  'Tower Crane ✓ 1 · 1 free | · | ✓ 1 · 1 free / PC210 Excavator · | ✓ 1 · 1 free | · / Light Tower · | · | ✓ 1 · 1 free');
T.eq('the chip "Booked in your window"', rowsOf(gridOf({ chip: 'booked' })).map((r) => r.main + ' ' + r.units + '/' + r.free).join(' / '),
  'Mobile Crane 50t 1/0 / CAT 320 Excavator 2/0 / PC210 Excavator 1/0');
T.eq('nothing matches: no rows, no totals', [gridOf({ text: 'nothing-like-this' }).rows, gridOf({ text: 'nothing-like-this' }).totals.units, gridOf({ text: 'nothing-like-this' }).note].join('|'), '0|0|');

T.section('units: one row per unit, a tick in its yard');
const u = gridOf({ grain: 'units' });
T.eq('by class, then name and serial', u.items.map((i) => (i.type === 'group' ? '[' + i.label + ']' : i.main)).join(' '),
  '[Cranes] MC-07 TC-02 TC-05 [Excavators] EX-2201 EX-2203 EX-2210 EX-2299 EX-2300 [Lighting] ZZ-9');
T.eq('a tick in its yard\'s column only, with its state in your window', rowsOf(u).map((r) => r.main + ' ' + cellText(r)).join(' / '),
  'MC-07 ✓ Booked | · | · / TC-02 · | · | ✓ Free / TC-05 ✓ Free, tight | · | · / EX-2201 · | ✓ Booked | · / EX-2203 · | ✓ Booked | · / '
  + 'EX-2210 ✓ Booked | · | · / EX-2299 · | ✓ Free | · / EX-2300 · | ✓ Maintenance | · / ZZ-9 · | · | ✓ Free');
T.eq('coloured by its state', rowsOf(u).map((r) => r.cells.filter((c) => c.n)[0].tickCls.split('--')[1]).join(), 'booked,free,tight,booked,booked,booked,free,maint,free');
T.check('why, on hover', rowsOf(u).find((r) => r.main === 'EX-2201').cells[1].title.includes('REQ-10511 · Pipeline North'), rowsOf(u).find((r) => r.main === 'EX-2201').cells[1].title);
T.eq('the unit\'s name beside its serial; one not in the unit list says so', rowsOf(u).filter((r) => r.main === 'EX-2201' || r.main === 'ZZ-9').map((r) => r.sub).join(' | '),
  'CAT 320 Excavator | Light Tower · not in the unit list');
T.eq('a unit row opens by serial', rowsOf(u).map((r) => r.serial + ':' + (r.equipmentId || '')).slice(0, 3).join(), 'MC-07:,TC-02:,TC-05:');
T.eq('the same totals per yard', u.totals.cells.map((c) => c.text).join(' | ') + ' · ' + u.totals.units + '/' + u.totals.free, '3 · 1 free | 4 · 1 free | 2 · 2 free · 9/4');
T.eq('the group rows count units', u.items.filter((i) => i.type === 'group').map((i) => i.text).join(' | '), '3 units · 2 free | 5 units · 1 free | 1 unit · 1 free');
T.eq('the line above the grid', u.note, '9 units in 3 yards · 4 free 11 – 23 Nov 2026');
T.eq('the header names the grain', g.head + ' / ' + u.head, 'Equipment / Unit');

T.section('folding and paging');
T.eq('a folded class shows its group row (with its subtotals) only', (() => { const f = gridOf({ gridCollapsed: { 'c:Excavators': true } }); return f.items.map((i) => i.main || '[' + i.label + (i.collapsed ? '+' : '') + ']').join(' ') + ' | ' + f.totals.units; })(),
  '[Cranes] Mobile Crane 50t Tower Crane [Excavators+] [Lighting] Light Tower | 9');
{
  // 260 more units in two big classes, spread over the two yards.
  const many = [];
  for (let i = 1; i <= 260; i++) many.push({ serialNumber: (i <= 180 ? 'GEN-' : 'PMP-') + (1000 + i), equipmentId: i <= 180 ? 31 : 32, currentLocationId: i % 2 ? 501 : 502 });
  const big = av.build(Object.assign({}, INPUT, { serials: SERIALS.concat(many), classes: CLASSES.concat([{ id: 3, className: 'Generators' }, { id: 4, className: 'Pumps' }]),
    masterById: Object.assign({}, MASTERS, { 31: { id: 31, equipmentName: 'Generator', equipmentClassId: 3 }, 32: { id: 32, equipmentName: 'Pump', equipmentClassId: 4 } }) }), TODAY);
  const bigIds = av.view(big, BASE).ordered;
  const bg = (o) => pv.grid(big, pv.optionsFrom(vars(o), bigIds));
  const eq = bg({});
  T.eq('equipment: one row however many units', rowsOf(eq).filter((r) => r.main === 'Generator').map((r) => cellText(r) + ' · ' + r.units + '/' + r.free).join(), '✓ 90 · 90 free | ✓ 90 · 90 free | · · 180/180');
  T.check('a long list of serials is cut short on hover', rowsOf(eq).find((r) => r.main === 'Generator').cells[0].title.endsWith('and 82 more'), rowsOf(eq).find((r) => r.main === 'Generator').cells[0].title);
  const ug = bg({ grain: 'units' });
  const per = (gr) => gr.items.filter((i) => i.type === 'group').map((x) => x.label + ':' + gr.items.filter((i) => i.type === 'row' && i.cells && rowsOf(gr).includes(i) && big.units.find((z) => z.id === i.serial).cls === x.label).length).join(' ');
  T.eq('units: every class, a page of rows each (200 shared out)', per(ug), 'Cranes:3 Excavators:5 Generators:40 Lighting:1 Pumps:40');
  T.eq('a class says what it holds back', ug.items.filter((i) => i.type === 'more').map((i) => i.group + ' ' + i.text).join(' | '),
    'c:Generators Show 100 more of Generators (140 not shown) | c:Pumps Show 40 more of Pumps (40 not shown)');
  T.eq('Show more in one class', per(bg({ grain: 'units', gridMore: { 'c:Generators': pv.MORE_ROWS } })), 'Cranes:3 Excavators:5 Generators:140 Lighting:1 Pumps:40');
  T.eq('the totals count every unit, shown or not', ug.totals.units + ' ' + ug.more, '269 180');
}

T.section('export the grid as shown');
const ex = pv.exportTable(model, pv.optionsFrom(vars({}), ids({})));
T.eq('columns: class, equipment, a column per yard, the totals', ex.columns.map((c) => c.label).join(),
  'Class,Equipment,DAL-Y2 · Dallas Yard,HOU-Y1 · Houston Yard,No yard recorded,Units,Free in your window');
T.eq('totals are numbers', ex.columns.filter((c) => c.type === 'number').map((c) => c.key).join(), 'units,free');
T.eq('a row per equipment, the ticks as on screen, then the totals', ex.rows.map((r) => [r.cls, r.equipment, r.y0, r.y1, r.y2, r.units, r.free].join(';')).join(' / '),
  'Cranes;Mobile Crane 50t;✓ 1 · 0 free;;;1;0 / Cranes;Tower Crane;✓ 1 · 1 free;;✓ 1 · 1 free;2;2 / Excavators;CAT 320 Excavator;;✓ 2 · 0 free;;2;0 / '
  + 'Excavators;PC210 Excavator;✓ 1 · 0 free;✓ 2 · 1 free;;3;1 / Lighting;Light Tower;;;✓ 1 · 1 free;1;1 / ;Total;3 · 1 free;4 · 1 free;2 · 2 free;9;4');
const exf = pv.exportTable(model, pv.optionsFrom(vars({ gridCollapsed: { 'c:Excavators': true } }), ids({})));
T.eq('a folded class still exports', exf.rows.length, 6);
const exu = pv.exportTable(model, pv.optionsFrom(vars({ grain: 'units', yard: 'HOU-Y1' }), ids({ yard: 'HOU-Y1' })));
T.eq('units: serial, equipment, the yard picked, why', exu.columns.map((c) => c.label).join(), 'Class,Unit (serial),Equipment,HOU-Y1 · Houston Yard,In your window,Units,Free in your window');
T.eq('a row per unit', exu.rows.map((r) => [r.serial, r.y0, r.why.split(':')[0], r.free].join(';')).join(' / '),
  'EX-2201;✓ Booked;Booked;0 / EX-2203;✓ Booked;Booked;0 / EX-2299;✓ Free;Free;1 / EX-2300;✓ Maintenance;Maintenance;0 / Total;4 · 1 free;;1');
T.eq('nothing shown: nothing exported', pv.exportTable(model, pv.optionsFrom(vars({}), [])).rows.length, 0);

T.section('the pieces around it');
T.eq('equipment ids from serial-refs: the first per serial, none without a serial', JSON.stringify(EQ_IDS),
  '{"EX-2201":"11","EX-2203":"11","EX-2210":"12","MC-07":"21","TC-02":"22","EX-2299":"12","EX-2300":"12","TC-05":"22"}');
T.eq('same name, two masters: opens by name, not one id', (() => {
  const two = av.build(Object.assign({}, INPUT, { serials: [{ serialNumber: 'A-1', equipmentId: 41 }, { serialNumber: 'A-2', equipmentId: 42 }],
    masterById: { 41: { id: 41, equipmentName: 'Pump', equipmentClassId: 1 }, 42: { id: 42, equipmentName: 'Pump', equipmentClassId: 1 } }, lines: [] }), TODAY);
  const r = rowsOf(pv.grid(two, { ids: two.units.map((x) => x.id), from: d(1), to: d(5), equipmentIds: pv.equipmentIds([{ serialNumber: 'A-1', equipmentId: 41 }, { serialNumber: 'A-2', equipmentId: 42 }]) }));
  return r.map((x) => x.main + ':' + x.units + ':' + (x.equipmentId || 'by name')).join();
})(), 'Pump:2:by name');
T.eq('the options from the page\'s variables', JSON.stringify(pv.optionsFrom({ from: 'a', to: 'b', yard: 'Y', grain: 'units', gridCollapsed: { x: true }, gridMore: {}, equipmentIds: {} }, ['U'])),
  '{"ids":["U"],"from":"a","to":"b","yard":"Y","grain":"units","collapsed":{"x":true},"more":{},"equipmentIds":{}}');
T.eq('an explicit grain wins over the page\'s', pv.optionsFrom({ grain: 'units' }, [], 'equipment').grain, 'equipment');
T.eq('the legend: all, some, none free', pv.legend('equipment').map((k) => k.label).join(), 'All free in your window,Some free,None free');
T.eq('the units legend: the page\'s states', pv.legend('units').map((k) => k.label).join(), 'Free,Free, tight,Booked,Maintenance');
T.eq('no model: an empty grid', [pv.grid(null, {}).rows, pv.grid(null, {}).columns.length, pv.grid(null, {}).cols].join('|'), '0|0|var(--pv-first) var(--pv-num) var(--pv-num)');
T.report();
