'use strict';
/*
 * EquipRite Next, Equipment master, in a real browser: the catalog found by number, name, class and serial (the
 * server's q joins the list's own matches), class chips and filters, sort, the map, export (the files are checked),
 * Sync from Fusion (asks first, then New's calls in New's order), the Import from Fusion view (review, tick, Import:
 * New's PATCH and promote; Fetch: New's ICS syncs and promote), an item in its own tab (units at a glance,
 * certificates, Fusion work orders, Change class with its version, read back), and a view-only role.
 * Needs `npm run build`. Run: node tests/e2e/next-equipment.e2e.js   (screenshots: the OS temp folder, equiprite-e2e)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const V1 = '/equiprite/v1';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Generators' }, { id: 4, className: 'Rollers' }];
const SUBCLASSES = [{ id: 11, subclassName: 'Crawler', eqrEquipmentClassId: 1 }, { id: 12, subclassName: 'Mini', eqrEquipmentClassId: 1 },
  { id: 41, subclassName: 'Vibratory', eqrEquipmentClassId: 4 }];
const LOCATIONS = [{ id: 501, locationName: 'Houston Yard', latitude: 29.76, longitude: -95.37 },
  { id: 502, locationName: 'Dallas Yard', latitude: 32.78, longitude: -96.8 }];
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
  { id: 105, equipmentNumber: 'EQ-5001', equipmentName: '=HYPERLINK("x") light tower', catalogStatus: 'ACTIVE', createdBy: 'admin' },
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
    categoryId: 1, categoryLabel: 'Load test', validityRequired: 'Y', validFromDate: day(-344), validToDate: day(21), createdBy: 'priya.raman', createdDate: '2026-01-10' },
  { id: 72, commonDocId: 901, entityName: 'EQR_EQUIPMENT_MASTER', attachmentName: 'Emissions', fileName: 'emissions.pdf', contentType: 'application/pdf',
    categoryId: 2, categoryLabel: 'Emissions', validityRequired: 'Y', validFromDate: day(-100), validToDate: day(200), createdBy: 'SYSTEM', createdDate: '2026-07-01' },
];
const state = { subclass101: 11, ovn101: 3 };

function serverSearch(q) {
  const s = String(q || '').toLowerCase();
  return EQUIPMENT.filter((r) => [r.equipmentName, r.equipmentType, r.manufacturer].some((v) => v && String(v).toLowerCase().includes(s))
    || (UNITS[r.id] || []).some((u) => u.serialNumber.toLowerCase().includes(s)));
}

function handle(req, res) {
  const p = req.path;
  const m = req.method;
  if (p === V1 + '/equipment-master' && m === 'GET') {
    const q = req.query.get('q');
    const rows = q ? serverSearch(q) : EQUIPMENT.map((r) => (r.id === 101 ? Object.assign({}, r, { equipmentSubclassId: state.subclass101 }) : r));
    return res.json({ data: rows, recordCount: rows.length, hasMore: false });
  }
  if (p === V1 + '/equipment-master/101') {
    if (m === 'PATCH') { const b = req.json(); state.subclass101 = b.equipmentSubclassId; state.ovn101 += 1; return res.json({}); }
    return res.json(Object.assign({}, EQUIPMENT[0], { equipmentSubclassId: state.subclass101, objectVersionNumber: state.ovn101, maintenanceAssetNumber: 'MA-1001',
      mfgYear: 2022, capacity: 20, capacityUom: 't', isMaintenanceTracked: 'Y', isFixedAssetTracked: 'N', isInventoryTracked: 'Y', lastUpdatedDate: '2026-10-28T06:15:00Z',
      equipmentDescription: 'Fitted with a quick coupler for 0.9 and 1.2 m3 buckets.' }));
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
  if (p.endsWith('/maintenanceWorkOrders')) {
    return res.json({ items: [{ WorkOrderNumber: 'WO-881', WorkOrderType: 'ORA_PREVENTIVE', WorkOrderStatus: 'ORA_RELEASED', AssetNumber: 'MA-1001',
      PlannedStartDate: day(3) + 'T08:00:00Z', PlannedCompletionDate: day(5) + 'T17:00:00Z', WorkOrderDescription: 'Replace hydraulic hose' }] });
  }
  if (p.endsWith('/itemClasses')) return res.json({ items: [{ ItemClassCode: 'HEAVY', ItemClass: 'Heavy equipment' }] });
  if (p.endsWith('/standardLookupsLOV')) return res.json({ items: [{ LookupCode: 'EQUIPMENT', Meaning: 'Equipment' }] });
  if (p === V1 + '/equipment-import/staging' && m === 'GET') return res.json({ items: STAGING, totalElements: STAGING.length });
  if (p === V1 + '/equipment-import/unmatched-values') return res.json({ items: [{ dimType: 'CATEGORY', dimValue: 'Power', itemCount: 7, reason: 'NO_MAPPING_MATCH' }], totalGroups: 1 });
  if (p === V1 + '/equipment-import/staging/assignments' && m === 'PATCH') return res.json({ updated: 1, failed: [] });
  if (p === V1 + '/equipment-import/promote') return res.json({ promoted: 1, autoMapped: 0 });
  if (p === V1 + '/fusion-sync/lock' && m === 'GET') return res.json({ held: false });
  if (p === V1 + '/fusion-sync/refresh-units') return res.json({ itemsChanged: 2, serials: 5, lots: 1, onhand: 4 });
  if (p.endsWith('/fusion-table-sync')) return res.json({ statusCode: 'SUCCESS', statusMsg: '', rowsMerged: '12', hasMoreData: 'N' });
  return undefined;
}

/** Writes in a line each: "PATCH /equipment-master/101", "POST ICS EQUIP_ITEM_REFRESH_SYNC/N". */
const w = (env) => env.writes.map((x) => x.method + ' ' + (x.path.endsWith('/fusion-table-sync')
  ? 'ICS ' + x.body.syncCode + '/' + x.body.fullSyncFlag : x.path.replace(V1, '')));

async function download(page, button, fmt) {
  await page.click(button);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.nx-menu-item[data-format="${fmt}"]`)]);
  const file = path.join(os.tmpdir(), 'next-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}

const rows = (page) => page.$$eval('.nx-grid--eqm .nx-row--click', (r) => r.map((x) => x.dataset.number).join());
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

(async () => {
  const env = await E.start({ port: 19350, handle, app: 'next' });
  const { page } = env;
  page.on('dialog', (d) => d.accept());
  let mark = 0;
  /** Each part checks the console on its own, so a failure names the part it came from. */
  const clean = (label) => { T.eq(label + ': no browser errors', env.errors.slice(mark).filter((e) => !e.startsWith('warning')).join('\n'), ''); mark = env.errors.length; };
  try {
    T.section('the catalog');
    await env.open('/?open=equipment');
    await page.waitForSelector('.nx-grid--eqm .nx-row--click', { timeout: 30000 });
    await page.waitForTimeout(600);
    T.eq('it opens in its own tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'equipment=Equipment master');
    T.eq('the summary: items and their units', await env.text('#eqmSummary'), '5 items · 6 serials · 4 on hand');
    T.eq('the latest Fetch and Sync, from the job log', await env.text('#eqmFusion'), 'Fetched from Fusion 28 Oct 2026 06:15 · synced 28 Oct 2026 06:15');
    T.eq('by name, A to Z', await rows(page), 'EQ-5001,EQ-2201,EQ-3101,EQ-2202,EQ-4001');
    T.eq('a row reads what it is and its units', await env.text('.nx-row--click[data-number="EQ-2201"]'),
      'CAT 320 Excavator EQ-2201 · Caterpillar 320 GC Excavators Crawler Serial 3 serials Houston Yard Active From Fusion');
    T.eq('no units, no class, no location: said so', await env.text('.nx-row--click[data-number="EQ-5001"]'),
      '=HYPERLINK("x") light tower EQ-5001 No class Quantity No units on record — Active Added in EquipRite');
    T.eq('class chips, the biggest first, with counts', await env.text('.nx-eqm-classes'), 'All classes 5 Excavators 2 Generators 1 Rollers 1 No class 1');
    T.check('Sync and Import from Fusion offered (full access), Import says what waits', (await page.isVisible('#eqmSync')) && (await env.text('#eqmImportView')).includes('2 to review'));
    await env.shot('next-equipment-list.png');

    T.section('find an item fast');
    await page.click('.nx-eqm-classes .nx-chip[data-value="1"]');
    await page.waitForTimeout(300);
    T.eq('a class narrows the list', await rows(page), 'EQ-2201,EQ-2202');
    T.eq('its subclasses, counted', await env.text('.nx-eqm-subclasses'), 'Any subclass 2 Crawler 2');
    T.eq('the summary says how many of all', await env.text('#eqmSummary'), '2 of 5 items · 4 serials');
    await page.click('.nx-eqm-classes .nx-chip[data-value=""]');
    await page.fill('#eqmSearch', 'eq-3101');
    await page.waitForTimeout(150);
    T.eq('by number, at once', await rows(page), 'EQ-3101');
    await page.fill('#eqmSearch', 'generators');
    await page.waitForTimeout(150);
    T.eq('by class name', await rows(page), 'EQ-3101');
    await page.fill('#eqmSearch', 'houston cat');
    await page.waitForTimeout(150);
    T.eq('every word somewhere: location and name', await rows(page), 'EQ-2201');
    await page.fill('#eqmSearch', 'CAT0320A2');
    await page.waitForSelector('.nx-eqm-why', { timeout: 10000 });
    T.eq('by serial: the server finds it', await rows(page), 'EQ-2201');
    T.eq('and the row says why', await env.text('.nx-eqm-why'), 'A serial number or unit location matches "CAT0320A2"');
    T.check('the search asked the server with q', env.calls.some((c) => c.includes('/equipment-master?') && c.includes('q=CAT0320A2')), env.calls.filter((c) => c.includes('q=')).join(' | '));
    await env.shot('next-equipment-serial-search.png');
    await page.fill('#eqmSearch', '');
    await page.waitForTimeout(400);
    await page.click('#eqmFilters');
    await page.waitForSelector('#eqmFilterPanel');
    T.eq('filters with counts', await env.text('#eqmFilterPanel'),
      'STATUS Any status 5 Active 4 Inactive 1 TRACKED BY Any tracking 5 Serial 3 Lot 1 Quantity 1 SOURCE Any source 5 From Fusion 3 Added in EquipRite 2 ASSET GROUP items with an active asset in it Earthmoving');
    await page.click('.nx-chip[data-field="status"][data-value="INACTIVE"]');
    await page.waitForTimeout(300);
    T.eq('Inactive', await rows(page), 'EQ-3101');
    T.check('the Filters button counts what is on', (await env.text('#eqmFilters')).includes('1 on'));
    await page.click('#eqmClear');
    await page.waitForTimeout(300);
    await page.click('#eqmFilters');
    await page.click('.nx-sort[data-key="units"]');
    await page.waitForTimeout(200);
    T.eq('sort by units: the most first', await rows(page), 'EQ-3101,EQ-2201,EQ-4001,EQ-2202,EQ-5001');
    await page.click('.nx-sort[data-key="name"]');
    await page.waitForTimeout(200);
    T.check('no sideways scroll on the list', await noSideways(page));
    clean('the catalog');

    T.section('export what is shown');
    const xl = await download(page, '#eqmExport', 'xlsx');
    T.check('Excel file name', /^equiprite-equipment-master-\d{4}-\d{2}-\d{2}\.xlsx$/.test(xl.name), xl.name);
    let read = '';
    try {
      read = execFileSync('python3', ['-I', '-c', 'import sys, openpyxl\nws = openpyxl.load_workbook(sys.argv[1]).active\nrows = list(ws.iter_rows(values_only=True))\nprint(len(rows)); print(rows[0]); print([r[0] for r in rows[1:]]); print(rows[2][7:10]); print(rows[1][1])', xl.file], { encoding: 'utf8' }).trim();
    } catch (e) { read = 'unavailable'; }
    if (read !== 'unavailable') {
      T.eq('the Excel rows: header + 5, the columns, numbers as numbers, a formula defused', read.split('\n').join(' | '),
        "6 | ('Number', 'Equipment', 'Class', 'Subclass', 'Type', 'Manufacturer and model', 'Tracking', 'Serial units', 'On hand', 'Location', 'Status', 'Source', 'Stored status') | ['EQ-5001', 'EQ-2201', 'EQ-3101', 'EQ-2202', 'EQ-4001'] | (3, '', 'Houston Yard') | '=HYPERLINK(\"x\") light tower");
    }
    await page.click('.nx-eqm-classes .nx-chip[data-value="1"]');
    await page.waitForTimeout(300);
    const csv = await download(page, '#eqmExport', 'csv');
    const text = fs.readFileSync(csv.file, 'utf8');
    T.check('CSV exports only what the class shows', text.split('\r\n').filter(Boolean).length === 3 && text.includes('EQ-2202') && !text.includes('EQ-3101'), text);
    await page.click('.nx-eqm-classes .nx-chip[data-value=""]');
    await page.waitForTimeout(200);
    clean('export');

    T.section('the map');
    await page.click('button[data-field="view"][data-value="map"]');
    await page.waitForSelector('.nx-eqm-dot');
    T.eq('a bubble per location with items', await page.$$eval('.nx-eqm-dot', (d) => d.map((x) => x.getAttribute('aria-label')).join(' | ')), 'Houston Yard · 2 items | Dallas Yard · 1 item');
    T.eq('what has no location is counted', await env.text('#eqmMapNote'), '3 items placed by their location · 2 with no location on record · pick a location to list its items');
    await page.click('.nx-eqm-dot[data-value="501"]');
    await page.waitForTimeout(300);
    T.eq('a location lists its items', await rows(page), 'EQ-2201,EQ-3101');
    T.eq('and shows as a chip', await env.text('#eqmLocationChip'), 'Houston Yard');
    await env.shot('next-equipment-map.png');
    T.check('no sideways scroll on the map', await noSideways(page));
    await page.click('#eqmLocationChip');
    await page.click('button[data-field="view"][data-value="list"]');
    await page.waitForTimeout(300);
    T.eq('browsing writes nothing', env.writes.length, 0);
    clean('the map');

    T.section('Sync from Fusion asks, then runs New\'s calls');
    await page.click('#eqmSync');
    await page.waitForSelector('.nx-eqm-ask');
    T.check('the card says what it will do, nothing sent yet', (await env.text('.nx-eqm-ask')).includes('never deleted') && env.writes.length === 0);
    await page.click('.nx-eqm-ask button[data-answer="ok"]');
    await page.waitForSelector('#eqmSyncResult', { timeout: 30000 });
    T.eq('items (delta), the three stock syncs and groups (full), then units',
      w(env).join(' > '), 'POST ICS EQUIP_ITEM_REFRESH_SYNC/N > POST ICS EQUIP_UNIT_SERIAL_SYNC/Y > POST ICS EQUIP_UNIT_LOT_SYNC/Y > POST ICS EQUIP_UNIT_ONHAND_SYNC/Y > POST ICS EQUIP_ASSET_GROUP_SYNC/Y > POST /fusion-sync/refresh-units');
    T.eq('one run: one start time on every call', new Set(env.writes.filter((x) => x.body && x.body.startTime).map((x) => x.body.startTime)).size, 1);
    T.eq('units marked gone only on a full stock read', JSON.stringify(env.writes[env.writes.length - 1].body), '{"snapshot":"Y"}');
    T.eq('the result stays on the page', await env.text('#eqmSyncResult'),
      'Sync complete 2 items updated · 10 unit records refreshed (serials 5, lots 1, on-hand 4). Dismiss');
    await env.shot('next-equipment-synced.png');
    clean('Sync from Fusion');

    T.section('Import from Fusion');
    env.writes.length = 0;
    await page.click('#eqmImportView');
    await page.waitForSelector('.nx-grid--stg .nx-row[data-item="EXC-330"]', { timeout: 30000 });
    await page.waitForTimeout(400);
    T.eq('the fetched rows, their status in words', await page.$$eval('.nx-grid--stg .nx-row[data-item] .nx-pill', (p) => p.map((x) => x.innerText.trim()).join()), 'Auto-mapped,Unmapped');
    T.check('the summary and what to map next', (await env.text('#impSummary')).includes('Showing 1–2 of 2') && (await env.text('#impUnmatched')).includes('What to map next'));
    T.check('the Fetch card does not show Sync\'s stock line as its own', !(await page.$('#impMessage')));
    await page.check('.nx-grid--stg input[data-index="0"]');
    await page.waitForTimeout(300);
    T.eq('Import says what it will add before the click', await env.text('#impPreview'), 'Import adds 1 item to the equipment master: 1 Excavators.');
    T.eq('the button counts it', await env.text('#impImport'), 'Import 1 item');
    await env.shot('next-equipment-import.png');
    T.check('no sideways scroll on the Import view', await noSideways(page));
    await page.click('#impImport');
    await page.waitForSelector('#impSaved', { timeout: 15000 });
    await page.waitForTimeout(600);
    T.eq('Import: PATCH the ticked class, then promote', w(env).join(' > '), 'PATCH /equipment-import/staging/assignments > POST /equipment-import/promote');
    T.eq('the ticked row and its class', JSON.stringify(env.writes[0].body), '{"assignments":[{"fusionInventoryItemId":9001,"resolvedClassId":1,"resolvedSubclassId":11}]}');
    T.eq('what happened, in words, on the page', await env.text('#impSaved'), '1 item confirmed. 1 added to the equipment master and removed from this list.');
    env.writes.length = 0;
    await page.click('#impFetch');
    await page.waitForSelector('.nx-eqm-msg--DONE', { timeout: 30000 });
    T.eq('Fetch: definitions (full), the stock syncs, then promote', w(env).join(' > '),
      'POST ICS EQUIP_ITEM_DEF_SYNC/Y > POST ICS EQUIP_UNIT_SERIAL_SYNC/Y > POST ICS EQUIP_UNIT_LOT_SYNC/Y > POST ICS EQUIP_UNIT_ONHAND_SYNC/Y > POST ICS EQUIP_ASSET_GROUP_SYNC/Y > POST /equipment-import/promote');
    T.check('its result stays on the page', (await env.text('#impMessage')).startsWith('12 Fusion item rows fetched.'), await env.text('#impMessage'));
    const ixl = await download(page, '#eqmExport', 'csv');
    T.check('the Import view exports its fetched items', fs.readFileSync(ixl.file, 'utf8').split('\r\n')[0].startsWith('﻿Item,Description,Status') && ixl.name.includes('equipment-from-fusion'));
    await page.click('button[data-field="view"][data-value="list"]');
    await page.waitForTimeout(300);
    clean('Import from Fusion');

    T.section('an item in its own tab');
    env.writes.length = 0;
    await page.click('.nx-row--click[data-number="EQ-2201"] .nx-eqm-title');
    await page.waitForSelector('#eqiTitle', { timeout: 20000 });
    await page.waitForSelector('#eqiDocs .nx-eqi-list li', { timeout: 20000 });
    await page.waitForTimeout(800);
    T.eq('it opens in a tab named after it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'equipment-item:101=EQ-2201');
    T.eq('what it is', [await env.text('.nx-eqi .nx-kicker'), await env.text('#eqiTitle'), await env.text('#eqiSub')].join(' | '),
      'SERIAL-TRACKED EQUIPMENT | CAT 320 Excavator Active | EQ-2201 · Excavators · Crawler · Caterpillar · 320 GC');
    T.eq('its units at a glance', await env.text('#eqiUnitsTile'), 'Serial units 3 1 available · 1 in maintenance · 1 rented out');
    T.eq('what can go out', await env.text('#eqiAvailableTile'), 'Available now 1 can go out on a request');
    T.eq('certificates: amber 30 days before expiry', await env.text('#eqiCertTile'), 'Certificates A certificate expires in 21 days 2 documents on file');
    T.eq('maintenance: open Fusion work orders', await env.text('#eqiWoTile'), 'Maintenance 1 open work order 1 maintenance asset on this item and its units');
    T.check('each unit in words, where it is', (await env.text('.nx-grid--units')).includes('CAT0320A2 TAG-88 Rented out Houston Yard · HOU-YARD 1')
      && (await env.text('.nx-grid--units')).includes('In service 1 Mar 2024'), await env.text('.nx-grid--units'));
    T.eq('a serial links to its page in Old', await page.getAttribute('.nx-row[data-unit="CAT0320A1"] a', 'href'),
      env.oldUrl + '/vp/shell/equipment-foundation/equipment-unit-detail?equipmentId=101&serialRefId=7&controlType=SERIAL');
    T.check('documents with their validity', (await env.text('#eqiDocs')).includes('Load test certificate Load test · valid to') && (await env.text('#eqiDocs')).includes('Expires in 21 days'));
    T.check('work orders read from Fusion', (await env.text('#eqiWo')).includes('WO-881 · PREVENTIVE') && (await env.text('#eqiWo')).includes('Released'));
    T.check('expenditure types', (await env.text('#eqiExp')).includes('Set on this equipment') && (await env.text('#eqiExp')).includes('Equipment Rental (default)'));
    T.check('the facts', (await env.text('#eqiFacts')).includes('TRACKED IN FUSION Maintenance, Inventory') && (await env.text('#eqiFacts')).includes('SOURCE Imported from Fusion'));
    T.eq('reading the item writes nothing', env.writes.length, 0);
    await page.fill('#eqiUnitSearch', 'rented');
    await page.waitForTimeout(200);
    T.eq('the units search', await page.$$eval('.nx-grid--units .nx-row[data-unit]', (r) => r.map((x) => x.dataset.unit).join()), 'CAT0320A2');
    const ucsv = await download(page, '#eqiExport', 'csv');
    T.check('export the units as shown', fs.readFileSync(ucsv.file, 'utf8').split('\r\n').filter(Boolean).length === 2 && ucsv.name.startsWith('equiprite-eq-2201-units'), ucsv.name);
    await page.fill('#eqiUnitSearch', '');
    await env.shot('next-equipment-item.png');
    T.check('no sideways scroll on the item', await noSideways(page));
    clean('the item');

    T.section('Change class: what it does first, then PATCH with its version, read back');
    await page.click('#eqiChangeClass');
    await page.waitForSelector('#eqiClassPanel .nx-chip[data-kind="subclass"]', { timeout: 15000 });
    T.check('nothing to save while it is the current class', await page.isDisabled('#eqiSaveClass'));
    await page.click('#eqiClassPanel .nx-chip[data-kind="subclass"][data-value="12"]');
    await page.waitForTimeout(200);
    T.eq('the consequence, before the click', await env.text('#eqiConsequence'),
      'EQ-2201 moves from Excavators · Crawler to Excavators · Mini. Its units stay as they are; expenditure types it inherits from its class or subclass follow the new one.');
    await env.shot('next-equipment-change-class.png');
    await page.click('#eqiSaveClass');
    await page.waitForFunction(() => !document.querySelector('#eqiClassPanel'), null, { timeout: 15000 });
    T.eq('one PATCH, with the version', w(env).join(' > ') + ' ' + JSON.stringify(env.writes[0] && env.writes[0].body),
      'PATCH /equipment-master/101 {"equipmentClassId":1,"equipmentSubclassId":12,"objectVersionNumber":3}');
    T.check('read back before it says so', env.calls.filter((c) => c.startsWith('GET ' + V1 + '/equipment-master/101')).length >= 2);
    T.eq('the new class on the page', await env.text('#eqiSub'), 'EQ-2201 · Excavators · Mini · Caterpillar · 320 GC');
    clean('Change class');

    await page.click('.nx-tab-btn[data-id="equipment"]');
    await page.waitForTimeout(300);
    T.check('back on the catalog, as it was left', (await page.isVisible('.nx-grid--eqm')) && (await rows(page)).split(',').length === 5);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-equipment-failed.png').catch(() => {});
  } finally {
    await env.close();
  }

  // ── A view-only role: the catalog and the item, no Sync, no Import, no Change class ──
  const access = Object.fromEntries(E.ALL_CODES.map((c) => [c, 'FULL']));
  access.EQR_EQUIPMENT_MASTER = 'READ_ONLY';
  const ro = await E.start({ port: 19353, handle, app: 'next', access });
  try {
    T.section('view only');
    await ro.open('/?open=equipment');
    await ro.page.waitForSelector('.nx-grid--eqm .nx-row--click', { timeout: 30000 });
    await ro.page.waitForTimeout(500);
    T.check('no Sync, no Import view', !(await ro.page.$('#eqmSync')) && !(await ro.page.$('#eqmImportView')));
    T.check('nothing asked of staging', !ro.calls.some((c) => c.includes('/equipment-import/')));
    await ro.open('/?open=equipment-item&id=101&number=EQ-2201');
    await ro.page.waitForSelector('#eqiTitle', { timeout: 20000 });
    await ro.page.waitForTimeout(500);
    T.check('the item opens from a link, without Change class', (await ro.text('#eqiTitle')).startsWith('CAT 320 Excavator') && !(await ro.page.$('#eqiChangeClass')));
    T.eq('view only writes nothing', ro.writes.length, 0);
    T.eq('view only: no browser errors', ro.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('view-only run finished', false, e.message);
    await ro.shot('next-equipment-readonly-failed.png').catch(() => {});
  } finally {
    await ro.close();
    T.report();
  }
})();
