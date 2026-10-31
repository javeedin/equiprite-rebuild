/*
 * EquipRite Next, everything about a piece of equipment (webApps/equiprite-next/resources/js/equipment360.js and the
 * flows/fleet equipment page): an equipment item with all its units, or one unit. Loads the real modules (and
 * Availability's, whose rules it reuses) and checks:
 *   - the bookings: the equipment-history view joined to each line's request (deployed-units, line-detail-bookings),
 *     a source that failed costing its own rows only;
 *   - each unit now (free, booked, on the way, on site, coming back and late, maintenance), its next booking, its state
 *     in the window, the one-line answer, the timeline (Availability's places, lanes, colours, today);
 *   - the head (name, class, how many units and where; a unit's yard and state);
 *   - the history built from each source (bookings, allocations, status changes, transfer orders with their units,
 *     moves between projects, inspections, Fusion work orders, certificates, documents, the records), merged newest
 *     first, a date only where a record holds one, a failed source named, the unit chips, item vs unit;
 *   - the calls (filtered by equipment id or serial wherever the endpoint allows), and the load chain's with a fake
 *     Actions: what the page shows after each step, the tab renamed, nothing written; every endpoint exists;
 *   - the page: its chains exist, VB-safe bindings, the record kinds (equipment-360 and unit) open it.
 *
 * Run:  node tests/next-equipment360.test.js
 */
'use strict';

process.env.TZ = 'UTC';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const NEXT = path.join(ROOT, 'webApps', 'equiprite-next');
const JS = path.join(NEXT, 'resources', 'js');
const PAGES = path.join(NEXT, 'flows', 'fleet', 'pages');
const CHAINS = path.join(PAGES, 'equipment-page-chains');

function loadAmd(file, deps, globals) {
  const sandbox = Object.assign({ console: { log() {}, warn() {}, error() {}, info() {} }, TextEncoder, URLSearchParams, Intl, Date, setTimeout, Promise, JSON, Math }, globals || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const js = (name, deps) => loadAmd(path.join(JS, name + '.js'), deps);

const rules = js('rules');
const fmt = js('fmt');
const Progress = js('requestProgress');
const av = js('availability', { 'resources/js/requestProgress': Progress, 'resources/js/rules': rules });
const avData = js('availabilityData');
const RH = js('requestHistory', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt });
const nav = js('nav', { 'resources/js/rules': rules });
const tabs = js('tabs', { 'resources/js/nav': nav });
const e3 = js('equipment360', { 'resources/js/availability': av, 'resources/js/availabilityData': avData, 'resources/js/requestProgress': Progress, 'resources/js/requestHistory': RH });

// Wednesday 4 Nov 2026. d(n) is n days from it.
const TODAY = '2026-11-04';
const d = (n) => av.addDays(TODAY, n);
const iso = (n, time) => d(n) + 'T' + (time || '00:00:00') + 'Z';

// ── An item with three units in two yards: bookings past, now and ahead, transfers, an inspection, maintenance ──────
const MASTER = { id: 7001, equipmentName: 'Komatsu D65EX-18 Dozer', equipmentNumber: 'EQ-7001', equipmentClassId: 41, manufacturer: 'Komatsu', modelNumber: 'D65EX-18',
  mfgYear: 2023, equipmentImage: 'resources/images/d65.png', maintenanceAssetNumber: 'MA-D65', currentLocationId: 501, createdDate: '2025-01-05T09:00:00Z', createdBy: 'priya.raman' };
const SERIALS = [
  { id: 81, serialNumber: 'D65-0101', equipmentId: 7001, currentLocationId: 501, maintenanceAssetNumber: 'MA-0101', createdDate: '2025-03-02T09:30:00Z', createdBy: 'priya.raman' },
  { id: 82, serialNumber: 'D65-0102', equipmentId: 7001, currentLocationId: 501 },
  { id: 83, serialNumber: 'D65-0103', equipmentId: 7001, currentLocationId: 502 },
  { id: 84, serialNumber: 'D65-0103', equipmentId: 7001, currentLocationId: 502 }, // a repeated serial-ref: one unit
];
const LOCS = { 501: { id: 501, locationName: 'Houston Yard', locationCode: 'HOU-Y1' }, 502: { id: 502, locationName: 'Dallas Yard', locationCode: 'DAL-Y2' } };
const hist = (lid, serial, from, to, alloc, line, extra) => Object.assign({ requestLineId: lid, equipmentMasterId: 7001, equipmentName: 'Komatsu D65EX-18 Dozer',
  serialNumber: serial, startDate: iso(from), endDate: iso(to), allocationStatus: alloc, lineStatus: line, projectName: null, customerName: null }, extra || {});
const HISTORY = [
  hist(9101, 'D65-0101', -60, -30, 'ALLOCATED', 'RETURNED', { projectName: 'Harbour Wall' }),
  hist(9102, 'D65-0101', -5, 10, 'ALLOCATED', 'DEPLOYED', { projectName: 'Pipeline North' }),
  hist(9102, 'D65-0101', -5, 10, 'ALLOCATED', 'DEPLOYED', { projectName: 'Pipeline North' }), // the view repeats a line
  hist(9103, 'D65-0102', -2, 3, 'ALLOCATED', 'SCHEDULED_FOR_PICKING', { projectName: 'Substation 4' }),
  hist(9104, 'D65-0102', 8, 20, 'PENDING', 'IN_PROCESS', { projectName: 'Plant Expansion B' }),
  hist(9105, 'D65-0103', -20, -1, 'ALLOCATED', 'RETURN_IN_PROCESS', { projectName: 'Gulf Terminal' }),
  hist(9106, 'D65-0103', -12, -8, 'CANCELLED', 'CANCELLED', { projectName: 'Harbour Wall' }),
  hist(9107, null, 15, 30, 'PENDING', 'IN_PROCESS', { customerName: 'Lone Star Paving' }),
];
const dep = (lid, serial, rid, num, line, from, to, extra) => Object.assign({ requestLineId: lid, serialNumber: serial, requestId: rid, requestNumber: num, requestType: 'INTERNAL',
  lineStatus: line, startDate: iso(from), endDate: iso(to), equipmentMasterId: 7001, yardOrgName: 'Houston yard (org)' }, extra || {});
const DEPLOYED = [
  dep(9101, 'D65-0101', 400, 'REQ-10400', 'RETURNED', -60, -30),
  dep(9102, 'D65-0101', 511, 'REQ-10511', 'DEPLOYED', -5, 10),
  dep(9103, 'D65-0102', 530, 'REQ-10530', 'SCHEDULED_FOR_PICKING', -2, 3),
  dep(9104, 'D65-0102', 560, 'REQ-10560', 'IN_PROCESS', 8, 20),
  dep(9105, 'D65-0103', 480, 'REQ-10480', 'RETURN_IN_PROCESS', -20, -1),
  dep(9106, 'D65-0103', 470, 'REQ-10470', 'CANCELLED', -12, -8),
  dep(9107, null, 600, 'REQ-10600', 'IN_PROCESS', 15, 30, { requestType: 'EXTERNAL', customerName: 'Lone Star Paving' }),
];
const LDB = [
  { serialNumber: 'D65-0101', bookingRequestId: 511, bookingRequestNumber: 'REQ-10511', bookingStartDate: iso(-5), bookingEndDate: iso(10), allocStatus: 'ALLOCATED',
    projectName: 'Pipeline North', taskName: 'Earthworks', requestor: 'Pat Lee', location: 'Gate 3' },
  { serialNumber: 'D65-0103', bookingRequestId: 620, bookingRequestNumber: 'REQ-10620', bookingStartDate: iso(30), bookingEndDate: iso(40), allocStatus: 'ALLOCATED',
    projectName: 'Refinery Turnaround', requestor: 'Sam Ortiz' }, // only here: still a booking
];
const WOS = {
  'MA-0101': [{ WorkOrderNumber: 'WO-55821', WorkOrderType: 'Preventive', WorkOrderDescription: '500 h service', PlannedStartDate: iso(12), PlannedCompletionDate: iso(14), WorkOrderStatus: 'Released' }],
  'MA-D65': [{ WorkOrderNumber: 'WO-60000', WorkOrderType: 'Inspection', WorkOrderDescription: 'Fleet campaign', PlannedStartDate: iso(-90), PlannedCompletionDate: iso(-89),
    ActualCompletionDate: iso(-88, '16:00:00'), WorkOrderStatus: 'Completed' }],
};
const STATUS = {
  511: [{ lineId: 9102, toStatus: 'SHIPPED', fromStatus: 'PICK_RELEASED', changedDate: iso(-6, '10:00:00'), changedBy: 'yard.lead' },
    { lineId: 9999, toStatus: 'DELIVERED', changedDate: iso(-5, '09:00:00'), changedBy: 'someone' }, // another line of the request: not this unit
    { toStatus: 'IN_PROCESS', fromStatus: 'SUBMITTED', changedDate: iso(-12, '08:00:00'), changedBy: 'em.boss', comments: 'OK for North' }],
};
const ORDERS = {
  511: [{ id: 3001, equipmentRequestId: 511, orderNumber: 'TO-3001', orderType: 'OUTBOUND', createdDate: iso(-7, '08:00:00'), shippedDate: iso(-6, '11:00:00'), receivedDate: iso(-5, '15:30:00'), carrierName: 'Gulf Haul' },
    { id: 3002, equipmentRequestId: 511, orderNumber: 'TO-3002', orderType: 'OUTBOUND', createdDate: iso(-7, '08:05:00') }],
  480: [{ id: 3003, equipmentRequestId: 480, orderNumber: 'TO-3003', orderType: 'INBOUND', createdDate: iso(-2, '07:00:00'), shippedDate: iso(-1, '13:00:00') }],
};
const ORDER_LINES = { 3001: [{ transferOrderId: 3001, serialNumber: 'D65-0101', requestLineId: 9102 }], 3002: [{ transferOrderId: 3002, serialNumber: 'X-9', requestLineId: 9998 }],
  3003: [{ transferOrderId: 3003, serialRefId: 83, requestLineId: 9105 }] };
const MOVE = { id: 41, serialNumber: 'D65-0101', transferDate: iso(-31, '12:00:00'), sourceRequestNumber: 'REQ-10400', sourceProjectName: 'Harbour Wall',
  destinationRequestNumber: 'REQ-10511', destinationProjectName: 'Pipeline North', transferOrderId: 3005, orderNumber: 'TO-3005', transferStatus: 'COMPLETED', transferredBy: 'dispatch.desk' };
const MOVES = { 400: [MOVE, { id: 42, serialNumber: 'OTHER-1', transferDate: iso(-31) }], 511: [MOVE] };
const ALLOCS = { 9102: [{ id: 1, requestLineId: 9102, serialRefId: 81, allocationStatus: 'ALLOCATED', allocatedDate: iso(-20, '14:00:00') }],
  9101: [{ id: 2, requestLineId: 9101, serialRefId: 81, allocationStatus: 'ALLOCATED', allocatedDate: iso(-70, '09:00:00'), releasedDate: iso(-29, '17:00:00') }] };
const INSPECTIONS = { 9102: [{ id: 11, requestLineId: 9102, inspectionType: 'PRE_DISPATCH', inspectionStatus: 'COMPLETED', completedDate: iso(-7, '15:00:00'), overallResult: 'PASS', notes: 'Tracks fine' }],
  9105: [{ id: 12, requestLineId: 9105, inspectionType: 'RETURN', inspectionStatus: 'SCHEDULED', scheduledDate: iso(1, '09:00:00') }] };
const CERTS = [{ id: 1, equipmentMasterId: 7001, certType: 'ROPS', certNumber: 'C-77', issuedBy: 'TUV', issuedDate: '2025-01-10', expiryDate: '2027-01-10' }];
const DOCS = { 'EQR_EQUIPMENT_MASTER:7001': [{ id: 5, attachmentName: 'Operator manual', categoryLabel: 'Manuals', createdDate: '2025-02-01T10:00:00Z', createdBy: 'priya.raman' }],
  'EQR_SERIAL_REF:81': [{ id: 6, attachmentName: 'Track survey', categoryLabel: 'Reports', createdDate: iso(-40, '11:00:00'), createdBy: 'SYSTEM' }] };

/** The stand-in backend: what each endpoint answers for these units (down[endpoint] answers 500). */
let down = {};
function backend(o) {
  const e = o.endpoint.replace(/^[^/]+\//, '');
  const q = o.uriParams || {};
  const ok = (body) => ({ ok: true, status: 200, body });
  if (down[e] === 'throw') return Promise.reject(new Error('no answer'));
  if (down[e]) return { ok: false, status: 500, body: { message: 'down' } };
  switch (e) {
    case 'getEquipriteV1EquipmentMasterById': return Number(q.id) === 7001 ? ok(MASTER) : { ok: false, status: 404 };
    case 'getEquipriteV1EquipmentMaster': return ok({ data: /komatsu/i.test(q.q || '') ? [{ id: 7002, equipmentName: 'Komatsu D65EX-18 Dozer (old)' }, { id: 7001, equipmentName: 'Komatsu D65EX-18 Dozer' }] : [], hasMore: false });
    case 'getSerialRefs': return ok({ data: Number(q.equipmentId) === 7001 ? SERIALS : (q.equipmentId ? [] : SERIALS.concat([{ id: 90, serialNumber: 'ZZ-1', equipmentId: 7001 }])), hasMore: false });
    case 'getEquipmentClassById': return Number(q.id) === 41 ? ok({ id: 41, className: 'Dozers' }) : { ok: false, status: 404 };
    case 'getLocationById': return LOCS[q.id] ? ok(LOCS[q.id]) : { ok: false, status: 404 };
    case 'getEquipriteV1ViewsEquipmentHistory2': return ok({ data: q.serialNumber ? HISTORY.filter((x) => x.serialNumber === q.serialNumber) : HISTORY, hasMore: false });
    case 'searchDeployedUnits': return ok({ data: q.serialNumber ? DEPLOYED.filter((x) => x.serialNumber === q.serialNumber) : DEPLOYED, hasMore: false });
    case 'getEquipriteV1ViewsLineDetailBookings': return ok({ data: LDB, hasMore: false });
    case 'getRequestStatusHistory': return ok({ data: STATUS[q.requestId] || [] });
    case 'getTransferOrders': return ok({ data: ORDERS[q.equipmentRequestId] || [] });
    case 'getTransferOrderLines': return ok({ data: ORDER_LINES[q.transferOrderId] || [] });
    case 'getTransferHistory': return ok({ data: MOVES[q.equipmentRequestId] || [] });
    case 'getAllocations': return ok({ data: ALLOCS[q.requestLineId] || [] });
    case 'getInspections': return Number(q.requestLineId) === 9103 ? { ok: false, status: 503 } : ok({ data: INSPECTIONS[q.requestLineId] || [] });
    case 'getEquipmentCertifications': return ok({ data: CERTS });
    case 'listEquipmentAttachments': return ok({ data: DOCS[q.entityName + ':' + q.entityId] || [] });
    case 'getInstalledBaseAssets': return ok({ items: /MA-0101|MA-D65/.test(q.q) ? [{ AssetId: /0101/.test(q.q) ? 300101 : 300165, OperatingOrganizationCode: 'HOU' }] : [] });
    case 'getMaintenanceWorkOrders': { const a = (/AssetNumber='([^']+)'/.exec(q.q) || [])[1]; return ok({ items: (a && WOS[a]) || [] }); }
    default: return { ok: false, status: 404 };
  }
}
const short = (o) => o.endpoint.replace(/^[^/]+\//, '') + ' ' + JSON.stringify(o.uriParams);
function recorder() {
  const log = [];
  return { log, call: (o) => { log.push(short(o)); return Promise.resolve(backend(o)); } };
}

const CORE = {
  mode: 'item', serial: '', name: 'Komatsu D65EX-18 Dozer', equipmentId: '7001', master: MASTER, className: 'Dozers', serials: SERIALS.slice(0, 3), unitsAll: 3,
  lines: e3.bookings({ history: HISTORY, deployed: DEPLOYED, ldb: LDB }), locationsById: { 501: LOCS[501], 502: LOCS[502] }, yards: {}, notes: [], failed: []
};
const model = e3.modelOf(CORE, WOS, TODAY);
const v = e3.view(model, { from: TODAY, to: d(27), mode: 'item', yards: {} });
const row = (s) => v.units.find((u) => u.serial === s);
const bars = (s) => v.rows.find((r) => r.serial === s).bars;

// ═══ the bookings ════════════════════════════════════════════════════════════════════════════════════════════════
T.section('the bookings: every request line it was on, with its request');
const line = (lid) => CORE.lines.find((l) => l.eqrRequestLineId === lid);
T.eq('each history line once, then a booking only line-detail-bookings has', CORE.lines.map((l) => (l.eqrRequestLineId || '-') + ':' + (l.allocatedSerial || '-') + ':' + l.source).join(' '),
  '9101:D65-0101:history 9102:D65-0101:history 9103:D65-0102:history 9104:D65-0102:history 9105:D65-0103:history 9106:D65-0103:history 9107:-:history -:D65-0103:bookings');
T.eq('the request of each line, from deployed-units', [line(9102).requestNumber, line(9102).eqrEquipmentRequestId, line(9107).requestNumber, line(9107).requestOrigin].join(' '),
  'REQ-10511 511 REQ-10600 EXTERNAL');
T.eq('who asked for it and where, from line-detail-bookings', [line(9102).requestorName, line(9102).taskName, line(9102).deploymentLocation].join(' | '), 'Pat Lee | Earthworks | Gate 3');
T.eq('dates as days, the statuses kept', [line(9102).requestedStartDate, line(9102).requestedEndDate, line(9104).allocStatus, line(9104).lineStatus].join(' '), [d(-5), d(10), 'PENDING', 'IN_PROCESS'].join(' '));
{
  const noHist = e3.bookings({ history: [], deployed: DEPLOYED, ldb: LDB });
  T.eq('the history view failing: the lines from deployed-units, and line-detail-bookings\' own', noHist.map((l) => (l.requestNumber || '?') + ':' + l.source).join(' '),
    'REQ-10400:deployed REQ-10511:deployed REQ-10530:deployed REQ-10560:deployed REQ-10480:deployed REQ-10470:deployed REQ-10600:deployed REQ-10620:bookings');
  const noIds = e3.bookings({ history: HISTORY.slice(0, 2), deployed: [], ldb: [] });
  T.eq('no request known: none is invented', noIds.map((l) => l.requestNumber + '|' + l.eqrEquipmentRequestId).join(' '), '|null |null');
  T.eq('a unit: its own lines only (line-detail-bookings reads the whole item)', e3.bookings({ history: HISTORY, deployed: DEPLOYED, ldb: LDB, serial: 'd65-0103' })
    .map((l) => l.requestNumber).join(), 'REQ-10480,REQ-10470,REQ-10620');
}

// ═══ the units ═══════════════════════════════════════════════════════════════════════════════════════════════════
T.section('each unit: yard, now, next, free or not in the window');
T.eq('one row per unit (a repeated serial-ref once), by serial', v.units.map((u) => u.serial).join(), 'D65-0101,D65-0102,D65-0103');
T.eq('yard from the unit\'s location', v.units.map((u) => u.yard).join(' | '), 'HOU-Y1 · Houston Yard | HOU-Y1 · Houston Yard | DAL-Y2 · Dallas Yard');
T.eq('now: on site, which request, until when', [row('D65-0101').now.key, row('D65-0101').now.label, row('D65-0101').now.text, row('D65-0101').now.requestId].join(' | '),
  'onsite | On site | REQ-10511 · Pipeline North · until 14 Nov | 511');
T.eq('now: booked (getting ready), which request', [row('D65-0102').now.label, row('D65-0102').now.text].join(' | '), 'Booked | REQ-10530 · Substation 4 · Waiting to be picked');
T.eq('now: coming back, and late', [row('D65-0103').now.label, row('D65-0103').now.text, row('D65-0103').now.late].join(' | '),
  'Coming back | REQ-10480 · Gulf Terminal · due back 3 Nov (1 day late) | 1');
T.check('now: the journey colours', row('D65-0101').now.cls === 'nx-pill nx-stage--onsite' && row('D65-0103').now.cls === 'nx-pill nx-stage--back', row('D65-0101').now.cls);
T.eq('now: in maintenance', JSON.stringify((({ key, label, text }) => ({ key, label, text }))(e3.nowOf([{ kind: 'maintenance', holds: true, start: d(-1), end: d(2), wo: 'WO-1' }], TODAY, 'HOU-Y1'))),
  '{"key":"maint","label":"In maintenance","text":"WO-1 · until 6 Nov"}');
T.eq('now: on the way to site', e3.nowOf([{ kind: 'booking', holds: true, start: d(-1), end: d(9), stage: 'out', stageLabel: 'On the way to site', requestNumber: 'REQ-1' }], TODAY, '').label,
  'On the way to site');
T.eq('now: free, in its yard; a cancelled booking holds nothing', [e3.nowOf([], TODAY, 'HOU-Y1 · Houston Yard').text,
  e3.nowOf([{ kind: 'booking', holds: false, start: d(-1), end: d(9), stage: 'stopped', requestNumber: 'REQ-2' }], TODAY, '').text].join(' | '), 'At HOU-Y1 · Houston Yard | In the yard');
T.eq('next booking: the next that holds it', [row('D65-0101').next, row('D65-0102').next.text, row('D65-0103').next.text].join(' | '),
  ' | REQ-10560 · 12 – 24 Nov 2026 · Plant Expansion B | REQ-10620 · 4 – 14 Dec 2026 · Refinery Turnaround');
T.eq('in the window: Availability\'s windowState', v.units.map((u) => u.win.state + ':' + u.win.why).join(' | '),
  'booked:REQ-10511 · Pipeline North · 30 Oct – 14 Nov 2026 | booked:REQ-10530 · Substation 4 · 2 – 7 Nov 2026 (+1 more) | tight:Back from REQ-10480 on 3 Nov');
T.eq('the yard as the views name it, when no location is held', e3.unitRow(model, Object.assign({}, model.units[0], { yardKey: '', yard: av.NO_YARD }),
  av.windowOf(TODAY, d(27), TODAY), TODAY, { 'D65-0101': 'Houston yard (org)' }).yard, 'Houston yard (org)');

T.section('the one-line answer');
T.eq('an item', v.answer, '1 of 3 free from 4 Nov to 1 Dec (1 with a tight turnaround)');
T.eq('the window follows', e3.view(model, { from: d(21), to: d(27), mode: 'item' }).answer, '3 of 3 free from 25 Nov to 1 Dec (1 with a tight turnaround)');
const unitWin = (s, from, to) => e3.answer([e3.unitRow(model, model.units.find((u) => u.serial === s), av.windowOf(from, to, TODAY), TODAY, {})], av.windowOf(from, to, TODAY), 'unit', TODAY).text;
T.eq('a unit, not free: why', unitWin('D65-0101', TODAY, d(27)), 'Not free from 4 Nov to 1 Dec: REQ-10511 · Pipeline North · 30 Oct – 14 Nov 2026');
T.eq('a unit, in maintenance', unitWin('D65-0101', d(12), d(13)), 'Not free from 16 Nov to 17 Nov: Maintenance WO-55821 · 16 – 18 Nov 2026');
T.eq('a unit, free', unitWin('D65-0101', d(21), d(27)), 'Free from 25 Nov to 1 Dec');
T.eq('across a year, the years are said', e3.spanText('2026-12-20', '2027-01-10', TODAY), 'from 20 Dec 2026 to 10 Jan 2027');
T.eq('no units', e3.answer([], av.windowOf(TODAY, d(6), TODAY), 'item', TODAY).text, 'No units of this equipment are recorded in EquipRite, so none can be booked from 4 Nov to 10 Nov');

T.section('availability ahead: the timeline (Availability\'s rules and colours)');
T.eq('the window\'s weeks, Monday to Sunday, day by day', [v.range.label, v.range.days, v.zoom, v.head.ticks.length, v.head.ticks[0].wd + v.head.ticks[0].label].join(' | '), '2 Nov – 6 Dec 2026 | 35 | week | 35 | M2');
T.eq('today marked, the window as a band', [v.head.today, v.head.band.l, v.head.band.w, v.head.ticks.filter((t) => t.today).map((t) => t.key).join()].join(' '), '7.143% 5.714% 80% ' + TODAY);
T.eq('bars placed by Availability\'s place, clipped at the edges', bars('D65-0101').map((b) => b.label + ' ' + b.l + '/' + b.w + (b.cls.includes('--cutl') ? ' <' : '')).join(' ; '),
  'REQ-10511 · Pipeline North 0%/37.143% < ; Maintenance · WO-55821 40%/8.571%');
T.check('coloured by journey stage; light when only held; maintenance hatched', bars('D65-0101')[0].cls.includes('nx-stage--onsite') && bars('D65-0101')[0].cls.includes('nx-av-bar--hard')
  && bars('D65-0102')[1].cls.includes('nx-av-bar--soft') && bars('D65-0101')[1].cls.includes('nx-av-bar--maint'), bars('D65-0102').map((b) => b.cls).join(' ; '));
T.eq('a cancelled booking is not drawn', bars('D65-0103').map((b) => b.label).join(' ; '), 'REQ-10480 · Gulf Terminal ; REQ-10620 · Refinery Turnaround');
T.eq('a booking bar opens its request; maintenance does not', bars('D65-0101').map((b) => b.kind + ':' + b.open + ':' + b.requestId).join(), 'booking:true:511,maintenance:false:');
T.check('a bar says what it is and the stored status (availability.barTitle)', bars('D65-0101')[0].title.includes('REQ-10511 · Pipeline North') && bars('D65-0101')[0].title.includes('Stored: allocation ALLOCATED, line DEPLOYED'),
  bars('D65-0101')[0].title);
{
  const two = e3.modelOf(Object.assign({}, CORE, { serials: [SERIALS[0]], lines: [
    { eqrRequestLineId: 1, allocatedSerial: 'D65-0101', requestNumber: 'REQ-1', allocStatus: 'ALLOCATED', requestedStartDate: d(1), requestedEndDate: d(9) },
    { eqrRequestLineId: 2, allocatedSerial: 'D65-0101', requestNumber: 'REQ-2', allocStatus: 'ALLOCATED', requestedStartDate: d(5), requestedEndDate: d(12) }] }), {}, TODAY);
  const r2 = e3.view(two, { from: TODAY, to: d(27), mode: 'unit' }).rows[0];
  T.eq('a double booking: the bars stack, the row grows, the clash is marked', [r2.bars.map((b) => b.t).join(), r2.h, r2.marks.map((m) => m.cls).join(), r2.bars.every((b) => b.cls.includes('--clash'))].join(' | '),
    '5px,29px | 56px | nx-av-mark nx-av-mark--clash | true');
}
T.eq('a window over six weeks: week by week', e3.rangeOf(av.windowOf(TODAY, d(90), TODAY)).zoom, 'month');
T.eq('the legend is Availability\'s', e3.legend().map((k) => k.key).join(), av.legend().map((k) => k.key).join());

// ═══ the head ════════════════════════════════════════════════════════════════════════════════════════════════════
T.section('the head');
const head = e3.headOf(CORE, model, v.units);
T.eq('an item: its name, class, how many units and where, what they are doing', [head.kicker, head.title, head.sub, head.where].join(' | '),
  'Equipment · Dozers | Komatsu D65EX-18 Dozer | 3 units: 2 at HOU-Y1 · Houston Yard, 1 at DAL-Y2 · Dallas Yard | Now: 1 booked · 1 on site · 1 coming back');
T.eq('its facts and picture; the tab\'s name', [head.facts.join(','), head.image, head.tabTitle].join(' | '), 'EQ-7001,Komatsu,D65EX-18,2023 | resources/images/d65.png | Komatsu D65EX-18 Dozer');
{
  const uc = Object.assign({}, CORE, { mode: 'unit', serial: 'D65-0103', serials: [SERIALS[2]], unitsAll: 3, lines: e3.bookings({ history: HISTORY, deployed: DEPLOYED, ldb: LDB, serial: 'D65-0103' }) });
  const um = e3.modelOf(uc, {}, TODAY);
  const uh = e3.headOf(uc, um, e3.view(um, { from: TODAY, to: d(27), mode: 'unit' }).units);
  T.eq('a unit: its serial and name, its yard and what it is doing', [uh.kicker, uh.title, uh.sub, uh.where, uh.now.label].join(' | '),
    'Unit · Dozers | D65-0103 | Komatsu D65EX-18 Dozer · Dozers | Kept at DAL-Y2 · Dallas Yard | Coming back');
  T.eq('a unit: the way to all units of its equipment; the tab\'s name', [uh.allText, uh.equipmentId, uh.tabTitle].join(' | '), 'All 3 units of this equipment | 7001 | D65-0103 · Komatsu D65EX-18 Dozer');
}

// ═══ the history, source by source ═══════════════════════════════════════════════════════════════════════════════
T.section('the history, from each source');
const info = { lineId: 9102, serial: 'D65-0101', requestId: 511, number: 'REQ-10511', party: 'Pipeline North' };
const serialById = { 81: 'D65-0101', 83: 'D65-0103' };
const b = e3.fromBookings(CORE.lines, 'item');
const bOf = (n) => b.find((x) => x.ref === n);
T.eq('a booking: the request, project, dates, where it is (requestProgress)', [bOf('REQ-10511').title, bOf('REQ-10511').text, bOf('REQ-10511').meta].join(' | '),
  'Booked on REQ-10511 · Pipeline North | 30 Oct – 14 Nov 2026 · On site | 30 Oct 2026 · Pat Lee · from its dates');
T.eq('a booking back at the yard, held, cancelled, asked for with no unit', ['REQ-10400', 'REQ-10560', 'REQ-10470', 'REQ-10600'].map((n) => bOf(n).title + ' — ' + bOf(n).text).join(' | '),
  'Booked on REQ-10400 · Harbour Wall — 5 Sep – 5 Oct 2026 · Back at the yard | Booked on REQ-10560 · Plant Expansion B — 12 – 24 Nov 2026 · Unit held, not confirmed yet'
  + ' | Booking cancelled: REQ-10470 · Harbour Wall — 23 – 27 Oct 2026 · Cancelled | Asked for on REQ-10600 · Lone Star Paving — 19 Nov – 4 Dec 2026 · With the Equipment Manager · no unit assigned yet');
T.eq('a booking opens its request', [bOf('REQ-10511').open, bOf('REQ-10511').rec, bOf('REQ-10511').recId, bOf('REQ-10511').recNumber].join(), 'true,request,511,REQ-10511');
const noDate = e3.fromBookings([{ eqrRequestLineId: 1, allocatedSerial: 'X', requestNumber: 'REQ-9', allocStatus: 'ALLOCATED' }], 'item')[0];
T.eq('a booking without dates: never given one', [noDate.when, noDate.text, noDate.meta].join(' | '), ' | no dates recorded · Unit assigned | Date not recorded · from its dates');
const al = e3.fromAllocations(ALLOCS[9101], Object.assign({}, info, { lineId: 9101, number: 'REQ-10400', requestId: 400, party: 'Harbour Wall' }), serialById);
T.eq('allocations: assigned, and released', al.map((x) => x.when + ' ' + x.title + ' [' + x.unitText + ']').join(' | '),
  '26 Aug 2026, 09:00 Unit assigned to REQ-10400 · Harbour Wall [D65-0101] | 6 Oct 2026, 17:00 Unit released from REQ-10400 [D65-0101]');
const idx = { lines: { 9102: info }, requests: {}, serialSet: { 'D65-0101': 'D65-0101', 'D65-0103': 'D65-0103' }, serialById };
const st = e3.fromStatusRows(STATUS[511], { requestId: 511, number: 'REQ-10511', units: ['D65-0101'], external: false }, idx);
T.eq('status changes: its own line\'s and the request\'s (another line\'s left out), who and when', st.map((x) => x.when + ' ' + x.title + ' (' + x.text + ') ' + x.who).join(' | '),
  '29 Oct 2026, 10:00 Shipped to site · REQ-10511 (was: being picked at the yard) yard.lead | 23 Oct 2026, 08:00 Approved · REQ-10511 (the request · was: waiting for approval · “OK for North”) em.boss');
const req511 = { requestId: 511, number: 'REQ-10511', units: ['D65-0101'] };
const to = e3.fromOrders(ORDERS[511], ORDER_LINES, req511, idx);
T.eq('transfer orders carrying the unit: raised, shipped, received (the other unit\'s order left out)', to.map((x) => x.title + ' [' + x.unitText + ']').join(' | '),
  'Transfer order TO-3001 raised for picking [D65-0101] | Shipped to site [D65-0101] | Received on site [D65-0101]');
T.eq('a transfer order opens its transfer', [to[1].rec, to[1].recId, to[1].recNumber, to[1].text].join(' | '), 'transfer | 3001 | TO-3001 | TO-3001 · Gulf Haul · for REQ-10511');
const unread = e3.fromOrders(ORDERS[511].slice(1), {}, req511, idx);
T.eq('an order whose units could not be read: kept, and says so', unread.map((x) => x.text).join(), 'for REQ-10511 · its units could not be read: it may carry other equipment of the request');
T.eq('an inter-project order: read from its moves', e3.fromOrders([{ id: 9, orderType: 'INTER_PROJECT', createdDate: iso(-1) }], {}, req511, idx).length, 0);
const seen = {};
const mv = e3.fromMoves(MOVES[400], idx, seen).concat(e3.fromMoves(MOVES[511], idx, seen));
T.eq('moves between projects: the unit\'s, once, with who', mv.map((x) => [x.when, x.title, x.text, x.who, x.rec + ':' + x.recId].join(' | ')).join(' ; '),
  '4 Oct 2026, 12:00 | Moved to REQ-10511 Pipeline North | from REQ-10400 Harbour Wall · TO-3005 | dispatch.desk | transfer:3005');
const ins = e3.fromInspections(INSPECTIONS[9102].concat(INSPECTIONS[9105], [{ id: 13, completedDate: iso(-3), overallResult: 'FAIL', inspectionType: 'RETURN', notes: 'Hydraulic leak' }, { id: 14 }]), info);
T.eq('inspections: the result, a scheduled one, a failure, one with no date', ins.map((x) => x.title + ' (' + x.stage + ') ' + x.meta).join(' | '),
  'Inspection passed · pre dispatch (onsite) 28 Oct 2026, 15:00 | Inspection scheduled · return (draft) for 5 Nov 2026, 09:00 | Inspection failed · return (stopped) 1 Nov 2026 | Inspection started (draft) Date not recorded');
const wo = e3.fromWorkOrders(WOS, { 'MA-0101': ['D65-0101'] });
T.eq('Fusion work orders: planned on a unit\'s asset, the item\'s own, completed', wo.map((x) => x.title + ' [' + x.unitText + '] ' + x.meta).join(' | '),
  'Maintenance work order WO-55821 [D65-0101] 16 Nov 2026 · planned in Fusion | Maintenance work order WO-60000 [] 6 Aug 2026 · planned in Fusion | Maintenance work order WO-60000 completed [] 8 Aug 2026, 16:00');
T.eq('certificates: issued, expires', e3.fromCerts(CERTS, TODAY).map((x) => x.title + ' — ' + x.text).join(' | '), 'Certificate issued: ROPS C-77 — by TUV · valid to 10 Jan 2027 | Certificate expires: ROPS C-77 — ');
T.eq('documents: the uploader, never SYSTEM', e3.fromDocs(DOCS['EQR_SERIAL_REF:81'], 'D65-0101').concat(e3.fromDocs(DOCS['EQR_EQUIPMENT_MASTER:7001'], '')).map((x) => x.title + ' [' + x.unitText + '] ' + x.who).join(' | '),
  'Document added: Track survey [D65-0101]  | Document added: Operator manual [] priya.raman');

(async () => {
  // ═══ the calls, and the history merged ═══════════════════════════════════════════════════════════════════════════
  T.section('the calls: filtered by the equipment or the serial wherever the endpoint allows');
  let rec = recorder();
  const core = await e3.loadCore(rec.call, { name: 'Komatsu D65EX-18 Dozer', equipmentId: '7001' });
  T.eq('the item, its units, its bookings together; then its class and each yard once', rec.log.join(' ; '),
    'getEquipriteV1EquipmentMasterById {"id":7001} ; getSerialRefs {"equipmentId":7001,"size":10000} ; getEquipriteV1ViewsEquipmentHistory2 {"equipmentMasterId":7001,"page":0,"size":1000} ; '
    + 'searchDeployedUnits {"equipmentMasterId":7001,"lineStatus":"' + e3.LINE_STATUSES + '","page":0,"size":1000} ; getEquipriteV1ViewsLineDetailBookings {"equipmentMasterId":7001,"page":0,"size":10000} ; '
    + 'getEquipmentClassById {"id":41} ; getLocationById {"id":501} ; getLocationById {"id":502}');
  T.check('deployed-units asked for every line status, not only the returnable ones', ['ALLOCATED', 'SHIP_TO_SITE', 'DEPLOYED', 'RETURNED', 'CANCELLED'].every((s) => e3.LINE_STATUSES.split(',').includes(s)));
  T.eq('what came back', [core.mode, core.master.equipmentName, core.className, core.serials.length, core.lines.length, Object.keys(core.locationsById).join(), core.failed.length, core.error].join(' | '),
    'item | Komatsu D65EX-18 Dozer | Dozers | 3 | 8 | 501,502 | 0 | ');
  const moreLog = recorder();
  const more = await e3.loadMore(moreLog.call, core);
  const per = (ep) => moreLog.log.filter((c) => c.startsWith(ep + ' ')).map((c) => JSON.parse(c.slice(ep.length + 1)));
  T.eq('per request (newest first): status changes, transfer orders, moves', per('getRequestStatusHistory').map((p) => p.requestId).join(), '620,600,560,530,511,470,480,400');
  T.check('the same requests for transfer orders and moves', per('getTransferOrders').map((p) => p.equipmentRequestId).join() === per('getTransferHistory').map((p) => p.equipmentRequestId).join()
    && per('getTransferOrders').length === 8);
  T.eq('per booking line: allocations and inspections', per('getAllocations').map((p) => p.requestLineId).join() + ' / ' + per('getInspections').map((p) => p.requestLineId).join(),
    '9104,9103,9102,9106,9105,9101 / 9104,9103,9102,9106,9105,9101');
  T.eq('the units on each transfer order (out and back)', per('getTransferOrderLines').map((p) => p.transferOrderId).sort().join(), '3001,3002,3003');
  T.eq('certificates and documents: the item\'s and each unit\'s', per('getEquipmentCertifications').map((p) => p.equipmentId).join() + ' / '
    + per('listEquipmentAttachments').map((p) => p.entityName.replace('EQR_', '') + ':' + p.entityId).join(), '7001 / EQUIPMENT_MASTER:7001,SERIAL_REF:81,SERIAL_REF:82,SERIAL_REF:83');
  T.eq('Fusion: the units\' maintenance assets and the item\'s, as Availability reads them', per('getInstalledBaseAssets').map((p) => p.q).join(), "AssetNumber='MA-0101',AssetNumber='MA-D65'");
  T.check('nothing unfiltered: every list read names the equipment, the serial, the request, the line or the order', moreLog.log.concat(rec.log).every((c) => /"(id|equipmentId|equipmentMasterId|serialNumber|requestId|equipmentRequestId|requestLineId|transferOrderId|entityId|q)":/.test(c)),
    moreLog.log.concat(rec.log).filter((c) => !/"(id|equipmentId|equipmentMasterId|serialNumber|requestId|equipmentRequestId|requestLineId|transferOrderId|entityId|q)":/.test(c)).join(' ; '));
  {
    let inFlight = 0;
    let most = 0;
    const slow = (o) => {
      if (/^ProjectLOV/.test(o.endpoint)) return Promise.resolve(backend(o));
      inFlight += 1;
      most = Math.max(most, inFlight);
      return new Promise((r) => setTimeout(() => { inFlight -= 1; r(backend(o)); }, 2));
    };
    await e3.loadMore(slow, core);
    T.check('at most eight EquipRite reads at once', most > 1 && most <= 8, String(most));
  }

  T.section('the history: every source merged, newest first');
  const h = e3.historyOf(core, more, TODAY);
  T.eq('how many, from what', [h.count, h.note].join(' | '),
    '30 | 30 entries, newest first, from bookings, units assigned and released, status changes, transfer orders, moves between projects, inspections, Fusion maintenance work orders, certificates, documents. '
    + 'A booking is dated from its start; a date that was not recorded is not shown.');
  T.check('newest first (an entry with no date last)', h.events.every((e, i) => i === 0 || e.ms == null || h.events[i - 1].ms >= e.ms));
  T.eq('the first entries: what lies ahead says so', h.events.slice(0, 4).map((e) => e.title + ' · ' + e.meta).join(' | '),
    'Certificate expires: ROPS C-77 · 10 Jan 2027 · ahead | Booked on REQ-10620 · Refinery Turnaround · 4 Dec 2026 · Sam Ortiz · from its dates · ahead'
    + ' | Asked for on REQ-10600 · Lone Star Paving · 19 Nov 2026 · from its dates · ahead | Maintenance work order WO-55821 · 16 Nov 2026 · planned in Fusion · ahead');
  const at = (t) => h.events.findIndex((e) => e.title.startsWith(t));
  T.check('in order: received on site, then shipped, then the inspection before it, then picking raised',
    at('Received on site') < at('Shipped to site') && at('Shipped to site') < at('Inspection passed') && at('Inspection passed') < at('Transfer order TO-3001 raised'),
    h.events.map((e) => e.title).join(' / '));
  T.eq('each kind is there', [...new Set(h.events.map((e) => e.kind))].sort().join(), 'allocation,booking,cert,doc,inspection,maint,move,received,record,shipped,status,transfer');
  T.eq('a failed read is named, and its part left out', h.failed, 'Not read, so left out: the inspections of 1 booking.');
  T.eq('a chip per unit, with its entries', h.chips.map((c) => c.key + ':' + c.count).join(' '), 'all:30 D65-0101:15 D65-0102:2 D65-0103:6');
  T.eq('a unit\'s chip shows its entries only', e3.shown(h.events, 'D65-0102').map((e) => e.title).join(' | '),
    'Booked on REQ-10560 · Plant Expansion B | Booked on REQ-10530 · Substation 4');
  T.eq('All units: every entry', e3.shown(h.events, 'all').length, 30);
  T.eq('while the rest is read: the bookings already', e3.historyOf(core, {}, TODAY).events.filter((e) => e.kind !== 'record').map((e) => e.kind).join(), 'booking,booking,booking,booking,booking,booking,booking,booking');

  T.section('a source that fails');
  // Fusion: an asset it does not know has no work orders (Availability's rule); a call with no answer is a failure.
  down = { getTransferOrders: true, getRequestStatusHistory: true, getMaintenanceWorkOrders: 'throw' };
  const m2 = await e3.loadMore(recorder().call, core);
  const h2 = e3.historyOf(core, m2, TODAY);
  T.check('named in words, the rest still there', /the status changes of REQ-10620, REQ-10600, .*REQ-10400; the transfer orders of REQ-10620/.test(h2.failed) && h2.failed.includes('Fusion maintenance work orders (2 of 2 maintenance assets)')
    && h2.events.some((e) => e.kind === 'move') && !h2.events.some((e) => e.kind === 'transfer' || e.kind === 'status'), h2.failed);
  T.check('no dates made up for what failed', h2.events.every((e) => !e.when || e.ms != null));
  down = { getEquipriteV1ViewsEquipmentHistory2: true };
  const c3 = await e3.loadCore(recorder().call, { equipmentId: '7001' });
  T.eq('the history view down: bookings from the other two, and said', [c3.lines.length, c3.failed.join()].join(' | '), '8 | the bookings (equipment history, HTTP 500)');
  down = { getEquipriteV1ViewsEquipmentHistory2: true, searchDeployedUnits: true, getEquipriteV1ViewsLineDetailBookings: true };
  const c4 = await e3.loadCore(recorder().call, { equipmentId: '7001' });
  T.eq('every booking read down: units shown, and not to be read as free', [c4.lines.length, c4.serials.length, c4.notes.join()].join(' | '),
    '0 | 3 | Bookings could not be loaded: units are shown without them, so do not read them as free.');
  down = { getEquipriteV1EquipmentMasterById: true };
  const c5 = await e3.loadCore(recorder().call, { equipmentId: '7001' });
  T.eq('the master down: the units and bookings still, and said', [c5.serials.length, c5.lines.length, c5.failed.join(), c5.error].join(' | '), '3 | 8 | the equipment master record (HTTP 500) | ');
  down = {};

  T.section('opened by name, by serial, or not found');
  rec = recorder();
  const byName = await e3.loadCore(rec.call, { name: 'Komatsu D65EX-18 Dozer' });
  T.eq('a name only: the master searched, the exact name picked', [rec.log[0], byName.equipmentId].join(' | '), 'getEquipriteV1EquipmentMaster {"q":"Komatsu D65EX-18 Dozer","page":0,"size":50} | 7001');
  rec = recorder();
  const unit = await e3.loadCore(rec.call, { serial: 'D65-0103' });
  T.eq('a unit: its own history and lines by serial, then its equipment', rec.log.slice(0, 5).join(' ; '),
    'getEquipriteV1ViewsEquipmentHistory2 {"serialNumber":"D65-0103","page":0,"size":500} ; searchDeployedUnits {"serialNumber":"D65-0103","lineStatus":"' + e3.LINE_STATUSES + '","page":0,"size":500} ; '
    + 'getEquipriteV1EquipmentMasterById {"id":7001} ; getSerialRefs {"equipmentId":7001,"size":10000} ; getEquipriteV1ViewsLineDetailBookings {"equipmentMasterId":7001,"page":0,"size":10000}');
  T.eq('a unit: itself, its bookings, its yard; how many units its equipment has', [unit.mode, unit.serials.map((s) => s.serialNumber).join(), unit.lines.map((l) => l.requestNumber).join(), Object.keys(unit.locationsById).join(), unit.unitsAll].join(' | '),
    'unit | D65-0103 | REQ-10480,REQ-10470,REQ-10620 | 502 | 3');
  const uMore = await e3.loadMore(recorder().call, unit);
  const uh = e3.historyOf(unit, uMore, TODAY);
  T.check('a unit\'s history: its own entries and the item\'s (certificates), none of another unit\'s', uh.events.every((e) => !e.units.length || e.units.join() === 'D65-0103')
    && uh.events.some((e) => e.kind === 'cert') && !uh.chips.length && uh.events.some((e) => e.title === 'Shipped back to the yard'), uh.events.map((e) => e.title + '[' + e.unitText + ']').join(' / '));
  T.check('a unit: no item documents read, its own only', !uMore.docs.some((x) => !x.serial));
  rec = recorder();
  const lost = await e3.loadCore(rec.call, { serial: 'ZZ-1' });
  T.eq('a serial no view names: found among the units', [rec.log[2], lost.equipmentId, lost.error].join(' | '), 'getSerialRefs {"size":10000} | 7001 | ');
  T.eq('not found: said', (await e3.loadCore(recorder().call, { serial: 'NOPE-1' })).error, 'Unit NOPE-1 was not found in EquipRite: no unit record or booking names it.');
  T.eq('a name the master does not have', (await e3.loadCore(recorder().call, { name: 'Unicorn' })).error, 'Unicorn was not found in the equipment master.');
  T.eq('nothing named', (await e3.loadCore(recorder().call, {})).error, 'No equipment was named. Open one from the search, Availability or the Fleet.');

  T.section('every endpoint it calls exists in services/');
  const ops = {};
  ['eqp-v1', 'ProjectLOV'].forEach((svc) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', svc, 'openapi3.json'), 'utf8'));
    Object.values(spec.paths || {}).forEach((p) => Object.values(p).forEach((op) => { if (op && op.operationId) ops[svc + '/' + op.operationId] = op; }));
  });
  const used = Object.values(e3.EP).concat(['ProjectLOV/getInstalledBaseAssets', 'ProjectLOV/getMaintenanceWorkOrders']);
  T.eq('all of them', used.filter((u) => !ops[u]).join(), '');
  const params = (u) => (ops[u].parameters || []).map((p) => p.name);
  T.check('and each filter is one the endpoint takes', params(e3.EP.history).includes('equipmentMasterId') && params(e3.EP.history).includes('serialNumber') && params(e3.EP.deployed).includes('lineStatus')
    && params(e3.EP.serials).includes('equipmentId') && params(e3.EP.bookings).includes('equipmentMasterId') && params(e3.EP.allocations).includes('requestLineId')
    && params(e3.EP.inspections).includes('requestLineId') && params(e3.EP.orders).includes('equipmentRequestId') && params(e3.EP.moves).includes('equipmentRequestId')
    && params(e3.EP.orderLines).includes('transferOrderId') && params(e3.EP.certs).includes('equipmentId') && params(e3.EP.status).includes('requestId'));

  // ═══ the chains, with a fake Actions ═════════════════════════════════════════════════════════════════════════════
  T.section('the load chain (fake Actions)');
  const busLog = [];
  const bus = { open: (r) => busLog.push(Object.assign({ action: 'open' }, r)), rename: (id, title) => busLog.push({ action: 'rename', id, title }),
    toast: (message, tone) => busLog.push({ action: 'toast', message, tone }), focus: (navId, what) => busLog.push({ action: 'focus', navId, what }) };
  const restLog = [];
  const Actions = { async callRest(_c, o) { restLog.push(o); return backend(o); }, async callChain() { return { ok: true }; } };
  const exported = [];
  const fakeKit = { run: (format, o) => { exported.push({ format, o }); return Promise.resolve({ ok: true, message: o.rows.length + ' rows exported.' }); }, FORMATS: [] };
  const chain = (name) => loadAmd(path.join(CHAINS, name + '.js'), { 'vb/action/actionChain': class {}, 'vb/action/actions': Actions, 'resources/js/equipment360': e3,
    'resources/js/availability': av, 'resources/js/nav': nav, 'resources/js/shellBus': bus, 'resources/js/exportKit': fakeKit });
  const PageModule = loadAmd(path.join(PAGES, 'equipment-page.js'), { 'resources/js/exportKit': { FORMATS: [] }, 'resources/js/equipment360': e3 });
  const synced = [];
  const fns = new PageModule();
  fns.syncDates = (uid, from, toD) => synced.push(uid + ' ' + from + ' ' + toD);
  const pageVars = (o) => Object.assign({ name: '', equipmentId: '', serial: '', unit: '', key: '', uid: 'x', mode: '', isLoading: true, error: '', notes: [], head: {}, model: null,
    yards: {}, from: '', to: '', view: {}, maint: 'none', hist: { loading: true, events: [] }, hv: { chip: 'all', rows: [] }, exportOpen: false, loadSeq: 0 }, o);
  const ctxOf = (vars) => ({ $page: { variables: vars, functions: fns }, $application: { variables: {} } });
  const run = async (name, ctx, p) => { const C = chain(name); return new C().run(ctx, p || {}); };

  const vars = pageVars({ name: 'Komatsu D65EX-18 Dozer', equipmentId: '7001' });
  const ctx = ctxOf(vars);
  await run('loadChain', ctx);
  const realToday = av.todayKey();
  T.eq('the window opens on the next four weeks', [vars.from, vars.to].join(' '), realToday + ' ' + av.addDays(realToday, 27));
  T.eq('the page: head, units, the answer, the history', [vars.key, vars.uid, vars.mode, vars.head.title, vars.view.units.length, /^\d of 3 free from /.test(vars.view.answer), vars.hist.loading, vars.hist.count, vars.hv.rows.length].join(' | '),
    'item-7001 | item-7001 | item | Komatsu D65EX-18 Dozer | 3 | true | false | 30 | 30');
  T.eq('Fusion\'s maintenance read: the bars drawn', [vars.maint, vars.view.rows.find((r) => r.serial === 'D65-0101').bars.some((x) => x.kind === 'maintenance') || realToday > d(14)].join(), 'ready,true');
  T.eq('the tab named after it', JSON.stringify(busLog.filter((x) => x.action === 'rename')), '[{"action":"rename","id":"equipment-360:item-7001","title":"Komatsu D65EX-18 Dozer"}]');
  T.check('reads only: every call a read', restLog.every((o) => /^(eqp-v1|ProjectLOV)\/(get|list|search)/.test(o.endpoint) && !o.body), restLog.filter((o) => !/\/(get|list|search)/.test(o.endpoint)).map((o) => o.endpoint).join());
  T.eq('the failed inspection read is named on the page', vars.hist.failed, 'Not read, so left out: the inspections of 1 booking.');

  T.section('the window, the chips, the menu (setChain)');
  await run('setChain', ctx, { field: 'preset', value: '7' });
  T.eq('a quick window: the next 7 days, the boxes follow', [vars.from, vars.to, vars.view.from, vars.view.to, synced.pop()].join(' | '),
    [realToday, av.addDays(realToday, 6), realToday, av.addDays(realToday, 6), 'item-7001 ' + realToday + ' ' + av.addDays(realToday, 6)].join(' | '));
  await run('setChain', ctx, { field: 'to', value: av.addDays(realToday, 40) });
  T.check('a typed date: the window and the timeline follow (its weeks cover the window)', vars.to === av.addDays(realToday, 40) && vars.view.to === vars.to
    && vars.view.range.start <= vars.from && vars.view.range.end >= vars.to && vars.view.range.zoom === (vars.view.range.days > 42 ? 'month' : 'week'), JSON.stringify(vars.view.range));
  await run('setChain', ctx, { field: 'to', value: '' });
  T.eq('a cleared date box changes nothing', vars.to, av.addDays(realToday, 40));
  await run('setChain', ctx, { field: 'chip', value: 'D65-0103' });
  T.eq('a unit chip: its entries', [vars.hv.chip, vars.hv.rows.length, vars.hv.rows.every((e) => e.units.includes('D65-0103'))].join(), 'D65-0103,6,true');
  await run('setChain', ctx, { field: 'exportOpen', value: 'toggle' });
  T.eq('the export menu', vars.exportOpen, true);

  T.section('export (exportChain) and opening records (openChain)');
  await run('exportChain', ctx, { what: 'history', format: 'csv' });
  T.eq('the history as shown (the unit chip\'s), its columns', [exported[0].format, exported[0].o.name, exported[0].o.rows.length, exported[0].o.columns.map((c) => c.label).join(','), vars.exportOpen].join(' | '),
    'csv | Komatsu D65EX-18 Dozer history | 6 | When,What,Entry,Details,Unit,Who,Request, transfer or work order,Date from | false');
  await run('exportChain', ctx, { what: 'units', format: 'xlsx' });
  const ux = exported[1].o;
  T.eq('the units, with their state in the window', [ux.name, ux.rows.length, ux.columns.map((c) => c.label).join(','), ux.columns[4].value(ux.rows[0])].join(' | '),
    'Komatsu D65EX-18 Dozer units | 3 | Unit (serial),Equipment,Class,Yard,Now,Now, in detail,Next booking,In the window,Why | On site');
  T.eq('the result toasted', busLog.filter((x) => x.action === 'toast').map((x) => x.message).join(' / '), '6 rows exported. / 3 rows exported.');
  const hcols = e3.historyColumns();
  T.eq('a history row: where its date comes from', ['booking', 'status', 'maint'].map((k) => hcols[7].value(vars.hist.events.find((e) => e.kind === k))).join(), 'its dates,recorded,planned in Fusion');
  busLog.length = 0;
  await run('openChain', ctx, { kind: 'request', id: '511', number: 'REQ-10511' });
  await run('openChain', ctx, { kind: 'transfer', id: '3001', number: 'TO-3001' });
  await run('openChain', ctx, { kind: 'transfer', id: '', number: 'TO-3009', source: 'history' });
  await run('openChain', ctx, { kind: 'unit', serial: 'D65-0102' });
  await run('openChain', ctx, { kind: 'availability' });
  T.eq('a request, a transfer, a move on record, a unit, Availability searched for it', JSON.stringify(busLog),
    '[{"action":"open","record":"request","params":{"id":511,"number":"REQ-10511"}},{"action":"open","record":"transfer","params":{"id":3001,"number":"TO-3001"}},'
    + '{"action":"open","record":"transfer","params":{"number":"TO-3009","source":"history"}},'
    + '{"action":"open","record":"equipment-360","params":{"serial":"D65-0102","name":"Komatsu D65EX-18 Dozer","equipmentId":"7001"}},'
    + '{"action":"open","navId":"availability"},{"action":"focus","navId":"availability","what":{"text":"Komatsu D65EX-18 Dozer"}}]');

  T.section('a unit\'s tab (the load chain)');
  busLog.length = 0;
  const uvars = pageVars({ serial: 'D65-0103' });
  await run('loadChain', ctxOf(uvars));
  T.eq('itself, its head, the way back to every unit', [uvars.key, uvars.mode, uvars.head.title, uvars.head.allText, uvars.view.units.length, uvars.hist.chips.length].join(' | '),
    'unit-D65-0103 | unit | D65-0103 | All 3 units of this equipment | 1 | 0');
  T.eq('its tab named: serial and name', busLog.filter((x) => x.action === 'rename').map((x) => x.id + '=' + x.title).join(), 'equipment-360:unit-D65-0103=D65-0103 · Komatsu D65EX-18 Dozer');
  busLog.length = 0;
  await run('openChain', ctxOf(uvars), { kind: 'item' });
  await run('openChain', ctxOf(uvars), { kind: 'availability' });
  T.eq('all units of its equipment; Availability searched for the serial', JSON.stringify(busLog),
    '[{"action":"open","record":"equipment-360","params":{"name":"Komatsu D65EX-18 Dozer","equipmentId":"7001"}},{"action":"open","navId":"availability"},{"action":"focus","navId":"availability","what":{"text":"D65-0103"}}]');
  busLog.length = 0;
  const unitRec = pageVars({ unit: 'D65-0101' });
  await run('loadChain', ctxOf(unitRec));
  T.eq('opened as the unit record: both tab names follow', busLog.filter((x) => x.action === 'rename').map((x) => x.id).join(), 'equipment-360:unit-D65-0101,unit:D65-0101');
  const errVars = pageVars({ serial: 'NOPE-1' });
  await run('loadChain', ctxOf(errVars));
  T.eq('not found: said on the page, nothing else drawn', [errVars.error, errVars.isLoading, errVars.model, errVars.hist.loading].join(' | '),
    'Unit NOPE-1 was not found in EquipRite: no unit record or booking names it. | false |  | false');

  // ═══ the page ════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('the page and the records that open it');
  const pageJson = JSON.parse(fs.readFileSync(path.join(PAGES, 'equipment-page.json'), 'utf8'));
  const flow = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'fleet', 'fleet-flow.json'), 'utf8'));
  T.check('the flow and the page can be shown in a tab', flow.navigation.embeddable === 'enabled' && pageJson.navigation.embeddable === 'enabled' && flow.pages.equipment.path === 'pages/equipment-page');
  const named = [];
  Object.values(pageJson.eventListeners).forEach((l) => l.chains.forEach((c) => named.push(c.chain)));
  T.eq('every chain the page names exists', named.filter((c) => !fs.existsSync(path.join(CHAINS, c + '.js'))).join(), '');
  T.eq('its inputs', Object.keys(pageJson.variables).filter((k) => pageJson.variables[k].input === 'fromCaller').join(), 'name,equipmentId,serial,unit');
  const html = fs.readFileSync(path.join(PAGES, 'equipment-page.html'), 'utf8');
  const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
  T.eq('no arrow functions, String/Number/Boolean or array literals in bindings', bindings.filter((x) => /=>|\bString\(|\bNumber\(|\bBoolean\(|\|\|\s*\[\s*\]|\[\s*\]\s*\)/.test(x)).join(' '), '');
  T.check('no for-each inside a select or table', !/<(select|table|tbody)[^>]*>[\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
  T.check('every listener the page binds is declared', (html.match(/\$listeners\.(\w+)/g) || []).every((l) => pageJson.eventListeners[l.split('.')[1]]));
  T.check('every page function it binds exists', (html.match(/\$functions\.(\w+)/g) || []).every((f) => typeof PageModule.prototype[f.split('.')[1]] === 'function'),
    (html.match(/\$functions\.(\w+)/g) || []).filter((f) => typeof PageModule.prototype[f.split('.')[1]] !== 'function').join());
  const appFlow = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
  T.check('the stylesheet is imported, its classes are .nx-e3-*', appFlow.imports.css.indexOf('resources/css/next-equipment-360.css') !== -1
    && (fs.readFileSync(path.join(NEXT, 'resources', 'css', 'next-equipment-360.css'), 'utf8').match(/^\.[a-z][\w-]*/gm) || []).every((s) => s.startsWith('.nx-e3')));
  T.eq('equipment-360: a unit and an item, each its own tab, on this page', [tabs.forRecord('equipment-360', { serial: 'D65-0101' }), tabs.forRecord('equipment-360', { name: 'Komatsu D65EX-18 Dozer', equipmentId: 7001 })]
    .map((t) => t.id + '>' + t.flow + '/' + t.page).join(' '), 'equipment-360:unit-D65-0101>fleet/equipment equipment-360:item-7001>fleet/equipment');
  T.eq('the unit record ({ unit }) opens the same page', JSON.stringify(((t) => t && [t.id, t.flow, t.page, t.title])(tabs.forRecord('unit', { unit: 'D65-0101' }))), '["unit:D65-0101","fleet","equipment","D65-0101"]');
  T.eq('a deep link opens it', ((t) => t.id + ' ' + JSON.stringify(t.params))(tabs.fromQuery('?open=equipment-360&serial=D65-0101')), 'equipment-360:unit-D65-0101 {"serial":"D65-0101"}');
  T.check('Availability\'s modules are untouched copies in EquipRite Mobile', ['availability', 'availabilityData', 'requestHistory'].every((f) =>
    fs.readFileSync(path.join(JS, f + '.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'webApps', 'equiprite-mobile', 'resources', 'js', f + '.js'), 'utf8')));
  T.report();
})().catch((e) => { T.check('run finished', false, e && e.stack); T.report(); });
