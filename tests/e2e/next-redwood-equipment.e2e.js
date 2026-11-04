'use strict';
/*
 * EquipRite Next, the Equipment screens in the Redwood look (chosen in your menu), in a real browser:
 *   Fleet              Oracle's Smart Search page: a table row per unit (oj-table, oj-badge, oj-c buttons), a filter per
 *                      column (Status is the lane tiles), a filter narrowing the rows, a row opening the unit's 360 page,
 *                      Export; Current then shows the same filter on its tiles.
 *   Equipment 360      Oracle's general overview page as the header: the unit, what it is doing now as a badge, Export,
 *                      back to its equipment; the body as it is.
 *   Equipment master   Oracle's Smart Search page: a row per item, a filter per column, Import from Fusion under Oracle's
 *                      header and back, a row opening the item.
 *   Equipment item     Oracle's header: its status as a badge, Change class, Export, back to the master.
 *   Availability       Oracle's header over its own window, timeline and yard grid; Refresh.
 * Each screen: Oracle's templates upgraded, its data, no browser errors, a screenshot; then Current comes back as it was.
 * Three sessions, one after another on this suite's port (each with its own suite's backend: Fleet with 360, Equipment
 * master with its item, Availability). Needs `npm run build`. Run: node tests/e2e/next-redwood-equipment.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const PORT = 19630;

// Dates relative to today (the browser's calendar day), so the bookings are current whenever this runs.
const pad = (n) => (n < 10 ? '0' : '') + n;
const dayOf = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
const at = (n) => { const x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + n); return x; };
const d = (n) => dayOf(at(n));
const iso = (n, time) => d(n) + 'T' + (time || '00:00:00') + 'Z';

// ── Fleet (next-fleet.e2e.js's units) and Equipment 360 (next-equipment360.e2e.js's dozer, one of its units on Fleet) ──
const STOCK = [
  { unitNumber: 'EX-2201', unitType: 'SERIAL', assetNumber: 'FA-1001', equipmentName: 'CAT 320 Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
  { unitNumber: 'EX-2202', unitType: 'SERIAL', equipmentName: 'CAT 320 Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
  { unitNumber: 'DT-1108', unitType: 'SERIAL', equipmentName: 'Volvo A30 Dump Truck', className: 'Trucks', invOrgName: 'Odessa Yard', invOrgId: 2, unitStatus: 'RENTED' },
  { unitNumber: 'RL-0301', unitType: 'SERIAL', equipmentName: 'Roller 10t', className: 'Rollers', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE' },
  { unitNumber: 'RL-0302', unitType: 'SERIAL', equipmentName: 'Roller 10t', className: 'Rollers', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE' },
  { unitNumber: 'GN-0040', unitType: 'SERIAL', equipmentName: 'Generator 100kVA', className: 'Generators', invOrgName: 'Odessa Yard', invOrgId: 2, unitStatus: 'MAINTENANCE' },
  { unitNumber: 'LOT-77', unitType: 'LOT', equipmentName: 'Trench shoring panels', className: 'Safety', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE', onhandQty: 40 },
  { unitNumber: 'D65-0101', unitType: 'SERIAL', equipmentName: 'Komatsu D65EX-18 Dozer', className: 'Dozers', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
];
const FLEET_DEPLOYED = [
  { requestLineId: 1, serialNumber: 'EX-2201', unitType: 'SERIAL', requestId: 10482, requestNumber: 'REQ-10482', projectName: 'Pipeline North', lineStatus: 'DEPLOYED', startDate: d(-30), endDate: d(-4), overdue: true },
  { requestLineId: 2, serialNumber: 'EX-2202', unitType: 'SERIAL', requestId: 10490, requestNumber: 'REQ-10490', projectName: 'Plant Expansion B', lineStatus: 'DEPLOYED', startDate: d(-10), endDate: d(3), overdue: false },
  { requestLineId: 3, serialNumber: 'DT-1108', unitType: 'SERIAL', requestId: 10498, requestNumber: 'REQ-10498', customerName: 'Lone Star Paving', lineStatus: 'DEPLOYED', startDate: d(-2), endDate: d(30), overdue: false },
  { requestLineId: 9102, serialNumber: 'D65-0101', unitType: 'SERIAL', requestId: 511, requestNumber: 'REQ-10511', projectName: 'Pipeline North', lineStatus: 'DEPLOYED', startDate: d(-5), endDate: d(10), overdue: false },
];
const FLEET_LINES = [
  { requestNumber: 'REQ-10510', requestStatus: 'IN_PROCESS', startDate: d(4), endDate: d(20), projectName: 'Substation 4', allocatedSerial: 'EX-2202' },
  { requestNumber: 'REQ-10511', requestStatus: 'ALLOCATED', startDate: d(2), endDate: d(9), projectName: 'Plant Expansion B', allocatedSerial: 'RL-0301' },
  { requestNumber: 'REQ-10512', requestStatus: 'ALLOCATED', startDate: d(40), endDate: d(50), projectName: 'Plant Expansion B', allocatedSerial: 'RL-0302' },
];

const E3 = (() => {
  const MASTER = { id: 7001, equipmentName: 'Komatsu D65EX-18 Dozer', equipmentNumber: 'EQ-7001', equipmentClassId: 41, manufacturer: 'Komatsu', modelNumber: 'D65EX-18',
    mfgYear: 2023, maintenanceAssetNumber: 'MA-D65', currentLocationId: 501, createdDate: '2025-01-05T09:00:00Z', createdBy: 'priya.raman' };
  const SERIALS = [
    { id: 81, serialNumber: 'D65-0101', equipmentId: 7001, currentLocationId: 501, maintenanceAssetNumber: 'MA-0101', createdDate: '2025-03-02T09:30:00Z', createdBy: 'priya.raman' },
    { id: 82, serialNumber: 'D65-0102', equipmentId: 7001, currentLocationId: 501 },
    { id: 83, serialNumber: 'D65-0103', equipmentId: 7001, currentLocationId: 502 },
  ];
  const LOCATIONS = { 501: { id: 501, locationName: 'Houston Yard', locationCode: 'HOU-Y1' }, 502: { id: 502, locationName: 'Dallas Yard', locationCode: 'DAL-Y2' } };
  const hist = (lid, serial, from, to, alloc, line, extra) => Object.assign({ requestLineId: lid, equipmentMasterId: 7001, equipmentName: 'Komatsu D65EX-18 Dozer',
    serialNumber: serial, startDate: iso(from), endDate: iso(to), allocationStatus: alloc, lineStatus: line, projectName: null, customerName: null }, extra || {});
  const HISTORY = [
    hist(9101, 'D65-0101', -60, -30, 'ALLOCATED', 'RETURNED', { projectName: 'Harbour Wall' }),
    hist(9102, 'D65-0101', -5, 10, 'ALLOCATED', 'DEPLOYED', { projectName: 'Pipeline North' }),
    hist(9103, 'D65-0102', -2, 3, 'ALLOCATED', 'SCHEDULED_FOR_PICKING', { projectName: 'Substation 4' }),
    hist(9104, 'D65-0102', 8, 20, 'PENDING', 'IN_PROCESS', { projectName: 'Plant Expansion B' }),
    hist(9105, 'D65-0103', -20, -1, 'ALLOCATED', 'RETURN_IN_PROCESS', { projectName: 'Gulf Terminal' }),
  ];
  const dep = (lid, serial, rid, num, line, from, to) => ({ requestLineId: lid, serialNumber: serial, requestId: rid, requestNumber: num, requestType: 'INTERNAL',
    lineStatus: line, startDate: iso(from), endDate: iso(to), equipmentMasterId: 7001 });
  const DEPLOYED = [
    dep(9101, 'D65-0101', 400, 'REQ-10400', 'RETURNED', -60, -30), dep(9102, 'D65-0101', 511, 'REQ-10511', 'DEPLOYED', -5, 10),
    dep(9103, 'D65-0102', 530, 'REQ-10530', 'SCHEDULED_FOR_PICKING', -2, 3), dep(9104, 'D65-0102', 560, 'REQ-10560', 'IN_PROCESS', 8, 20),
    dep(9105, 'D65-0103', 480, 'REQ-10480', 'RETURN_IN_PROCESS', -20, -1),
  ];
  const LDB = [
    { serialNumber: 'D65-0101', bookingRequestId: 511, bookingRequestNumber: 'REQ-10511', bookingStartDate: iso(-5), bookingEndDate: iso(10), allocStatus: 'ALLOCATED',
      projectName: 'Pipeline North', taskName: 'Earthworks', requestor: 'Pat Lee', location: 'Gate 3' },
    { serialNumber: 'D65-0103', bookingRequestId: 620, bookingRequestNumber: 'REQ-10620', bookingStartDate: iso(30), bookingEndDate: iso(40), allocStatus: 'ALLOCATED',
      projectName: 'Refinery Turnaround', requestor: 'Sam Ortiz' },
  ];
  function handle(req, res) {
    const p = req.path.replace('/equiprite/v1', '');
    const q = req.query;
    let m;
    if ((m = /^\/equipment-master\/(\d+)$/.exec(p))) return Number(m[1]) === 7001 ? res.json(MASTER) : res.json({ message: 'not found' }, 404);
    if (p === '/equipment-master') return res.json({ data: /komatsu/i.test(q.get('q') || '') ? [MASTER] : [], hasMore: false });
    if ((m = /^\/equipment-classes\/(\d+)$/.exec(p))) return res.json({ id: Number(m[1]), className: 'Dozers' });
    if (p === '/serial-refs') return res.json({ data: !q.get('equipmentId') || Number(q.get('equipmentId')) === 7001 ? SERIALS : [], hasMore: false });
    if ((m = /^\/locations\/(\d+)$/.exec(p))) return LOCATIONS[m[1]] ? res.json(LOCATIONS[m[1]]) : res.json({ message: 'not found' }, 404);
    if (p === '/views/equipment-history') return res.json({ data: q.get('serialNumber') ? HISTORY.filter((x) => x.serialNumber === q.get('serialNumber')) : HISTORY, hasMore: false });
    if (p === '/views/deployed-units') return res.json({ data: q.get('serialNumber') ? DEPLOYED.filter((x) => x.serialNumber === q.get('serialNumber')) : DEPLOYED, hasMore: false });
    if (p === '/views/line-detail-bookings') return res.json({ data: LDB, hasMore: false });
    if (p.endsWith('/installedBaseAssets') || p.endsWith('/maintenanceWorkOrders')) return res.json({ items: [] });
    return undefined;
  }
  return { handle };
})();

function fleetHandle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  if (p === '/views/yard-stock') return res.json({ data: STOCK });
  // Fleet's units out (by line status); Equipment 360 asks by serial or by its equipment.
  if (p === '/views/deployed-units' && !req.query.get('serialNumber') && !req.query.get('equipmentMasterId')) {
    return res.json({ data: FLEET_DEPLOYED, recordCount: FLEET_DEPLOYED.length });
  }
  if (p === '/views/workbench-lines') return res.json({ data: FLEET_LINES });
  return E3.handle(req, res);
}

// ── Equipment master and an item (next-equipment.e2e.js's catalog) ──────────────────────────────────────────────────
const EQM = (() => {
  const V1 = '/equiprite/v1';
  const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Generators' }, { id: 4, className: 'Rollers' }];
  const SUBCLASSES = [{ id: 11, subclassName: 'Crawler', eqrEquipmentClassId: 1 }, { id: 12, subclassName: 'Mini', eqrEquipmentClassId: 1 },
    { id: 41, subclassName: 'Vibratory', eqrEquipmentClassId: 4 }];
  const LOCATIONS = [{ id: 501, locationName: 'Houston Yard', latitude: 29.76, longitude: -95.37 }, { id: 502, locationName: 'Dallas Yard', latitude: 32.78, longitude: -96.8 }];
  const EQUIPMENT = [
    { id: 101, equipmentNumber: 'EQ-2201', equipmentName: 'CAT 320 Excavator', equipmentClassId: 1, equipmentSubclassId: 11, catalogStatus: 'ACTIVE',
      createdBy: 'FUSION_IMPORT', isSerialControlled: 'Y', isLotControlled: 'N', serialUnitCount: 3, currentLocationId: 501, manufacturer: 'Caterpillar',
      modelNumber: '320 GC', equipmentType: 'COMPANY_OWNED' },
    { id: 102, equipmentNumber: 'EQ-2202', equipmentName: 'Komatsu PC210', equipmentClassId: 1, equipmentSubclassId: 11, catalogStatus: 'ACTIVE',
      createdBy: 'admin', isSerialControlled: 'Y', serialUnitCount: 1, currentLocationId: 502, manufacturer: 'Komatsu' },
    { id: 103, equipmentNumber: 'EQ-3101', equipmentName: 'Generator 60 kVA', equipmentClassId: 2, catalogStatus: 'INACTIVE',
      createdBy: 'FUSION_IMPORT', isLotControlled: 'Y', onHandQty: 4, currentLocationId: 501 },
    { id: 104, equipmentNumber: 'EQ-4001', equipmentName: 'Vibratory roller CB2', equipmentClassId: 4, equipmentSubclassId: 41, catalogStatus: 'ACTIVE',
      createdBy: 'FUSION_IMPORT', isSerialControlled: 'Y', serialUnitCount: 2 },
    { id: 105, equipmentNumber: 'EQ-5001', equipmentName: 'Light tower', catalogStatus: 'ACTIVE', createdBy: 'admin' },
  ];
  const UNITS = { 101: [
    { id: 7, serialNumber: 'CAT0320A1', unitStatus: 'AVAILABLE', currentLocationId: 501, invOrgId: 9, maintenanceAssetNumber: 'MA-1001', inServiceDate: '2024-03-01' },
    { id: 8, serialNumber: 'CAT0320A2', unitStatus: 'RENTED', currentLocationId: 501, invOrgId: 9, unitTagNumber: 'TAG-88' },
    { id: 9, serialNumber: 'CAT0320A3', unitStatus: 'IN_MAINTENANCE', currentLocationId: 501, invOrgId: 9 }] };
  const STAGING = [
    { fusionInventoryItemId: 9001, itemNumber: 'EXC-330', itemDescription: 'CAT 330 Excavator', itemClassCode: 'HEAVY', categoryName: 'Excavators',
      importStatus: 'AUTO_MAPPED', resolvedClassId: 1, resolvedSubclassId: 11, serialNumControlCode: 2, resolvedSource: 'INVENTORY' },
    { fusionInventoryItemId: 9002, itemNumber: 'GEN-100', itemDescription: 'Generator 100 kVA', itemClassCode: 'HEAVY', categoryName: 'Power',
      importStatus: 'UNMAPPED', resolvedClassId: null, resolvedSubclassId: null, inventoryItemFlag: 'Y', rejectReason: 'No mapping source' },
  ];
  const DOCS = [
    { id: 71, commonDocId: 900, entityName: 'EQR_EQUIPMENT_MASTER', attachmentName: 'Load test certificate', fileName: 'load-test.pdf', contentType: 'application/pdf',
      categoryId: 1, categoryLabel: 'Load test', validityRequired: 'Y', validFromDate: d(-344), validToDate: d(21), createdBy: 'priya.raman', createdDate: '2026-01-10' },
  ];
  function handle(req, res) {
    const p = req.path;
    const m = req.method;
    if (p === V1 + '/equipment-master' && m === 'GET') {
      const q = String(req.query.get('q') || '').toLowerCase();
      const rows = q ? EQUIPMENT.filter((r) => [r.equipmentName, r.manufacturer].some((v) => v && v.toLowerCase().includes(q))) : EQUIPMENT;
      return res.json({ data: rows, recordCount: rows.length, hasMore: false });
    }
    if (p === V1 + '/equipment-master/101') {
      return res.json(Object.assign({}, EQUIPMENT[0], { objectVersionNumber: 3, maintenanceAssetNumber: 'MA-1001', mfgYear: 2022, capacity: 20, capacityUom: 't',
        isMaintenanceTracked: 'Y', isFixedAssetTracked: 'N', isInventoryTracked: 'Y', lastUpdatedDate: '2026-10-28T06:15:00Z' }));
    }
    if (p === V1 + '/equipment-classes') return res.json({ data: CLASSES, hasMore: false });
    if (/\/equipment-classes\/\d+$/.test(p)) return res.json(CLASSES.find((c) => p.endsWith('/' + c.id)) || {});
    if (/\/equipment-classes\/\d+\/subclasses\/\d+$/.test(p)) return res.json(SUBCLASSES.find((s) => p.endsWith('/' + s.id)) || {});
    if (p === V1 + '/subclasses') return res.json({ data: SUBCLASSES, hasMore: false });
    if (p === V1 + '/asset-groups') return res.json({ data: [{ id: 7, groupName: 'Earthmoving' }], hasMore: false });
    if (p === V1 + '/locations') return res.json({ data: LOCATIONS });
    if (/\/locations\/\d+$/.test(p)) return res.json(LOCATIONS.find((l) => p.endsWith('/' + l.id)) || {});
    if (p === V1 + '/inv-orgs') return res.json({ data: [{ invOrgId: 9, organizationName: 'HOU-YARD' }] });
    if (p === V1 + '/job-run-logs') return res.json({ data: [{ jobName: req.query.get('jobName'), startedAt: '2026-10-28T06:15:00Z' }] });
    if (p === V1 + '/serial-refs') return res.json({ data: UNITS[Number(req.query.get('equipmentId'))] || [] });
    if (p === V1 + '/conf-attachment-categories') return res.json({ data: [{ id: 1, categoryCode: 'LOAD_TEST', categoryLabel: 'Load test', validityRequired: 'Y' }] });
    if (p === V1 + '/equipment-attachments') return res.json({ data: req.query.get('entityId') === '101' ? DOCS : [] });
    if (p === V1 + '/exp-type-maps') return res.json({ data: [{ expenditureType: 'Equipment Rental', isDefault: 'Y' }] });
    if (p === V1 + '/views/exp-type-map-resolve') return res.json({ data: [{ eqrEquipmentMasterId: 101, resolvedLevel: 'MASTER', types: [{ expenditureType: 'Equipment Rental', isDefault: 'Y' }] }] });
    if (p.endsWith('/installedBaseAssets')) return res.json({ items: [{ AssetNumber: 'MA-1001', AssetId: 300100, OperatingOrganizationCode: 'HOU' }] });
    if (p.endsWith('/maintenanceWorkOrders')) return res.json({ items: [] });
    if (p.endsWith('/itemClasses')) return res.json({ items: [{ ItemClassCode: 'HEAVY', ItemClass: 'Heavy equipment' }] });
    if (p.endsWith('/standardLookupsLOV')) return res.json({ items: [{ LookupCode: 'EQUIPMENT', Meaning: 'Equipment' }] });
    if (p === V1 + '/equipment-import/staging' && m === 'GET') return res.json({ items: STAGING, totalElements: STAGING.length });
    if (p === V1 + '/equipment-import/unmatched-values') return res.json({ items: [{ dimType: 'CATEGORY', dimValue: 'Power', itemCount: 7, reason: 'NO_MAPPING_MATCH' }], totalGroups: 1 });
    if (p === V1 + '/fusion-sync/lock' && m === 'GET') return res.json({ held: false });
    return undefined;
  }
  return { handle };
})();

// ── Availability (next-availability.e2e.js's fleet, without its 300 generators) ────────────────────────────────────
const AV = (() => {
  const SERIALS = [
    { id: 1, serialNumber: 'EX-2201', equipmentId: 11, currentLocationId: 501, maintenanceAssetNumber: 'MA-2201' },
    { id: 2, serialNumber: 'EX-2203', equipmentId: 11, currentLocationId: 501 },
    { id: 3, serialNumber: 'EX-2210', equipmentId: 12, currentLocationId: 502 },
    { id: 4, serialNumber: 'MC-07', equipmentId: 21, currentLocationId: 502 },
    { id: 5, serialNumber: 'TC-02', equipmentId: 22 },
  ];
  const MASTERS = [{ id: 11, equipmentName: 'CAT 320 Excavator', equipmentClassId: 1 }, { id: 12, equipmentName: 'PC210 Excavator', equipmentClassId: 1 },
    { id: 21, equipmentName: 'Mobile Crane 50t', equipmentClassId: 2 }, { id: 22, equipmentName: 'Tower Crane', equipmentClassId: 2 }];
  const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Cranes' }];
  const line = (id, serial, req, reqId, project, status, from, to, extra) => Object.assign({
    eqrRequestLineId: id, eqrEquipmentRequestId: reqId, requestNumber: req, lineNumber: 1, projectName: project, taskName: 'Earthworks',
    requestorName: 'Pat Lee', allocatedSerial: serial, allocStatus: status, requestedStartDate: iso(from), requestedEndDate: iso(to), deploymentLocation: 'Gate 3' }, extra || {});
  const LINES = [
    line(9001, 'EX-2201', 'REQ-10511', 511, 'Pipeline North', 'ALLOCATED', -5, 10),
    line(9002, 'EX-2201', 'REQ-10530', 530, 'Plant Expansion B', 'PENDING', 5, 30),
    line(9004, 'EX-2210', 'REQ-10540', 540, 'Pipeline North', 'ALLOCATED', 3, 12),
    line(9005, 'MC-07', 'REQ-10498', 498, 'Plant Expansion B', 'ALLOCATED', -20, 6),
    line(9010, 'MC-07', 'REQ-10560', 560, 'Harbour Wall', 'ALLOCATED', 8, 20),
  ];
  const LOCATIONS = { 501: { id: 501, locationName: 'Houston Yard', locationCode: 'HOU-Y1' }, 502: { id: 502, locationName: 'Dallas Yard', locationCode: 'DAL-Y2' } };
  function handle(req, res) {
    const p = req.path;
    if (p.endsWith('/serial-refs')) return res.json({ data: SERIALS, hasMore: false });
    if (p.endsWith('/equipment-classes')) return res.json({ data: CLASSES, hasMore: false });
    if (p.endsWith('/views/workbench-lines')) return res.json({ data: LINES, hasMore: false });
    if (p.endsWith('/equipment-master')) return res.json({ data: MASTERS, recordCount: MASTERS.length, hasMore: false });
    const loc = /\/locations\/(\d+)$/.exec(p);
    if (loc) return LOCATIONS[loc[1]] ? res.json(LOCATIONS[loc[1]]) : res.json({ message: 'not found' }, 404);
    if (p.endsWith('/installedBaseAssets') || p.endsWith('/maintenanceWorkOrders')) return res.json({ items: [] });
    return undefined;
  }
  return { handle };
})();

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const settle = (page, ms) => page.waitForTimeout(ms || 400);
/** Browser errors, but not a resource the stand-in backend has no answer for (404). */
const errorsOf = (env, from) => env.errors.slice(from || 0).filter((e) => !/404|Failed to load resource/.test(e));
const OJ_LIST = ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button'];
/** Each of Oracle's components in a Redwood view, upgraded ('tag:true'). */
const upgraded = (page, root, tags) => page.evaluate(([r, list]) => list.map((t) => {
  const el = document.querySelector(r + ' ' + t);
  return t + ':' + (el ? el.classList.contains('oj-complete') : 'missing');
}).join(' '), [root, tags]);
const allUpgraded = (tags) => tags.map((t) => t + ':true').join(' ');
/** The Redwood table's rows, as text, those matching `re`. */
const tableRows = (page, table, re) => page.$$eval(table + ' tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()), null)
  .then((rows) => rows.filter((t) => re.test(t)));
/** Smart Search's filter chips, once all `n` are laid out. */
async function chips(page, root, n) {
  await page.waitForFunction(([r, k]) => Array.from(document.querySelectorAll(r + ' oj-sp-smart-search .oj-sp-filter-chip-container'))
    .filter((x) => x.innerText.trim()).length === k, [root, n], { timeout: 20000 }).catch(() => {});
  await settle(page, 500);
  return (await page.$$eval(root + ' oj-sp-smart-search .oj-sp-filter-chip-container', (b) => b.map((x) => x.innerText.trim()))).join(',');
}
/** Picks a filter's option in Smart Search, then closes its list (Smart Search applies a filter as its list closes). */
async function pick(page, root, label, option) {
  const chip = await page.evaluateHandle(([r, l]) => Array.from(document.querySelectorAll(r + ' oj-sp-smart-search .oj-sp-filter-chip-container'))
    .find((x) => x.innerText.trim() === l), [root, label]);
  await chip.asElement().click();
  await page.waitForSelector('text=' + option, { timeout: 10000 });
  const offered = await page.$$eval('[role=option], li', (o) => o.filter((x) => x.offsetParent !== null).map((x) => x.innerText.trim()).filter((t) => /\(\d+\)$/.test(t)));
  await page.click('text=' + option);
  await settle(page, 600);
  await page.click(root + ' oj-sp-smart-search-page h1');
  await settle(page, 800);
  return offered;
}
/** A header action of Oracle's general overview page: a button on its band, or an item of its More Actions menu. */
async function headerAction(page, root, label) {
  const hit = await page.evaluateHandle(([r, l]) => Array.from(document.querySelectorAll(r + ' button'))
    .find((b) => b.offsetParent !== null && b.innerText.trim() === l), [root, label]);
  if (hit.asElement()) { await hit.asElement().click(); return 'button'; }
  await page.click(root + ' button[aria-label="More Actions"]');
  const item = '[role=menuitem]:has-text("' + label + '")';
  await page.waitForSelector(item, { state: 'visible', timeout: 5000 });
  await page.click(item);
  return 'menu';
}
/** Clicks something that downloads; its file name. */
async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), click()]);
  return dl.suggestedFilename();
}
const activeTab = (page) => page.$eval('.nx-tab--on', (t) => t.dataset.tabId);
const waitTab = (page, id) => page.waitForFunction((t) => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === t, id, { timeout: 20000 });
const look = (page) => page.getAttribute('html', 'data-nx-look');
const noSideways = (page, sel) => page.$eval(sel, (sc) => sc.scrollWidth <= sc.clientWidth + 1);
/** The page header's band runs on behind the top of the content, as Old's banner (next-redwood.css). */
const banner = (page, sel) => page.$eval(sel, (el) => getComputedStyle(el).backgroundImage);

async function fleetAnd360() {
  const env = await E.start({ port: PORT, handle: fleetHandle, app: 'next' });
  const { page } = env;
  const fleetRows = () => tableRows(page, '#fleetRwTable', /^[A-Z]+[-\d]+ /);
  try {
    await env.open('/?open=fleet');
    await page.waitForSelector('.nx-ucard', { timeout: 30000 });
    T.eq('Current to start', await look(page), 'current');
    await env.setLook('redwood');

    T.section('Fleet: Oracle\'s Smart Search page');
    await page.waitForSelector('#fleetRedwood oj-sp-smart-search-page', { timeout: 30000 });
    await page.waitForFunction(() => /EX-2201/.test((document.querySelector('#fleetRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    T.eq('Oracle\'s components, upgraded', await upgraded(page, '#fleetRedwood', OJ_LIST), allUpgraded(OJ_LIST));
    const head = await env.text('#fleetRedwood oj-sp-smart-search-page h1');
    T.eq('the template\'s header: the title', head, 'Fleet');
    T.check('…and the summary, as Current says it', (await env.text('#fleetRedwood oj-sp-smart-search-page')).includes('8 units · 4 out (50%) · 1 overdue · 1 tight turnarounds'));
    T.check('the current look steps aside', !(await page.isVisible('.nx-fleet .nx-pagehead')) && !(await page.$('.nx-fleet-tiles')));
    const rows = await fleetRows();
    T.eq('a table row per unit (the list, not the board)', rows.length, 8);
    T.check('a row: unit, equipment and class, where it is as a badge and when, request and project, next booking, yard',
      rows.some((r) => r.startsWith('EX-2202') && r.includes('CAT 320 Excavator Excavators') && r.includes('Due back this week') && r.includes('Back in 3 days')
        && r.includes('1-day turnaround') && r.includes('REQ-10490 Plant Expansion B') && r.includes('REQ-10510') && r.includes('Houston Yard')), rows.join(' || '));
    T.eq('statuses are Oracle\'s oj-badge, by where the unit is', await page.$$eval('#fleetRwTable .oj-badge', (b) => b.map((x) => x.className.replace('oj-badge ', '') + '=' + x.innerText.trim())
      .filter((t) => /Overdue|In the yard|Out on rent/.test(t)).sort().join(' | ')),
    'oj-badge-danger oj-badge-subtle=Overdue | oj-badge-info=Out on rent | oj-badge-info=Out on rent | oj-badge-success oj-badge-subtle=In the yard | oj-badge-success oj-badge-subtle=In the yard');
    T.eq('the unit panel\'s steps, as oj-c buttons on their rows', (await page.$$eval('#fleetRwTable oj-c-button[data-nav]', (b) => b.map((x) => x.getAttribute('data-key') + ':' + x.getAttribute('data-nav'))))
      .sort().join(' '), 'EX-2201:returns EX-2202:returns RL-0301:picking');
    T.check('every column fits: no table scrolling sideways', await noSideways(page, '#fleetRwTable .oj-table-scroller'));
    T.check('the header\'s colour runs on behind the top of the table', /linear-gradient\(rgb\(44, 82, 102\)/.test(await banner(page, '.nx-fleet')));

    T.section('Fleet: a filter per column');
    T.eq('the filters are the columns', await chips(page, '#fleetRedwood', 8), 'Unit,Equipment,Class,Status,Request,Project or customer,Next booking,Yard');
    await env.shot('rw-equipment-fleet.png');

    T.section('Fleet: a row opens everything about the unit (its 360 page)');
    await page.click('#fleetRwTable tbody tr:has-text("D65-0101") .nx-rw-num');
    await waitTab(page, 'equipment-360:unit-D65-0101');
    T.eq('the unit\'s 360 page, in a tab of its own', await activeTab(page), 'equipment-360:unit-D65-0101');

    T.section('Equipment 360: Oracle\'s general overview page as the header');
    await page.waitForSelector('#e3Redwood oj-sp-general-overview-page.oj-complete', { timeout: 30000 });
    await page.waitForFunction(() => /Komatsu D65EX-18 Dozer/.test((document.querySelector('#e3Redwood') || {}).innerText || '')
      && !!document.querySelector('.nx-e3 .nx-e3-units'), null, { timeout: 30000 });
    await settle(page, 1200);
    T.eq('the title: the unit', await env.text('#e3Redwood h1'), 'D65-0101');
    const e3head = await env.text('#e3Redwood');
    T.check('the subtitle: its equipment, class and yard, its facts', e3head.includes('Unit · Komatsu D65EX-18 Dozer · Dozers · Kept at HOU-Y1 · Houston Yard · EQ-7001 · Komatsu · D65EX-18 · 2023'), e3head);
    T.check('what it is doing now, in the units below', (await env.text('.nx-e3 .nx-e3-units')).includes('On site REQ-10511 · Pipeline North · until'));
    T.eq('what it is doing now: Oracle\'s badge on the header', await page.$eval('#e3Redwood oj-sp-header-general-overview', (h) => (h.badge && h.badge.text) + '/' + (h.badge && h.badge.status)),
      'On site/info');
    T.check('the current head steps aside; the body stays: units, availability ahead, history', !(await page.isVisible('.nx-e3 .nx-e3-head'))
      && await page.isVisible('.nx-e3 .nx-e3-units') && await page.isVisible('.nx-e3 .nx-e3-ahead') && await page.isVisible('.nx-e3 .nx-e3-hist'));
    T.check('Open in Availability is its primary action', (await page.$$eval('#e3Redwood button', (b) => b.filter((x) => x.offsetParent !== null).map((x) => x.innerText.trim()))).includes('Open in Availability'));
    await env.shot('rw-equipment-360.png');
    const hfile = await download(page, () => headerAction(page, '#e3Redwood', 'Export the history'));
    T.check('a header action: Export the history, as Excel', /history.*\.xlsx$/.test(hfile), hfile);
    await page.click('#e3Redwood .oj-sp-header-general-overview-inflow-back-btn button');
    await waitTab(page, 'equipment-360:item-7001');
    T.eq('back: every unit of its equipment', await activeTab(page), 'equipment-360:item-7001');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.nx-e3 [id="e3Redwood"] h1')).some((h) => h.offsetParent !== null && /Komatsu/.test(h.innerText)), null, { timeout: 30000 });

    T.section('Fleet: a filter narrows the rows, and Current shows the same filter');
    await page.click('.nx-tab-btn[data-id="fleet"]');
    await waitTab(page, 'fleet');
    await settle(page, 600);
    const offered = await pick(page, '#fleetRedwood', 'Status', 'Overdue (1)');
    T.eq('Status offers the lane tiles, with how many', offered.join(','), 'All (8),In the yard (2),Going out this week (1),Out on rent (2),Due back this week (1),Overdue (1),Maintenance (1),Tight turnaround (1)');
    await page.waitForFunction(() => !/EX-2202/.test((document.querySelector('#fleetRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    T.eq('picked (applied as its list closes): the overdue unit only', (await fleetRows()).map((r) => r.split(' ')[0]).join(), 'EX-2201');
    await env.shot('rw-equipment-fleet-filter.png');
    const ffile = await download(page, () => page.click('#fleetRwExport'));
    T.check('Export to Excel: the units shown', /^equiprite-fleet-\d{4}-\d{2}-\d{2}\.xlsx$/.test(ffile), ffile);

    T.eq('no browser errors in Redwood', errorsOf(env).join(' | ').slice(0, 1500), '');

    T.section('Current: as it was, on the same filter');
    await env.setLook('current');
    await page.waitForSelector('.nx-fleet .nx-pagehead', { timeout: 15000 });
    T.check('the current Fleet again (the Redwood view kept, hidden)', (await look(page)) === 'current' && !(await page.isVisible('#fleetRedwood'))
      && await page.isVisible('.nx-fleet .nx-pagehead') && await page.isVisible('.nx-fleet-tiles'));
    T.eq('the Overdue tile is on: the same filter', await page.getAttribute('.nx-kpi[data-value="overdue"]', 'aria-pressed'), 'true');
    T.eq('its board shows the same unit', await page.$$eval('.nx-ucard', (c) => c.map((x) => x.dataset.key).join()), 'EX-2201');
    await page.click('.nx-tab-btn[data-id="equipment-360:item-7001"]');
    await waitTab(page, 'equipment-360:item-7001');
    T.check('the 360 page\'s own head is back, Oracle\'s put aside', await page.waitForFunction(() => Array.from(document.querySelectorAll('.nx-e3 .nx-e3-head'))
      .some((h) => h.offsetParent !== null && /Komatsu D65EX-18 Dozer/.test(h.innerText)), null, { timeout: 10000 }).then(() => true, () => false)
      && !(await page.$$eval('.nx-e3-rw', (r) => r.some((x) => x.offsetParent !== null))));
    T.eq('no browser errors', errorsOf(env).join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('Fleet and 360: run finished', false, String((e && e.stack) || e).slice(0, 1500));
    await env.shot('rw-equipment-fleet-failed.png').catch(() => {});
  } finally {
    await env.close();
  }
}

async function masterAndItem() {
  const env = await E.start({ port: PORT, handle: EQM.handle, app: 'next' });
  const { page } = env;
  const itemRows = () => tableRows(page, '#eqmRwTable', /EQ-\d+/);
  try {
    await env.open('/?open=equipment');
    await page.waitForSelector('.nx-grid--eqm .nx-row--click', { timeout: 30000 });
    await env.setLook('redwood');

    T.section('Equipment master: Oracle\'s Smart Search page, as Old\'s');
    await page.waitForSelector('#eqmRedwood oj-sp-smart-search-page', { timeout: 30000 });
    await page.waitForFunction(() => /EQ-2201/.test((document.querySelector('#eqmRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    T.eq('Oracle\'s components, upgraded', await upgraded(page, '#eqmRedwood', OJ_LIST), allUpgraded(OJ_LIST));
    T.eq('the template\'s header: the title', await env.text('#eqmRedwood oj-sp-smart-search-page h1'), 'Equipment master');
    T.check('…and the summary, as Current says it', (await env.text('#eqmRedwood oj-sp-smart-search-page')).includes('5 items · 6 serials · 4 on hand'));
    const acts = await page.$$eval('#eqmRedwood oj-sp-smart-search-page button', (b) => b.filter((x) => x.offsetParent !== null).map((x) => x.innerText.trim()));
    T.check('Sync and Import from Fusion: the header\'s actions', acts.includes('Sync from Fusion') && acts.includes('Import from Fusion (2 to review)'), acts.join(' | '));
    T.check('the current look steps aside', !(await page.isVisible('.nx-eqm .nx-pagehead')) && !(await page.isVisible('.nx-eqm .nx-toolbar')));
    const rows = await itemRows();
    T.eq('a table row per item', rows.length, 5);
    T.check('a row: name, number and maker, class and subclass, tracking, units, location, status as a badge and source',
      rows.some((r) => r.startsWith('CAT 320 Excavator EQ-2201 · Caterpillar 320 GC') && r.includes('Excavators Crawler') && r.includes('Serial') && r.includes('3 serials')
        && r.includes('Houston Yard') && r.includes('Active From Fusion')), rows.join(' || '));
    T.eq('statuses are Oracle\'s oj-badge', await page.$$eval('#eqmRwTable .oj-badge', (b) => b.map((x) => x.className.replace('oj-badge ', '') + '=' + x.innerText.trim()).sort()
      .filter((t, i, a) => a.indexOf(t) === i).join(' | ')), 'oj-badge-subtle=Inactive | oj-badge-success oj-badge-subtle=Active');
    T.check('every column fits: no table scrolling sideways', await noSideways(page, '#eqmRwTable .oj-table-scroller'));
    T.eq('the filters are the columns, then Asset group', await chips(page, '#eqmRedwood', 9), 'Equipment,Class,Subclass,Tracked by,Units,Location,Status,Source,Asset group');
    await env.shot('rw-equipment-master.png');

    T.section('Equipment master: a filter narrows the rows');
    const offered = await pick(page, '#eqmRedwood', 'Class', 'Excavators (2)');
    T.eq('Class offers the classes the items hold, with how many', offered.join(','), 'Excavators (2),Generators (1),No class (1),Rollers (1)');
    await page.waitForFunction(() => !/EQ-3101/.test((document.querySelector('#eqmRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    T.eq('picked: the excavators', (await itemRows()).map((r) => r.match(/EQ-\d+/)[0]).join(), 'EQ-2201,EQ-2202');
    T.check('…and the summary says so', (await env.text('#eqmRedwood oj-sp-smart-search-page')).includes('2 of 5 items'));
    await env.shot('rw-equipment-master-filter.png');

    T.section('Equipment master: Import from Fusion, under Oracle\'s header, and back');
    await headerAction(page, '#eqmRedwood', 'Import from Fusion (2 to review)');
    await page.waitForFunction(() => { const r = document.querySelector('#eqmRwImport'); return r && !r.hidden; }, null, { timeout: 10000 });
    await page.waitForSelector('#eqmRwImport oj-sp-general-overview-page.oj-complete', { timeout: 20000 });
    await page.waitForSelector('#impFetch', { state: 'visible', timeout: 20000 });
    await settle(page, 800);
    T.check('the Import view: Oracle\'s header, the list put aside, its own body', (await env.text('#eqmRwImport h1')) === 'Import from Fusion'
      && !(await page.isVisible('#eqmRedwood')) && await page.isVisible('#impFetch') && await page.isVisible('#impImport'));
    await env.shot('rw-equipment-import.png');
    await page.click('#eqmRwImport .oj-sp-header-general-overview-inflow-back-btn button');
    await page.waitForFunction(() => { const r = document.querySelector('#eqmRedwood'); return r && !r.hidden; }, null, { timeout: 10000 });
    T.check('back: the list, its filter kept', !(await page.isVisible('#impFetch')) && (await itemRows()).length === 2);

    T.section('Equipment master: a row opens the item, as on Current');
    await page.click('#eqmRwTable tbody tr:has-text("EQ-2201") .nx-rw-num');
    await waitTab(page, 'equipment-item:101');
    T.eq('the item in its own tab, named after it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'equipment-item:101=EQ-2201');

    T.section('Equipment item: Oracle\'s general overview page as the header, as Old\'s');
    await page.waitForSelector('#eqiRedwood oj-sp-general-overview-page.oj-complete', { timeout: 30000 });
    await page.waitForFunction(() => /CAT 320 Excavator/.test((document.querySelector('#eqiRedwood h1') || {}).innerText || '')
      && !!document.querySelector('#eqiFacts'), null, { timeout: 30000 });
    await settle(page, 1200);
    T.eq('the title', await env.text('#eqiRedwood h1'), 'CAT 320 Excavator');
    T.check('the subtitle: what it is', (await env.text('#eqiRedwood')).includes('Serial-tracked equipment · EQ-2201 · Excavators · Crawler · Caterpillar · 320 GC'));
    T.eq('its status: Oracle\'s badge', await page.$eval('#eqiRedwood oj-sp-header-general-overview', (h) => (h.badge && h.badge.text) + '/' + (h.badge && h.badge.status)), 'Active/success');
    T.check('the current head steps aside; the body stays', !(await page.isVisible('.nx-eqi .nx-pagehead')) && await page.isVisible('#eqiUnitsTile') && await page.isVisible('#eqiFacts'));
    await env.shot('rw-equipment-item.png');
    const ufile = await download(page, () => headerAction(page, '#eqiRedwood', 'Export the units'));
    T.check('a header action: Export the units, as Excel', /^equiprite-eq-2201-units-\d{4}-\d{2}-\d{2}\.xlsx$/.test(ufile), ufile);
    await headerAction(page, '#eqiRedwood', 'Change class');
    await page.waitForSelector('#eqiClassPanel', { timeout: 10000 });
    T.check('its primary action, Change class: the class panel (Current\'s chain)', await page.isVisible('#eqiClassPanel'));
    await page.click('#eqiClassPanel button[data-kind="close"]');
    await page.click('#eqiRedwood .oj-sp-header-general-overview-inflow-back-btn button');
    await waitTab(page, 'equipment');
    T.eq('back: the Equipment master', await activeTab(page), 'equipment');

    T.eq('no browser errors in Redwood', errorsOf(env).join(' | ').slice(0, 1500), '');

    T.section('Current: as it was, on the same filter');
    await env.setLook('current');
    await page.waitForSelector('.nx-eqm .nx-pagehead', { timeout: 15000 });
    T.check('the current Equipment master again', !(await page.isVisible('#eqmRedwood')) && await page.isVisible('.nx-grid--eqm'));
    T.eq('the Excavators chip is on: the same filter', await page.getAttribute('.nx-eqm-classes .nx-chip[data-value="1"]', 'aria-pressed'), 'true');
    T.eq('…its rows', await page.$$eval('.nx-grid--eqm .nx-row--click', (r) => r.map((x) => x.dataset.number).join()), 'EQ-2201,EQ-2202');
    T.eq('no browser errors', errorsOf(env).join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('Equipment master and item: run finished', false, String((e && e.stack) || e).slice(0, 1500));
    await env.shot('rw-equipment-master-failed.png').catch(() => {});
  } finally {
    await env.close();
  }
}

async function availability() {
  const env = await E.start({ port: PORT, handle: AV.handle, app: 'next' });
  const { page } = env;
  try {
    await env.open('/?open=availability');
    await page.waitForSelector('.nx-av-row--unit', { timeout: 30000 });
    await env.setLook('redwood');

    T.section('Availability: Oracle\'s header over its own timeline and grid, as Old\'s Equipment Schedule');
    await page.waitForSelector('#avRedwood oj-sp-general-overview-page.oj-complete', { timeout: 30000 });
    await settle(page, 1200);
    T.eq('the title', await env.text('#avRedwood h1'), 'Availability');
    const summary = await env.text('#avRedwood');
    T.check('the subtitle: the summary, as Current says it', summary.includes('5 units in 2 classes'), summary);
    T.check('the current head steps aside; the window, clashes, timeline stay', !(await page.isVisible('.nx-av .nx-pagehead'))
      && await page.isVisible('#avTimeline') && await page.isVisible('.nx-av-ask') && await page.isVisible('#avProblems'));
    T.check('the timeline as it is: its units and bars', (await page.$$eval('.nx-av-row--unit', (r) => r.length)) === 5 && (await page.$$eval('.nx-av-bar', (b) => b.length)) > 0);
    T.check('the header\'s colour runs on behind the top of the body', /linear-gradient\(rgb\(44, 82, 102\)/.test(await banner(page, '.nx-av')));
    await env.shot('rw-equipment-availability.png');
    const before = env.calls.filter((c) => /workbench-lines/.test(c)).length;
    await headerAction(page, '#avRedwood', 'Refresh');
    await page.waitForFunction(() => !/Refreshing/.test((document.querySelector('#avRedwood') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
    await settle(page, 1500);
    T.check('a header action: Refresh reads the bookings again', env.calls.filter((c) => /workbench-lines/.test(c)).length > before);
    const afile = await download(page, () => headerAction(page, '#avRedwood', 'Export to Excel'));
    T.check('…and Export to Excel: the bookings shown', /^equiprite-availability-\d{4}-\d{2}-\d{2}\.xlsx$/.test(afile), afile);
    await page.click('#avShowGrid');
    await page.waitForSelector('#avGrid', { timeout: 10000 });
    T.check('the yard grid under the same header', await page.isVisible('#avGrid') && await page.isVisible('#avRedwood'));
    await page.click('#avShowTimeline');
    T.eq('no browser errors in Redwood', errorsOf(env).join(' | ').slice(0, 1500), '');

    T.section('Current: as it was');
    await env.setLook('current');
    await page.waitForSelector('.nx-av .nx-pagehead', { timeout: 15000 });
    T.check('the current Availability again', !(await page.isVisible('#avRedwood')) && (await env.text('#avSummary')).includes('5 units in 2 classes'));
    T.eq('no browser errors', errorsOf(env).join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('Availability: run finished', false, String((e && e.stack) || e).slice(0, 1500));
    await env.shot('rw-equipment-availability-failed.png').catch(() => {});
  } finally {
    await env.close();
  }
}

(async () => {
  await fleetAnd360();
  await masterAndItem();
  await availability();
  T.report();
})();
