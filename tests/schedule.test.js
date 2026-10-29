/*
 * New EquipRite, Equipment schedule (webApps/equiprite/flows/schedule/pages/schedule-page*).
 *
 * Checks the page against the old one it replaces (Old EquipRite main/equipment-schedule):
 *   - the builder gives the same resources and bars as the old page's buildResourcesAndEvents (both run here)
 *   - loading makes exactly the old initSchedulerChain's calls, in the same order (both run against one fake backend)
 *   - neither page writes: every endpoint either one names is a GET in services/
 *   - the pure functions: bar kinds and classes, conflicts, date math, filters, lists, links
 *   - the other chains (filters, view, focus, open request, leave) and what happens when a source fails
 *
 * Run:  node tests/schedule.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEW = path.join(ROOT, 'webApps', 'equiprite');
const OLD = path.join(ROOT, 'webApps', 'vbredwoodapp');
const PAGE = path.join(NEW, 'flows', 'schedule', 'pages');
const CHAINS = path.join(PAGE, 'schedule-page-chains');
const OLD_PAGE = path.join(OLD, 'flows', 'main', 'pages');
const OLD_CHAINS = path.join(OLD_PAGE, 'equipment-schedule-page-chains');

function loadAmd(file, deps) {
  const sandbox = { console, setTimeout, clearTimeout, Promise, Date, Math, Set, Map, Object, Array, Number, String, JSON, isNaN };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const read = (f) => fs.readFileSync(f, 'utf8');
const ActionChain = class {};

const Page = loadAmd(path.join(PAGE, 'schedule-page.js'));
const page = new Page();
const paging = loadAmd(path.join(NEW, 'resources', 'js', 'fetchAllPages.js'));
const OldPage = loadAmd(path.join(OLD_PAGE, 'equipment-schedule-page.js'));
const oldPage = new OldPage({ getEventHelper: () => ({}) });

// ── Fixture: five units, bookings, a shared site, one Fusion work order ─────────────────────────────────────────
const TODAY = '2026-11-10';
const SERIALS = [
  { serialNumber: 'EX-2201', equipmentId: 11, currentLocationId: 501, faAssetRefId: '100482', orgId: 300, maintenanceAssetNumber: 'MA-2201' },
  { serialNumber: 'EX-2203', equipmentId: 11, currentLocationId: 501, faAssetRefId: '100517' },
  { serialNumber: 'EX-2210', equipmentId: 12, equipmentName: 'PC210 (own name)', currentLocationId: 502, maintenanceAssetNumber: 'MA-2210' },
  { serialNumber: '' }, // no serial number: skipped, as the old builder does
  { serialNumber: 'MC-07', equipmentId: 21, currentLocationId: 502, equipmentClassId: 2, mfgYear: 2019 },
  { serialNumber: 'TC-02', equipmentId: 22 },
];
const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Cranes' }];
const MASTERS = {
  11: { id: 11, equipmentName: 'CAT 320 Excavator', equipmentClassId: 1, equipmentType: 'OWNED', manufacturer: 'Caterpillar', mfgYear: 2021 },
  12: { id: 12, equipmentName: 'PC210 Excavator', equipmentClassId: 1, manufacturer: 'Komatsu' },
  21: { id: 21, equipmentName: 'Mobile Crane 50t', equipmentClassId: 2 },
  22: { id: 22, equipmentName: 'Tower Crane', equipmentClassId: 2 },
};
const L = (id, serial, req, reqId, project, status, from, to, extra) => Object.assign({
  eqrRequestLineId: id, eqrEquipmentRequestId: reqId, requestNumber: req, projectName: project, taskName: 'Earthworks',
  requestorName: 'Pat Lee', allocatedSerial: serial, allocStatus: status, requestedStartDate: from ? from + 'T00:00:00Z' : null,
  requestedEndDate: to ? to + 'T00:00:00Z' : null, deploymentLocation: 'Gate 3',
}, extra || {});
const LINES = [
  L(9001, 'EX-2201', 'REQ-10511', 511, 'Pipeline North', 'ALLOCATED', '2026-11-02', '2026-11-15'),
  L(9002, 'EX-2201', 'REQ-10530', 530, 'Plant Expansion B', 'PENDING', '2026-11-12', '2026-12-04'),
  L(9003, 'EX-2203', 'REQ-10530', 530, 'Plant Expansion B', 'in_process', '2026-11-05', '2026-12-20'),
  L(9004, 'EX-2210', 'REQ-10540', 540, 'Pipeline North', 'ALLOCATED', '2026-11-12', '2026-11-18'),
  L(9005, 'MC-07', 'REQ-10498', 498, 'Plant Expansion B', 'MOBILIZATION', '2026-11-01', '2026-12-31'),
  L(9006, 'TC-02', 'REQ-10470', 470, 'Harbour Wall', 'CANCELLED', '2026-11-01', '2026-11-20'),
  L(9007, 'TC-02', 'REQ-10471', 471, 'Harbour Wall', 'ALLOCATED', '2026-11-03', null), // no end: one day
  L(9008, 'MC-07', 'REQ-10400', 400, 'Harbour Wall', 'ALLOCATED', '2026-09-01', '2026-09-30'),
  L(9009, 'MC-07', 'REQ-10401', 401, 'Harbour Wall', 'PARTIAL', '2026-09-20', '2026-10-10'),
  L(9010, 'NOPE-1', 'REQ-1', 1, 'Nowhere', 'ALLOCATED', '2026-11-01', '2026-11-02'), // no such unit
  L(9011, 'EX-2203', 'REQ-10555', 555, 'Plant Expansion B', 'ALLOCATED', null, null), // no start: no bar
];
const LOCS = {
  501: { latitude: 29.76, longitude: -95.37, locationName: 'Houston Yard', locationCode: 'HOU-Y1' },
  502: { latitude: 32.78, longitude: -96.80, locationName: 'Dallas Yard', locationCode: 'DAL-Y2' },
};
const SITES = {
  511: { latitude: 29.8, longitude: -95.4, siteName: 'Pipeline North gate', address: '' },
  530: { latitude: 29.7, longitude: -95.3, siteName: '', address: '12 Plant Rd' },
  540: { latitude: 29.7, longitude: -95.3, siteName: 'Plant B', address: '' }, // same spot as 530: jittered
};
const WOS = {
  'MA-2210': [{ WorkOrderNumber: 'WO-55821', WorkOrderType: 'Preventive', WorkOrderDescription: '500 h service',
    PlannedStartDate: '2026-11-16T08:00:00Z', PlannedCompletionDate: '2026-11-20T17:00:00Z', AssetNumber: 'MA-2210' },
  { WorkOrderNumber: 'WO-55822', PlannedStartDate: null }], // unscheduled: no bar
  'MA-2201': [{ WorkOrderNumber: 'WO-1', WorkOrderStatus: 'Released', PlannedStartDate: '2026-11-08', PlannedCompletionDate: null }],
};
const args = [SERIALS, CLASSES, LINES, LOCS, SITES, MASTERS, WOS];

(async () => {
  T.section('dates');
  T.eq('a timestamp is read as its first ten characters', page.day10('2026-11-02T23:00:00Z'), '2026-11-02');
  T.eq('bar length counts both ends (old formula)', page.spanDays('2026-11-02', '2026-11-27'), 26);
  T.eq('one day', page.spanDays('2026-11-02', '2026-11-02'), 1);
  T.eq('no end date: one day', page.spanDays('2026-11-02', null), 1);
  T.eq('end before start: the old formula takes the distance', page.spanDays('2026-11-10', '2026-11-08'), 3);
  T.eq('last day of a 26-day bar', page.lastDay('2026-11-02', 26), '2026-11-27');
  T.eq('across a month and a year', page.addDays('2026-12-30', 3), '2027-01-02');
  T.eq('label from the date itself (no time zone shift)', page.fmtDay('2026-11-02'), '02 Nov 2026');
  T.eq('range in one month', page.dateRange('2026-11-02', '2026-11-27'), '2 – 27 Nov 2026');
  T.eq('range across months', page.dateRange('2026-11-28', '2026-12-04'), '28 Nov – 4 Dec 2026');
  T.eq('range across years', page.dateRange('2026-12-20', '2027-01-03'), '20 Dec 2026 – 3 Jan 2027');
  T.eq('one-day range', page.dateRange('2026-11-02', '2026-11-02'), '2 Nov 2026');
  T.eq('next month across the year end', page.addMonths('2026-12', 1), '2027-01');
  T.eq('previous month across the year start', page.addMonths('2027-01', -1), '2026-12');
  T.eq('month label', page.monthLabel('2026-11'), 'November 2026');
  T.eq('this month opens a week before today', page.leftDay('2026-11', '2026-11-20'), '2026-11-13');
  T.eq('...but not before the 1st', page.leftDay('2026-11', '2026-11-03'), '2026-11-01');
  T.eq('another month opens on its 1st', page.leftDay('2027-01', '2026-11-20'), '2027-01-01');
  T.eq('today in the browser\'s time zone', page.todayKey(new Date(2026, 10, 9, 23, 30)), '2026-11-09');

  T.section('bars: kind, class, label');
  const kinds = ['ALLOCATED', 'PENDING', 'IN_PROCESS', 'in_process', 'MOBILIZATION', 'MAINTENANCE', 'REJECTED', 'CANCELLED', 'PARTIAL', '', null];
  T.eq('allocation status -> kind', kinds.map((k) => page.barKind(k)).join(','),
    'hard,soft,soft,soft,mobilization,maintenance,cancelled,cancelled,other,other,other');
  T.eq('old bar names', ['ALLOCATED', 'PENDING', 'MOBILIZATION', 'PARTIAL', ''].map((k) => page.displayName(k)).join(','),
    'Booked,Reserved,Mobilization,PARTIAL,BOOKED');
  T.check('a cancelled booking holds nothing; everything else holds the unit',
    !page.holdsUnit('cancelled') && ['hard', 'soft', 'mobilization', 'maintenance', 'other'].every((k) => page.holdsUnit(k)));
  T.eq('hard reserve', page.barClasses({ kind: 'hard' }).join(' '), 'er-sch-bar er-sch-bar--hard');
  T.eq('soft reserve in conflict', page.barClasses({ kind: 'soft', conflict: true }).join(' '), 'er-sch-bar er-sch-bar--soft er-sch-bar--conflict');
  T.eq('another project is dimmed', page.barClasses({ kind: 'hard', projectName: 'A' }, ['B']).join(' '), 'er-sch-bar er-sch-bar--hard er-sch-bar--dim');
  T.eq('the picked project is not', page.barClasses({ kind: 'hard', projectName: 'B' }, new Set(['B'])).join(' '), 'er-sch-bar er-sch-bar--hard');
  T.eq('maintenance is never dimmed', page.barClasses({ kind: 'maintenance', projectName: 'Preventive' }, ['B']).join(' '), 'er-sch-bar er-sch-bar--maintenance');
  T.eq('unknown kind draws as other', page.barClasses({ kind: 'weird' }).join(' '), 'er-sch-bar er-sch-bar--other');
  T.eq('booking label', page.barLabel({ kind: 'hard', requestNumber: 'REQ-1', projectName: 'Pipeline North' }), 'REQ-1 · Pipeline North');
  T.eq('maintenance label carries the work order', page.barLabel({ kind: 'maintenance', workOrderNumber: 'WO-9' }), 'Maintenance · WO-9');
  T.eq('nothing to name: the old bar name', page.barLabel({ kind: 'other', name: 'Booked' }), 'Booked');
  T.eq('legend: the wireframe\'s order, then conflict and today', page.legend().map((l) => l.key).join(','),
    'hard,soft,mobilization,maintenance,other,cancelled,conflict,today');
  T.check('every legend swatch has a style in fulfil.css', page.legend().every((l) => read(path.join(NEW, 'resources', 'css', 'fulfil.css')).includes('.' + l.cls.split(' ')[1])));
  T.check('every bar class has a style in fulfil.css', ['hard', 'soft', 'mobilization', 'maintenance', 'other', 'cancelled', 'conflict', 'dim']
    .every((k) => read(path.join(NEW, 'resources', 'css', 'fulfil.css')).includes('.er-sch-bar--' + k + ' ')));

  T.section('the Gantt is read only, as the old one');
  const f = page.ganttFeatures(() => '', () => '');
  T.check('no drag, resize, edit, drag-create, schedule menu or event menu',
    ['eventDrag', 'eventResize', 'eventEdit', 'eventDragCreate', 'scheduleMenu', 'eventMenu', 'cellEdit'].every((k) => f[k] === false));
  const oldSrc = read(path.join(OLD_PAGE, 'equipment-schedule-page.js'));
  T.check('(the old page had the same switched off)', /eventEdit:\s*false/.test(oldSrc) && /eventResize:\s*false/.test(oldSrc)
    && /eventDrag:\s*false/.test(oldSrc) && /eventDragCreate:\s*false/.test(oldSrc) && /scheduleMenu:\s*false/.test(oldSrc));
  T.check('and the new Gantt is created readOnly', /readOnly:\s*true/.test(read(path.join(PAGE, 'schedule-page.js'))));
  T.eq('grouped by class', f.group.field, 'group_key');
  T.eq('today line, labelled', f.timeRanges.showCurrentTimeLine.name, 'Today');
  T.check('the bar tooltip is a white card (its class is styled)', f.eventTooltip.cls === 'er-sch-tooltip'
    && read(path.join(NEW, 'resources', 'css', 'fulfil.css')).includes('.b-tooltip.er-sch-tooltip'));
  T.eq('scales', ['day', 'week', 'month', 'x'].map((s) => page.presetFor(s).base).join(','), 'dayAndMonth,weekAndMonth,monthAndYear,weekAndMonth');

  T.section('the builder gives what the old page built');
  const built = page.buildResourcesAndEvents(...args, TODAY);
  const old = oldPage.buildResourcesAndEvents(...args);
  T.eq('same units', built.resources.length, old.resources.length);
  const oldResKeys = Object.keys(old.resources[0]);
  T.check('every unit field the old builder set is the same', built.resources.every((r, i) => oldResKeys.every((k) => JSON.stringify(r[k]) === JSON.stringify(old.resources[i][k]))),
    oldResKeys.filter((k) => built.resources.some((r, i) => JSON.stringify(r[k]) !== JSON.stringify(old.resources[i][k]))).join(','));
  T.eq('same bars', built.events.length, old.events.length);
  const oldEvKeys = new Set();
  old.events.forEach((e) => Object.keys(e).forEach((k) => oldEvKeys.add(k)));
  ['eventColor', 'lblStartDate', 'lblEndDate'].forEach((k) => oldEvKeys.delete(k)); // colour now by class; labels re-formatted
  const diff = [];
  built.events.forEach((e, i) => oldEvKeys.forEach((k) => { if (JSON.stringify(e[k]) !== JSON.stringify(old.events[i][k])) { diff.push(e.id + '.' + k); } }));
  T.eq('every bar field the old builder set is the same (ids, unit, name, status, project, task, site, start, duration, pin)', diff.join(','), '');
  T.check('...including the old row dot status', built.resources.map((r) => r.status).join() === 'deployed,reserved,deployed,deployed,deployed');
  T.eq('same window start as the old page (1st of the earliest bar\'s month)', built.windowStart, '2026-09-01');
  T.eq('three years long', built.windowEnd, '2029-09-01');
  const oldStart = old.startDate;
  T.eq('(the old page: the same month)', oldStart.getFullYear() + '-' + String(oldStart.getMonth() + 1).padStart(2, '0'), '2026-09');
  const ev = (req) => built.events.find((e) => e.requestNumber === req);
  T.eq('kind and last day kept on the bar', ev('REQ-10511').kind + ' ' + ev('REQ-10511').endDay, 'hard 2026-11-15');
  T.eq('the line and request ids travel with the bar', [ev('REQ-10511').lineId, ev('REQ-10511').requestId, ev('REQ-10511').equipmentMasterId].join(), '9001,511,11');
  T.eq('a work order is a maintenance bar from planned start to completion', (() => {
    const w = built.events.find((e) => e.workOrderNumber === 'WO-55821');
    return [w.kind, w.startDay, w.endDay, w.duration, w.address.lat].join();
  })(), 'maintenance,2026-11-16,2026-11-20,5,');
  T.eq('an unscheduled work order has no bar', built.events.filter((e) => e.workOrderNumber === 'WO-55822').length, 0);
  T.eq('a booking sharing a site is moved onto the ring', ev('REQ-10540').address.lat !== 29.7 && Math.abs(ev('REQ-10540').address.lat - 29.7) < 0.0001, true);
  T.eq('yard from the current location only', built.resources.map((r) => r.yard_key + '=' + r.yard_label).join('|'),
    'HOU-Y1=HOU-Y1 · Houston Yard|HOU-Y1=HOU-Y1 · Houston Yard|DAL-Y2=DAL-Y2 · Dallas Yard|DAL-Y2=DAL-Y2 · Dallas Yard|=No location');
  T.eq('...though the old location fallback (booking site) still shows', built.resources[4].location, 'Gate 3');

  T.section('conflicts (FDD S32)');
  const B = (id, rid, kind, s, e) => ({ id, resourceId: rid, kind, startDay: s, endDay: e });
  const c1 = page.findConflicts([B(1, 1, 'hard', '2026-11-01', '2026-11-10'), B(2, 1, 'soft', '2026-11-10', '2026-11-20')]);
  T.eq('sharing one day is a conflict', JSON.stringify(c1), JSON.stringify([{ id: '1-2', resourceId: 1, a: 1, b: 2, type: 'double', from: '2026-11-10', to: '2026-11-10' }]));
  T.eq('back to back is not', page.findConflicts([B(1, 1, 'hard', '2026-11-01', '2026-11-10'), B(2, 1, 'soft', '2026-11-11', '2026-11-20')]).length, 0);
  T.eq('other units do not clash', page.findConflicts([B(1, 1, 'hard', '2026-11-01', '2026-11-10'), B(2, 2, 'hard', '2026-11-01', '2026-11-10')]).length, 0);
  T.eq('a booking in maintenance', page.findConflicts([B(1, 1, 'maintenance', '2026-11-05', '2026-11-06'), B(2, 1, 'hard', '2026-11-01', '2026-11-30')])[0].type, 'maintenance');
  T.eq('two work orders together are not a conflict', page.findConflicts([B(1, 1, 'maintenance', '2026-11-05', '2026-11-06'), B(2, 1, 'maintenance', '2026-11-01', '2026-11-30')]).length, 0);
  T.eq('a cancelled booking clashes with nothing', page.findConflicts([B(1, 1, 'cancelled', '2026-11-05', '2026-11-06'), B(2, 1, 'hard', '2026-11-01', '2026-11-30')]).length, 0);
  T.eq('three at once: every pair', page.findConflicts([B(1, 1, 'hard', '2026-11-01', '2026-11-30'), B(2, 1, 'soft', '2026-11-05', '2026-11-06'), B(3, 1, 'other', '2026-11-06', '2026-11-08')]).map((c) => c.id).join(),
    '1-2,1-3,2-3');
  T.eq('a clash that ended before today is history', page.findConflicts([B(1, 1, 'hard', '2026-09-01', '2026-09-30'), B(2, 1, 'hard', '2026-09-20', '2026-10-10')], TODAY).length, 0);
  T.eq('...one still running counts', page.findConflicts([B(1, 1, 'hard', '2026-11-01', '2026-11-30'), B(2, 1, 'hard', '2026-11-05', '2026-11-12')], TODAY).length, 1);
  T.check('overlaps() agrees', page.overlaps(B(1, 1, 'hard', '2026-11-01', '2026-11-10'), B(2, 1, 'hard', '2026-11-10', '2026-11-12'))
    && !page.overlaps(B(1, 1, 'hard', '2026-11-01', '2026-11-09'), B(2, 1, 'hard', '2026-11-10', '2026-11-12')));

  const model = page.prepare(built, TODAY);
  T.eq('fixture: the open conflicts (WO-1 on 8 Nov clashed with REQ-10511, but that is over by the 10th)',
    model.conflicts.map((c) => c.type + ':' + [c.a, c.b].map((id) => { const e = model.events.find((x) => x.id === id); return e.requestNumber || e.workOrderNumber; }).join('/')).join(' '),
    'double:REQ-10511/REQ-10530 maintenance:REQ-10540/WO-55821');
  T.eq('conflicting bars are flagged', model.events.filter((e) => e.conflict).map((e) => e.requestNumber || e.workOrderNumber).sort().join(), 'REQ-10511,REQ-10530,REQ-10540,WO-55821');
  T.eq('the past clash on MC-07 is not', model.events.filter((e) => /REQ-1040/.test(e.requestNumber) && e.conflict).length, 0);
  T.eq('units count their conflicts', model.resources.map((r) => r.serial_number + ':' + r.conflict_count).join(), 'EX-2201:1,EX-2210:1,EX-2203:0,MC-07:0,TC-02:0');
  T.eq('rows: class with conflicts first, conflicted units first in it', model.resources.map((r) => r.serial_number).join(), 'EX-2201,EX-2210,EX-2203,MC-07,TC-02');
  T.eq('group headings', [...new Set(model.resources.map((r) => page.groupLabel(r.group_key)))].join(), 'Excavators,Cranes');
  T.eq('in maintenance today wins the row dot (EX-2210: WO 16–20 Nov is not today; EX-2201: WO-1 on 8 Nov is not)', model.resources.map((r) => r.status).join(),
    'deployed,deployed,reserved,deployed,deployed');
  const m2 = page.prepare(built, '2026-11-17');
  T.eq('...and on 17 Nov EX-2210 is in maintenance', m2.resources.find((r) => r.serial_number === 'EX-2210').status, 'maintenance');
  T.eq('conflicts in a class group', page.groupClashes(model, model.resources[0].group_key, null), 2);
  T.eq('...of those shown', page.groupClashes(model, model.resources[0].group_key, new Set([model.resources[0].id])), 1);

  T.section('filters and lists');
  const ids = (fl) => page.filterUnits(model, fl).map((id) => model.resources.find((r) => r.id === id).serial_number).join();
  T.eq('no filter: every unit, in row order', ids({}), 'EX-2201,EX-2210,EX-2203,MC-07,TC-02');
  T.eq('class', ids({ classes: ['Cranes'] }), 'MC-07,TC-02');
  T.eq('yard', ids({ yards: ['DAL-Y2'] }), 'EX-2210,MC-07');
  T.eq('no location is a yard choice too', ids({ yards: [''] }), 'TC-02');
  T.eq('project: units booked on it', ids({ projects: ['Harbour Wall'] }), 'MC-07,TC-02');
  T.eq('conflicts only', ids({ conflictsOnly: true }), 'EX-2201,EX-2210');
  T.eq('search: every word, across unit and bookings', ids({ text: 'plant  cat' }), 'EX-2201,EX-2203');
  T.eq('search: requestor, request, work order', [ids({ text: 'pat lee' }).split(',').length, ids({ text: 'req-10498' }), ids({ text: 'wo-55821' })].join('|'), '5|MC-07|EX-2210');
  T.eq('filters combine', ids({ classes: ['Excavators'], yards: ['HOU-Y1'], conflictsOnly: true }), 'EX-2201');
  T.eq('class choices with unit counts', page.filterOptions(model, 'class', ['Cranes']).map((o) => o.label + ':' + o.count + (o.on ? '*' : '')).join(), 'Cranes:2*,Excavators:3');
  T.eq('project choices count units, not bookings', page.filterOptions(model, 'project', []).map((o) => o.label + ':' + o.count).join(), 'Harbour Wall:2,Pipeline North:2,Plant Expansion B:3');
  T.eq('yard choices', page.filterOptions(model, 'yard', []).map((o) => o.label + ':' + o.count).join(), 'DAL-Y2 · Dallas Yard:2,HOU-Y1 · Houston Yard:2,No location:1');
  const yards = page.filterOptions(model, 'yard', []);
  T.eq('chip text', [page.filterChipText('Yard', [], yards), page.filterChipText('Yard', ['HOU-Y1'], yards), page.filterChipText('Class', ['A', 'B', 'C', 'D'], [])].join(' | '),
    'Yard | Yard: HOU-Y1 · Houston Yard | Class: A, B +2');
  T.eq('toggle', JSON.stringify([page.toggle(['a'], 'b'), page.toggle(['a', 'b'], 'a'), page.toggle(null, '')]), '[["a","b"],["b"],[""]]');

  const link = page.oldLineLink('http://old/', ev('REQ-10511'));
  T.eq('a booking links to its line in Old EquipRite (where the unit and dates change)', link,
    'http://old/vp/shell/equipment-foundation/line-detail?requestId=511&requestNumber=REQ-10511&lineId=9001&equipmentMasterId=11');
  const oldRow = read(path.join(OLD, 'flows', 'equipment-foundation', 'pages', 'request-detail-page-chains', 'rowClickChain.js'));
  T.check('...with the parameters the old app opens line-detail with', ['requestId', 'requestNumber', 'lineId', 'equipmentMasterId'].every((p) => new RegExp(p + ':').test(oldRow)));
  T.eq('no old link for maintenance or without the app address', [page.oldLineLink('http://old/', built.events.find((e) => e.kind === 'maintenance')), page.oldLineLink('', ev('REQ-10511'))].join('|'), '|');

  const rows = page.conflictRows(model, 'http://old');
  T.eq('conflict panel rows', rows.map((r) => r.unit + ' / ' + r.title + ' / ' + r.when).join(' | '),
    'CAT 320 Excavator / Double booking / 12 – 15 Nov 2026 | PC210 (own name) / Booked during maintenance / 16 – 18 Nov 2026');
  T.eq('each with both bars and what can be done', JSON.stringify(rows[0].items.map((i) => [i.label, i.kindLabel, i.dates, i.canOpen, !!i.oldLink])),
    JSON.stringify([['REQ-10511 · Pipeline North', 'Hard reserve', '2 – 15 Nov 2026', true, true], ['REQ-10530 · Plant Expansion B', 'Soft reserve', '12 Nov – 4 Dec 2026', true, true]]));
  T.eq('a maintenance bar cannot be opened as a request', rows[1].items.find((i) => i.kind === 'maintenance').canOpen + ' ' + rows[1].items[1].label, 'false Maintenance · WO-55821');
  T.eq('the panel follows the filter', page.conflictRows(model, '', page.filterUnits(model, { classes: ['Cranes'] })).length, 0);
  const list = page.listRows(model, null, 3);
  T.eq('list is capped', list.length, 3);
  T.eq('list row', JSON.stringify((({ name, sub, where, statusLabel, conflicts, next }) => ({ name, sub, where, statusLabel, conflicts, next }))(list[0])),
    JSON.stringify({ name: 'CAT 320 Excavator', sub: 'EX-2201 · FA 100482 · Excavators', where: 'HOU-Y1 · Houston Yard', statusLabel: 'Deployed', conflicts: 1,
      next: 'REQ-10511 · Pipeline North · 2 – 15 Nov 2026' }));
  const mc = page.listRows(model, [model.resources.find((r) => r.serial_number === 'MC-07').id])[0];
  T.eq('current and upcoming bars listed, earlier ones counted', mc.bookings.length + ' + ' + mc.earlier + ' earlier', '1 + 2 earlier');
  const tc = page.listRows(model, [model.resources.find((r) => r.serial_number === 'TC-02').id])[0];
  T.eq('a cancelled booking is not "next"', tc.next, 'Nothing booked ahead');
  T.eq('summary', JSON.stringify(page.summary(model)), JSON.stringify({ units: 5, totalUnits: 5, bookings: 5, conflicts: 2, maintenance: 0 }));
  T.eq('band line', page.summaryText(page.summary(model, page.filterUnits(model, { classes: ['Cranes'] }))), '2 of 5 units · 1 current or upcoming booking · no conflicts');
  T.eq('band line while loading', page.summaryText(null, true), 'Loading the fleet…');
  const ring = page.ringOffsets([{ id: 1, latitude: 29.76, longitude: -95.37 }, { id: 2, latitude: '29.76', longitude: -95.37 },
    { id: 3, latitude: 32.78, longitude: -96.8 }, { id: 4, latitude: null, longitude: 1 }]);
  T.eq('pins sharing a spot go on a ring (about 10 m), a lone one stays, no location no pin',
    JSON.stringify([ring[1].dLat.toFixed(5), ring[2].dLat.toFixed(5), ring[3].dLat, ring[4]]), JSON.stringify(['0.00009', '-0.00009', 0, undefined]));
  {
    const p = new Page();
    p._index(model);
    p.applyGanttFilter([1, 2], ['Pipeline North']);
    p.setScale('day');
    p.scrollToMonth('2027-02');
    T.eq('what is asked while Bryntum still loads is kept for it (filter, scale, month)', JSON.stringify(p._asked),
      JSON.stringify({ filter: { ids: [1, 2], projects: ['Pipeline North'] }, scale: 'day', month: '2027-02' }));
  }
  const tip = page.tooltipHtml({ kind: 'hard', requestNumber: '<b>R</b>', projectName: 'A & B', startDay: '2026-11-02', endDay: '2026-11-03' }, { equipment_name: '"x"' });
  T.check('the tooltip escapes what it shows', tip.includes('&lt;b&gt;R&lt;/b&gt;') && tip.includes('A &amp; B') && tip.includes('&quot;x&quot;') && !tip.includes('<b>R'));

  T.section('loading: the old calls, in the old order');
  function backend(fail) {
    const calls = [];
    const chains = [];
    const Actions = {
      async callRest(context, o) {
        calls.push(o.endpoint + ' ' + JSON.stringify(o.uriParams || {}));
        if (fail && fail(o)) {
          if (fail(o) === 'throw') { throw new Error('network'); }
          return { ok: false, status: 503, body: {} };
        }
        const e = o.endpoint;
        const u = o.uriParams || {};
        if (e === 'eqp-v1/getSerialRefs') { return { ok: true, body: { data: SERIALS } }; }
        if (e === 'eqp-v1/getEquipmentClasses') { return { ok: true, body: { data: CLASSES, hasMore: false } }; }
        if (e === 'eqp-v1/getEquipriteV1ViewsWorkbenchLines') { return { ok: true, body: { data: LINES.concat([LINES[0]]) } }; }
        if (e === 'eqp-v1/getShipToSites') {
          return { ok: true, body: { data: Object.keys(SITES).map((k) => Object.assign({ equipmentRequestId: Number(k) }, SITES[k])) } };
        }
        if (e === 'eqp-v1/getEquipriteV1EquipmentMaster') { return { ok: true, body: { data: Object.values(MASTERS), recordCount: 4 } }; }
        if (e === 'eqp-v1/getLocationById') { return LOCS[u.id] ? { ok: true, body: LOCS[u.id] } : { ok: false, status: 404 }; }
        if (e === 'ProjectLOV/getInstalledBaseAssets') {
          return { ok: true, body: { items: u.q.includes('MA-2210') ? [{ AssetId: 300100, OperatingOrganizationCode: 'HOU' }] : (u.q.includes('MA-2201') ? [{ AssetId: null }] : []) } };
        }
        if (e === 'ProjectLOV/getMaintenanceWorkOrders') {
          return { ok: true, body: { items: u.q === "AssetId=300100 and OrganizationCode='HOU'" ? WOS['MA-2210'] : [] } };
        }
        return { ok: true, body: { data: [] } };
      },
      async callChain(context, c) {
        chains.push(c.chain);
        const Chain = loadChain(c.chain, Actions);
        return new Chain().run(context, c.params || {});
      },
      async navigateToFlow(context, n) { calls.push('navigate ' + JSON.stringify(n)); },
      async navigateToPage(context, n) { calls.push('navigate ' + JSON.stringify(n)); },
    };
    return { calls, chains, Actions };
  }
  function loadChain(name, Actions) {
    return loadAmd(path.join(CHAINS, name + '.js'), { 'vb/action/actionChain': ActionChain, 'vb/action/actions': Actions, 'resources/js/fetchAllPages': paging });
  }
  const PAGE_VARS = JSON.parse(read(path.join(PAGE, 'schedule-page.json'))).variables;
  function makeContext(fns) {
    const variables = {};
    Object.keys(PAGE_VARS).forEach((k) => { variables[k] = JSON.parse(JSON.stringify(PAGE_VARS[k].defaultValue === undefined ? null : PAGE_VARS[k].defaultValue)); });
    return { $page: { variables, functions: fns }, $application: { variables: { oldAppUrl: 'http://old/' }, functions: {} } };
  }
  function viewStub() {
    const p = new Page();
    p.calls = [];
    p.renderGantt = async (m, v) => { p.calls.push('gantt ' + m.resources.length + ' ' + v.scale + ' ' + v.month); return true; };
    p.renderMap = async () => { p.calls.push('map'); return false; };
    p.applyGanttFilter = (ids2, projects) => { p.calls.push('filter ' + ids2.length + ' ' + (projects || []).join('/')); };
    ['setScale', 'scrollToMonth', 'resizeMap', 'setMapStyle', 'focusEvent', 'focusUnit', 'destroyViews'].forEach((k) => {
      p[k] = (...a) => { p.calls.push((k + ' ' + a.filter((x) => x !== undefined).join(' ')).trim()); };
    });
    return p;
  }

  // The old chain, run as it is, against the same backend.
  const oldRun = backend();
  const OldChain = loadAmd(path.join(OLD_CHAINS, 'initSchedulerChain.js'), {
    'vb/action/actionChain': ActionChain, 'vb/action/actions': oldRun.Actions,
    'resources/js/fetchAllPages': loadAmd(path.join(OLD, 'resources', 'js', 'fetchAllPages.js')),
  });
  let oldBuiltWith = null;
  await new OldChain().run({ $page: { variables: {}, functions: {
    buildResourcesAndEvents: (...a) => { oldBuiltWith = a; return { resources: [], events: [], startDate: null, endDate: null }; },
    initScheduler: () => {},
  } } });

  const newRun = backend();
  const fns = viewStub();
  let newBuiltWith = null;
  const realBuild = fns.buildResourcesAndEvents.bind(fns);
  fns.buildResourcesAndEvents = (...a) => { newBuiltWith = a; return realBuild(...a); };
  const ctx = makeContext(fns);
  await new (loadChain('loadScheduleChain', newRun.Actions))().run(ctx);
  T.check('the old chain ran here', oldRun.calls.length > 10, oldRun.calls.length + ' calls');
  T.eq('the same calls with the same parameters in the same order', newRun.calls.join('\n'), oldRun.calls.join('\n'));
  T.eq('...which are', newRun.calls.map((c) => c.split(' ')[0].split('/')[1]).join(','),
    'getSerialRefs,getEquipmentClasses,getEquipriteV1ViewsWorkbenchLines,getShipToSites,getEquipriteV1EquipmentMaster,getLocationById,getLocationById,'
    + 'getEquipriteV1EquipmentMaster,getInstalledBaseAssets,getInstalledBaseAssets,getMaintenanceWorkOrders,getMaintenanceWorkOrders,'
    + 'getMaintenanceWorkOrders,getMaintenanceWorkOrders,getMaintenanceWorkOrders');
  T.eq('the work-order ladder: an asset with no id or org gets one try; MA-2210 number, number + org, id, id + org (the old order)',
    newRun.calls.filter((c) => c.includes('getMaintenanceWorkOrders')).map((c) => JSON.parse(c.slice(c.indexOf('{'))).q).join(' ; '),
    "AssetNumber='MA-2201' ; AssetNumber='MA-2210' ; AssetNumber='MA-2210' and OrganizationCode='HOU' ; AssetId=300100 ; AssetId=300100 and OrganizationCode='HOU'");
  T.eq('the builder got what the old one got (lines deduped, locations, sites, masters, work orders)', JSON.stringify(newBuiltWith), JSON.stringify(oldBuiltWith));
  const v = ctx.$page.variables;
  T.eq('the page is filled', [v.isLoading, v.loadError, v.model.resources.length, v.conflictRows.length, v.listRows.length, v.visibleIds.length].join(), 'false,,5,' + v.model.conflicts.length + ',5,5');
  T.eq('then the views are drawn, the map failed', [fns.calls.filter((c) => /^(gantt|map)/.test(c)).join(' | '), v.ganttState, v.mapState].join(' / '),
    'gantt 5 week ' + v.viewMonth + ' | map / ready / failed');
  T.check('the month starts at this month', /^\d{4}-\d{2}$/.test(v.viewMonth));
  T.eq('filters applied once, to the Gantt too', newRun.chains.join() + ' ' + fns.calls.filter((c) => c.startsWith('filter')).join(), 'applyFilterChain filter 5 ');
  T.eq('no notes when every source answered', v.notes.length, 0);

  T.section('loading: when a source fails');
  {
    const run = backend((o) => o.endpoint === 'eqp-v1/getSerialRefs');
    const f2 = viewStub();
    const c = makeContext(f2);
    await new (loadChain('loadScheduleChain', run.Actions))().run(c);
    T.check('no units: says so, draws nothing', c.$page.variables.loadError.includes('HTTP 503') && c.$page.variables.ganttState === 'empty'
      && !f2.calls.some((x) => x.startsWith('gantt')), c.$page.variables.loadError);
  }
  {
    const run = backend((o) => (o.endpoint === 'eqp-v1/getEquipriteV1ViewsWorkbenchLines' || o.endpoint === 'eqp-v1/getShipToSites'));
    const c = makeContext(viewStub());
    await new (loadChain('loadScheduleChain', run.Actions))().run(c);
    T.eq('no bookings or sites: units still drawn, both noted', [c.$page.variables.model.resources.length, c.$page.variables.notes.length, c.$page.variables.ganttState].join(), '5,2,ready');
  }
  {
    const run = backend((o) => (o.endpoint === 'eqp-v1/getLocationById' && o.uriParams.id === 502 ? 'throw' : false));
    const c = makeContext(viewStub());
    await new (loadChain('loadScheduleChain', run.Actions))().run(c);
    T.check('a location that fails: noted, the rest kept', c.$page.variables.notes[0] === '1 of 2 unit locations could not be loaded: those units have no map pin or yard.'
      && c.$page.variables.model.resources.find((r) => r.serial_number === 'EX-2201').yard_key === 'HOU-Y1', c.$page.variables.notes.join());
  }
  {
    const run = backend((o) => (o.endpoint.startsWith('ProjectLOV/') ? 'throw' : false));
    const c = makeContext(viewStub());
    await new (loadChain('loadScheduleChain', run.Actions))().run(c);
    T.check('Fusion down: the schedule without maintenance bars (the old behaviour)', c.$page.variables.model.events.every((e) => e.kind !== 'maintenance')
      && !c.$page.variables.loadError && c.$page.variables.ganttState === 'ready');
  }
  {
    const run = backend();
    const f2 = viewStub();
    f2.renderGantt = async () => false;
    const c = makeContext(f2);
    await new (loadChain('loadScheduleChain', run.Actions))().run(c);
    T.eq('Bryntum cannot load: the timeline becomes the list', c.$page.variables.ganttState, 'failed');
  }

  T.section('filter, view, focus, open, leave');
  {
    const run = backend();
    const f2 = viewStub();
    const c = makeContext(f2);
    await new (loadChain('loadScheduleChain', run.Actions))().run(c);
    const Set_ = loadChain('setFilterChain', run.Actions);
    const go = (p) => new Set_().run(c, p);
    const vars = c.$page.variables;
    await go({ kind: 'open', value: 'class' });
    T.eq('open a filter', vars.openFilter, 'class');
    await go({ kind: 'open', value: 'class' });
    T.eq('...and close it', vars.openFilter, '');
    await go({ kind: 'class', value: 'Cranes' });
    T.eq('pick a class', [vars.filters.classes.join(), vars.visibleIds.length, vars.conflictRows.length].join(), 'Cranes,2,0');
    T.eq('the Gantt is narrowed too', f2.calls.filter((x) => x.startsWith('filter')).pop(), 'filter 2 ');
    await go({ kind: 'project', value: 'Harbour Wall' });
    T.eq('pick a project: dims the others in the Gantt', f2.calls.filter((x) => x.startsWith('filter')).pop(), 'filter 2 Harbour Wall');
    await go({ kind: 'clear', value: 'class' });
    T.eq('clear one filter', [vars.filters.classes.length, vars.filters.projects.length].join(), '0,1');
    await go({ kind: 'conflicts' });
    T.eq('conflicts only', [vars.filters.conflictsOnly, vars.visibleIds.length].join(), 'true,0');
    await go({ kind: 'clear', value: '' });
    T.eq('clear all', [vars.filters.conflictsOnly, vars.filters.projects.length, vars.visibleIds.length].join(), 'false,0,5');
    await go({ kind: 'yard', value: '' });
    T.eq('the "No location" yard can be picked', vars.visibleIds.length, 1);
    await go({ kind: 'yard', value: '' });
    await go({ kind: 'text', value: 'crane' });
    T.eq('search', vars.visibleIds.length, 2);
    vars.listLimit = 1;
    await go({ kind: 'text', value: '' });
    T.eq('a filter change resets the list length', vars.listLimit, 60);
    T.eq('an unknown kind changes nothing', await go({ kind: 'bogus' }), undefined);

    const View = loadChain('setViewChain', run.Actions);
    const view = (p) => new View().run(c, p);
    f2.calls.length = 0;
    const start = vars.viewMonth;
    await view({ scale: 'day' });
    await view({ scale: 'day' });
    await view({ scale: 'year' });
    T.eq('scale changes once, unknown scales ignored', [vars.scale, f2.calls.join('|')].join(' / '), 'day / setScale day ' + start);
    f2.calls.length = 0;
    await view({ month: 'next' });
    await view({ month: 'next' });
    await view({ month: 'prev' });
    T.eq('month next, next, prev', vars.viewMonth, page.addMonths(start, 1));
    await view({ month: 'today' });
    T.eq('today', vars.viewMonth, page.monthKey(new Date()));
    T.eq('...each scrolls the Gantt', f2.calls.filter((x) => x.startsWith('scrollToMonth')).length, 4);
    f2.calls.length = 0;
    await view({ panel: 'list' });
    await view({ panel: 'map' });
    await view({ panel: 'globe' });
    T.eq('Map / List (the map is resized when it comes back)', [vars.panel, f2.calls.join('|')].join(' / '), 'map / resizeMap');
    await view({ mapStyle: 'satellite' });
    T.eq('map style', vars.mapStyle, 'satellite');
    await view({ conflictsOpen: 'toggle' });
    T.eq('fold the conflict panel', vars.conflictsOpen, false);
    vars.listLimit = 1;
    await new Set_().run(c, { kind: 'text', value: '' });
    await view({ more: true });
    T.eq('show every unit in the list', [vars.listLimit, vars.listRows.length].join(), '5,5');

    const Month = loadChain('monthInViewChain', run.Actions);
    await new Month().run(c, { month: '2027-03' });
    await new Month().run(c, { month: 'nonsense' });
    T.eq('the band follows a scroll; nonsense is ignored', vars.viewMonth, '2027-03');

    f2.calls.length = 0;
    const Focus = loadChain('focusChain', run.Actions);
    await new Focus().run(c, { eventId: '3' });
    await new Focus().run(c, { unitId: '5' });
    await new Focus().run(c, { eventId: '' });
    T.eq('focus a bar, a unit; nothing for nothing', f2.calls.join('|'), 'focusEvent 3|focusUnit 5');

    run.calls.length = 0;
    const Open = loadChain('openRequestChain', run.Actions);
    await new Open().run(c, { requestId: '511', requestNumber: 'REQ-10511' });
    await new Open().run(c, { requestId: 'undefined', requestNumber: '' });
    T.eq('open the request in New EquipRite\'s Request detail', run.calls.join('|'),
      'navigate {"flow":"request","page":"request-detail","target":"parent","params":{"requestId":"REQ-10511","requestNumericId":511}}');

    f2.calls.length = 0;
    await new (loadChain('leaveChain', run.Actions))().run(c);
    T.eq('leaving frees the views', f2.calls.join(), 'destroyViews');
  }

  T.section('nothing writes, here or in the old page');
  const ops = {};
  ['eqp-v1', 'ProjectLOV', 'bipService', 'commonService'].forEach((svc) => {
    const spec = JSON.parse(read(path.join(ROOT, 'services', svc, 'openapi3.json')));
    Object.values(spec.paths || {}).forEach((p) => Object.entries(p).forEach(([method, op]) => {
      if (op && op.operationId) { ops[svc + '/' + op.operationId] = method.toUpperCase(); }
    }));
  });
  const endpointsIn = (dir, extra) => {
    const out = new Set();
    fs.readdirSync(dir).filter((x) => x.endsWith('.js')).map((x) => path.join(dir, x)).concat(extra || []).forEach((file) => {
      (read(file).match(/'(eqp-v1|ProjectLOV|bipService|commonService)\/[A-Za-z0-9]+'/g) || []).forEach((m) => out.add(m.slice(1, -1)));
    });
    return [...out].sort();
  };
  const mine = endpointsIn(CHAINS, [path.join(PAGE, 'schedule-page.js')]);
  const theirs = endpointsIn(OLD_CHAINS, [path.join(OLD_PAGE, 'equipment-schedule-page.js')]);
  T.eq('the new page names the old page\'s endpoints, no others', mine.join(), theirs.join());
  mine.forEach((e) => T.eq(e + ' is a GET in services/', ops[e], 'GET'));
  T.check('no chain calls a write action', fs.readdirSync(CHAINS).every((x) => !/method:\s*'(POST|PUT|PATCH|DELETE)'|callRest\([^)]*body:/.test(read(path.join(CHAINS, x)))));

  T.section('wiring and copies');
  const pj = JSON.parse(read(path.join(PAGE, 'schedule-page.json')));
  const named = new Set();
  Object.values(pj.eventListeners).forEach((l) => l.chains.forEach((c) => named.add(c.chain)));
  T.check('every chain the page names exists', [...named].every((c) => fs.existsSync(path.join(CHAINS, c + '.js'))), [...named].join());
  T.check('every chain file is named by the page or called by one', fs.readdirSync(CHAINS).every((x) => named.has(x.replace('.js', '')) || x === 'applyFilterChain.js'));
  const html = read(path.join(PAGE, 'schedule-page.html'));
  const listeners = (html.match(/\$listeners\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]);
  T.check('every listener the template uses is declared', listeners.every((l) => pj.eventListeners[l]), listeners.filter((l) => !pj.eventListeners[l]).join());
  const fnsUsed = (html.match(/\$functions\.([A-Za-z]+)/g) || []).map((m) => m.split('.')[1]);
  T.check('every page function the template uses exists', fnsUsed.every((n) => typeof page[n] === 'function'), fnsUsed.filter((n) => typeof page[n] !== 'function').join());
  T.check('the custom event the module raises is declared and handled', !!pj.events.scheduleMonthInView && !!pj.eventListeners.scheduleMonthInView
    && read(path.join(PAGE, 'schedule-page.js')).includes("_fire('scheduleMonthInView'"));
  T.eq('enforcePageAccessChain is the shared copy', read(path.join(CHAINS, 'enforcePageAccessChain.js')),
    read(path.join(NEW, 'flows', 'request', 'pages', 'my-requests-page-chains', 'enforcePageAccessChain.js')));
  ['resources/js/fetchAllPages.js', 'resources/js/schedulerpro.umd.js', 'resources/js/mapbox-gl.js',
    'resources/css/schedulerpro.classic.css', 'resources/css/bryntum-shim.css', 'resources/css/mapbox-gl.css'].forEach((p) => {
    T.check(p + ' is the old app\'s file, unchanged', fs.readFileSync(path.join(NEW, p)).equals(fs.readFileSync(path.join(OLD, p))));
  });
  const newFlow = JSON.parse(read(path.join(NEW, 'app-flow.json')));
  const oldFlow = JSON.parse(read(path.join(OLD, 'app-flow.json')));
  T.check('requirejs paths for Bryntum and Mapbox are the old app\'s', ['schedulerPro', 'mapboxgl'].every((k) => newFlow.requirejs.paths[k] === oldFlow.requirejs.paths[k]));
  T.check('their stylesheets load with the page, not on every page', pj.imports.css.join() === '/resources/css/schedulerpro.classic.css,/resources/css/bryntum-shim.css,/resources/css/mapbox-gl.css'
    && !newFlow.imports.css.some((c) => /schedulerpro|mapbox|bryntum/.test(c)));
  const flow = JSON.parse(read(path.join(NEW, 'flows', 'schedule', 'schedule-flow.json')));
  T.eq('flow id and page id', flow.id + '/' + Object.keys(flow.pages).join() + ' -> ' + flow.pages.schedule.path, 'schedule/schedule -> pages/schedule-page');
  const appFlowSrc = read(path.join(NEW, 'app-flow.js'));
  T.check('the menu item opens it and keeps the old link', /id: 'schedule'[^}]*status: 'new', route: \{ flow: 'schedule', page: 'schedule' \},\s*old: \{ flow: 'main', page: 'equipment-schedule' \}/.test(appFlowSrc));

  T.report();
})().catch((e) => {
  T.check('suite ran', false, e && e.stack);
  T.report();
});
