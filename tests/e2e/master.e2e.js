'use strict';
/*
 * Master data in a real browser: Equipment (grid, map, Sync from Fusion), Import from Fusion, Equipment detail
 * (Change class), Rate schedules (edit a line, Save), Rental agreements (list, lines, Create request, Edit, Save).
 * Each page renders from the fake data below, each save sends the old chain's calls, and the console stays clean.
 * Needs `npm run build`. Run: node tests/e2e/master.e2e.js   (screenshots go to the OS temp folder, equiprite-e2e)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const V1 = '/equiprite/v1';

const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Generators' }, { id: 4, className: 'Rollers' }];
const SUBCLASSES = [{ id: 11, subclassName: 'Crawler', eqrEquipmentClassId: 1 }, { id: 12, subclassName: 'Mini', eqrEquipmentClassId: 1 },
  { id: 41, subclassName: 'Vibratory', eqrEquipmentClassId: 4 }];
const LOCATIONS = [{ id: 501, locationName: 'Houston Yard', latitude: 29.76, longitude: -95.37 },
  { id: 502, locationName: 'Dallas Yard', latitude: 32.78, longitude: -96.8 }];
const EQUIPMENT = [
  { id: 101, equipmentNumber: 'EQ-2201', equipmentName: 'CAT 320 Excavator', equipmentClassId: 1, equipmentSubclassId: 11, catalogStatus: 'ACTIVE',
    createdBy: 'FUSION_IMPORT', isSerialControlled: 'Y', isLotControlled: 'N', serialUnitCount: 3, currentLocationId: 501, objectVersionNumber: 3 },
  { id: 102, equipmentNumber: 'EQ-2202', equipmentName: 'Komatsu PC210', equipmentClassId: 1, equipmentSubclassId: 11, catalogStatus: 'ACTIVE',
    createdBy: 'admin', isSerialControlled: 'Y', serialUnitCount: 1, currentLocationId: 502 },
  { id: 103, equipmentNumber: 'EQ-3101', equipmentName: 'Generator 60 kVA', equipmentClassId: 2, catalogStatus: 'INACTIVE',
    createdBy: 'FUSION_IMPORT', isLotControlled: 'Y', onHandQty: 4, currentLocationId: 501 },
  { id: 104, equipmentNumber: 'EQ-4001', equipmentName: 'Vibratory roller CB2', equipmentClassId: 4, equipmentSubclassId: 41, catalogStatus: 'ACTIVE',
    createdBy: 'FUSION_IMPORT', isSerialControlled: 'Y', serialUnitCount: 2 },
];
const UNITS = [{ id: 7, serialNumber: 'CAT0320A1', unitStatus: 'AVAILABLE', currentLocationId: 501, invOrgId: 9, maintenanceAssetNumber: 'MA-1001' },
  { id: 8, serialNumber: 'CAT0320A2', unitStatus: 'RENTED', currentLocationId: 501, invOrgId: 9 },
  { id: 9, serialNumber: 'CAT0320A3', unitStatus: 'IN_MAINTENANCE', currentLocationId: 501, invOrgId: 9 }];
const STAGING = [
  { fusionInventoryItemId: 9001, itemNumber: 'EXC-330', itemDescription: 'CAT 330 Excavator', itemClassCode: 'HEAVY', categoryName: 'Excavators', importStatus: 'AUTO_MAPPED',
    resolvedClassId: 1, resolvedSubclassId: 11, serialNumControlCode: 2 },
  { fusionInventoryItemId: 9002, itemNumber: 'GEN-100', itemDescription: 'Generator 100 kVA', itemClassCode: 'HEAVY', categoryName: 'Power', importStatus: 'UNMAPPED',
    resolvedClassId: null, resolvedSubclassId: null, inventoryItemFlag: 'Y' },
];
const SCHEDULE = { id: 9, scheduleName: 'US Excavators 2026', scheduleCode: 'RS-US-EXC-2026', description: 'Base rates', currencyCode: 'USD',
  effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-12-31T00:00:00Z', isActiveFlag: 'Y', yardOrgId: 300, objectVersionNumber: 2 };
const RATE_LINES = [
  { id: 1, rateScheduleId: 9, periodSeq: 1, equipmentClassId: 1, equipmentClassName: 'Excavators', periodType: 'DAILY', rateUom: 'DAY', calcMethod: 'COMPLETE_PERIOD',
    calcBasis: 'DAILY', rateType: 'USAGE', fromUnit: 0, periodAmount: 880, costRate: 880, billRate: 1240, objectVersionNumber: 1 },
  { id: 2, rateScheduleId: 9, periodSeq: 2, equipmentClassId: 1, equipmentClassName: 'Excavators', periodType: 'WEEKLY', rateUom: 'WEEK', calcMethod: 'COMPLETE_PERIOD',
    calcBasis: 'WEEKLY', rateType: 'USAGE', fromUnit: 5, periodAmount: 3900, costRate: 557.1429, billRate: 4700, objectVersionNumber: 1 },
];
const AGREEMENTS = [
  { id: 31, agreementNumber: 'RNT-0002', agreementName: 'Lone Star MSA', customerName: 'Lone Star Paving', agreementType: 'RENTAL', status: 'ACTIVE',
    effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-12-15T00:00:00Z', lines: 2 },
  { id: 30, agreementNumber: 'RNT-0001', agreementName: 'Gulf pipeline 2025', customerName: 'Gulf Midstream', agreementType: 'RENTAL', status: 'EXPIRED',
    effectiveFrom: '2025-01-01T00:00:00Z', effectiveTo: '2025-12-31T00:00:00Z', lines: 4 },
  { id: 32, agreementNumber: 'ST-0001', agreementName: 'Short term trench kit', customerName: 'Acme Utilities', agreementType: 'SHORT_TERM', status: 'DRAFT',
    effectiveFrom: '2026-11-01T00:00:00Z', effectiveTo: '2027-01-31T00:00:00Z', lines: 0 },
];
const HEADER = { id: 31, agreementNumber: 'RNT-0002', agreementName: 'Lone Star MSA', agreementType: 'RENTAL', status: 'ACTIVE', fusionCustomerId: 900,
  customerRefId: null, projectRefId: null, equipmentClassId: null, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-12-15T00:00:00Z',
  currencyCode: 'USD', notes: 'Minimum one week', objectVersionNumber: 4 };
const VIEW_LINES = [
  { lineNumber: 1, equipmentName: 'CAT 320 Excavator', className: 'Excavators', subClassName: 'Crawler', qty: 1, billRate: 1050, priceUom: 'DAY', estCost: 0, totalAgreementCost: 0 },
  { lineNumber: 2, equipmentName: '', description: 'Any vibratory roller', className: 'Rollers', subClassName: 'Vibratory', qty: 1, billRate: 720, priceUom: 'DAY' },
];
const RAW_LINES = [
  { id: 11, agreementHeaderId: 31, lineNumber: 1, equipmentClassId: 1, equipmentMasterId: 101, unitPrice: 1050, priceUom: 'DAY', description: '' },
  { id: 12, agreementHeaderId: 31, lineNumber: 2, equipmentClassId: 4, equipmentMasterId: null, unitPrice: 720, priceUom: 'DAY', description: 'Any vibratory roller' },
];

const state = { subclass101: 11, ovn101: 3 };
const ICS = '/fusion-table-sync';

function handle(req, res) {
  const p = req.path;
  const m = req.method;
  // Equipment
  if (p === V1 + '/equipment-master' && m === 'GET') {
    const cls = req.query.get('equipmentClassId');
    const rows = EQUIPMENT.filter((r) => !cls || String(r.equipmentClassId) === cls);
    return res.json({ data: rows, recordCount: rows.length, hasMore: false });
  }
  if (p === V1 + '/equipment-master/101') {
    if (m === 'PATCH') { const b = req.json(); state.subclass101 = b.equipmentSubclassId; state.ovn101 += 1; return res.json({}); }
    return res.json(Object.assign({}, EQUIPMENT[0], { equipmentSubclassId: state.subclass101, objectVersionNumber: state.ovn101,
      manufacturer: 'Caterpillar', model: '320 GC', maintenanceAssetNumber: 'MA-1001' }));
  }
  if (p === V1 + '/equipment-classes') return res.json({ data: CLASSES, hasMore: false });
  if (/\/equipment-classes\/\d+$/.test(p)) return res.json(CLASSES.find((c) => p.endsWith('/' + c.id)) || {});
  if (/\/equipment-classes\/\d+\/subclasses\/\d+$/.test(p)) return res.json(SUBCLASSES.find((s) => p.endsWith('/' + s.id)) || {});
  if (/\/equipment-classes\/\d+\/subclasses$/.test(p)) {
    const cls = Number(p.split('/').slice(-2)[0]);
    return res.json({ data: SUBCLASSES.filter((s) => s.eqrEquipmentClassId === cls), hasMore: false });
  }
  if (p === V1 + '/subclasses') return res.json({ data: SUBCLASSES, hasMore: false });
  if (p === V1 + '/asset-groups') return res.json({ data: [{ id: 7, groupName: 'Earthmoving' }], hasMore: false });
  if (p === V1 + '/locations') return res.json({ data: LOCATIONS });
  if (/\/locations\/\d+$/.test(p)) return res.json(LOCATIONS.find((l) => p.endsWith('/' + l.id)) || {});
  if (p === V1 + '/inv-orgs') return res.json({ data: [{ invOrgId: 9, organizationName: 'HOU-YARD' }] });
  if (p === V1 + '/job-run-logs') return res.json({ data: [{ jobName: req.query.get('jobName'), startedAt: '2026-10-28T06:15:00Z' }] });
  if (p === V1 + '/serial-refs') return res.json({ data: UNITS });
  if (p === V1 + '/equipment-import/staging' && m === 'GET') return res.json({ items: STAGING, totalElements: STAGING.length });
  if (p === V1 + '/equipment-import/staging/assignments' && m === 'PATCH') return res.json({ updated: 1, failed: [] });
  if (p === V1 + '/equipment-import/promote') return res.json({ promoted: 1, autoMapped: 0 });
  if (p === V1 + '/fusion-sync/lock' && m === 'GET') return res.json({ held: false });
  if (p === V1 + '/fusion-sync/refresh-units') return res.json({ itemsChanged: 2, serials: 5, lots: 1, onhand: 4 });
  if (p.endsWith(ICS)) return res.json({ statusCode: 'SUCCESS', statusMsg: '', rowsMerged: '12', hasMoreData: 'N' });
  // Rates
  if (p === V1 + '/rate-schedules' && m === 'GET') return res.json({ data: [SCHEDULE, Object.assign({}, SCHEDULE,
    { id: 10, scheduleName: 'Default fallback', isActiveFlag: 'N', yardOrgId: null })] });
  if (p === V1 + '/rate-schedules/9') return m === 'GET' ? res.json(SCHEDULE) : res.json({ id: 9 });
  if (p === V1 + '/rate-period-lines' && m === 'GET') return res.json({ data: RATE_LINES });
  if (/\/rate-period-lines\/\d+$/.test(p)) return res.json({ id: Number(p.split('/').pop()) });
  if (p === V1 + '/bu-org-mappings') return res.json({ data: [{ orgRole: 'EQUIPMENT_YARD', invOrgId: 300, invOrgName: 'Houston Yard', businessUnitId: 1 }] });
  // Agreements
  if (p === V1 + '/views/rental-agreements') return res.json({ data: AGREEMENTS });
  if (p === V1 + '/agreement-headers' && m === 'GET') return res.json(HEADER);
  if (p === V1 + '/agreement-headers/31') return m === 'GET' ? res.json(HEADER) : res.json(Object.assign({}, HEADER, req.json()));
  if (p === V1 + '/views/rental-agreement-lines') return res.json({ data: VIEW_LINES });
  if (p === V1 + '/agreement-lines' && m === 'GET') return res.json({ data: RAW_LINES });
  if (/\/agreement-lines\/\d+$/.test(p)) return res.json({});
  if (p === V1 + '/conf-agreement-types') return res.json([{ typeCode: 'RENTAL', typeLabel: 'Rental', typePrefix: 'RNT' },
    { typeCode: 'SHORT_TERM', typeLabel: 'Short term', typePrefix: 'ST' }]);
  if (p.endsWith('/shippingCustomersLOV')) return res.json({ items: [{ CustomerId: 900, Customer: 'Lone Star Paving' }] });
  return undefined;
}

const w = (env) => env.writes.map((x) => x.method + ' ' + x.path.replace(V1, '').replace(/^.*\/fusion-table-sync$/, 'ICS fusion-table-sync'));

(async () => {
  const env = await E.start({ port: 19150, handle });
  const { page } = env;
  page.on('dialog', (d) => d.accept());
  const shots = [];
  let mark = 0;
  /** Each section checks the console on its own, so a failure names the screen it came from. */
  const clean = (label) => { T.eq(label + ': no browser errors or warnings', env.errors.slice(mark).join('\n'), ''); mark = env.errors.length; };
  try {
    T.section('Equipment: grid, chips, map');
    await env.open('/vp/shell/master/equipment');
    await page.waitForSelector('#equipmentTable >> text=CAT 320 Excavator', { timeout: 30000 });
    T.check('the band counts the list and shows the last Sync', /4 items/.test(await env.text('.er-band')) && /last Sync 28 Oct 2026/.test(await env.text('.er-band')),
      await env.text('.er-band-sub'));
    T.check('status chips with counts', (await env.text('.er-page')).includes('Active 3'));
    T.check('Import from Fusion says what waits for review', (await env.text('#importBtn')).includes('2 to review'));
    T.check('the Equipment menu item is on', (await env.text('.er-nav-item--on, .er-nav-item.oj-selected, [aria-current="page"]').catch(() => '')).includes('Equipment')
      || (await page.$$eval('.er-nav-item', (els) => els.some((e) => /Equipment/.test(e.textContent) && /on|selected|current/.test(e.className + (e.getAttribute('aria-current') || ''))))));
    await page.click('button[data-kind="status"][data-value="INACTIVE"]');
    await page.waitForTimeout(400);
    T.check('a chip narrows the grid', /1 of 4 items/.test(await env.text('.er-band-sub')));
    await page.click('button[data-kind="clear"]');
    await page.waitForTimeout(300);
    shots.push(await env.shot('master-equipment-grid.png'));
    await page.click('button[data-kind="view"][data-value="map"]');
    await page.waitForSelector('.er-map-dot');
    T.eq('the map has a bubble per location with items', await page.$$eval('.er-map-dot', (d) => d.length), 2);
    T.check('items with no location are counted', (await env.text('#mapTitle + .er-note, .er-table-head .er-note')).includes('1 with no location'));
    await page.click('.er-map-dot[data-value="501"]');
    await page.waitForTimeout(400);
    T.check('a location lists its items', /2 of 4 items/.test(await env.text('.er-band-sub')));
    shots.push(await env.shot('master-equipment-map.png'));
    await page.click('button[data-kind="clear"]');
    await page.click('button[data-kind="view"][data-value="grid"]');

    clean('Equipment grid and map');

    T.section('Equipment: Sync from Fusion asks, then runs the old chain');
    env.writes.length = 0;
    await page.click('#syncBtn');
    await page.waitForSelector('.er-ask');
    T.check('the page asks first, nothing sent', (await env.text('.er-ask')).includes('Sync') && env.writes.length === 0);
    await page.click('.er-ask button[data-answer="ok"]');
    await page.waitForSelector('.er-result-note', { timeout: 30000 });
    const sw = w(env);
    T.eq('items first, then stock (lots, serials, on hand), then units', sw[0] + ' ... ' + sw[sw.length - 1], 'POST ICS fusion-table-sync ... POST /fusion-sync/refresh-units');
    T.eq('item stage on the refresh row, DELTA', env.writes[0].body.syncCode + '/' + env.writes[0].body.fullSyncFlag, 'EQUIP_ITEM_REFRESH_SYNC/N');
    T.eq('full snapshot when stock was complete', env.writes[env.writes.length - 1].body.snapshot, 'Y');
    T.check('the result stays on the page', (await env.text('.er-result-note')).length > 10, await env.text('.er-result-note'));
    shots.push(await env.shot('master-equipment-synced.png'));

    clean('Sync from Fusion');

    T.section('Import from Fusion: review and Import');
    await env.open('/vp/shell/master/equipment-import');
    await page.waitForSelector('input[type="checkbox"][data-index="0"]', { timeout: 30000 });
    T.check('the fetched rows are listed', (await env.text('.er-page')).includes('CAT 330 Excavator') && (await env.text('.er-page')).includes('Generator 100 kVA'));
    env.writes.length = 0;
    await page.check('input[type="checkbox"][data-index="0"]');
    await page.waitForTimeout(300);
    T.check('the preview says what Import adds', (await env.text('.er-page')).includes('Import adds 1 item to the equipment master: 1 Excavators.'));
    shots.push(await env.shot('master-equipment-import.png'));
    await page.click('#importRowsBtn');
    await page.waitForTimeout(1500);
    T.eq('Import: PATCH the class assignments, then promote', w(env).join(' > '), 'PATCH /equipment-import/staging/assignments > POST /equipment-import/promote');
    T.eq('the ticked row and its class', JSON.stringify(env.writes[0].body), '{"assignments":[{"fusionInventoryItemId":9001,"resolvedClassId":1,"resolvedSubclassId":11}]}');

    clean('Import from Fusion');

    T.section('Equipment detail: Change class');
    await env.open('/vp/shell/master/equipment-detail?equipmentId=101');
    await page.waitForSelector('#changeClassBtn', { timeout: 30000 });
    await page.waitForTimeout(800);
    const det = await env.text('.er-page');
    T.check('the detail shows the item, its class and its units', det.includes('Excavators') && det.includes('Crawler') && det.includes('CAT0320A1') && det.includes('Houston Yard'), det.slice(0, 300));
    shots.push(await env.shot('master-equipment-detail.png'));
    env.writes.length = 0;
    await page.click('#changeClassBtn');
    await page.waitForSelector('button[data-kind="subclass"][data-value="12"]');
    await page.click('button[data-kind="subclass"][data-value="12"]');
    await page.waitForTimeout(300);
    T.check('the consequence is shown before saving', (await env.text('.er-page')).includes('moves from Excavators · Crawler to Excavators · Mini'));
    shots.push(await env.shot('master-equipment-change-class.png'));
    await page.click('#saveClassBtn');
    await page.waitForTimeout(1500);
    T.eq('Save: one PATCH', w(env).join(' > '), 'PATCH /equipment-master/101');
    T.eq('PATCH body: both ids and the version', JSON.stringify(env.writes[0].body), '{"equipmentClassId":1,"equipmentSubclassId":12,"objectVersionNumber":3}');
    T.check('then read back (GET after the PATCH)', env.calls.slice(env.calls.lastIndexOf(env.calls.find((c) => c.startsWith('PATCH ')))).some((c) => c.startsWith('GET ' + V1 + '/equipment-master/101')));
    T.check('the card shows the new subclass', (await env.text('.er-page')).includes('Mini'));

    clean('Equipment detail');

    T.section('Rate schedules: grid, margin, simulator, Save');
    await env.open('/vp/shell/master/rates');
    await page.waitForSelector('input[data-key="id:2"][data-field="billRate"]', { timeout: 30000 });
    await page.waitForTimeout(500);
    const rt = await env.text('.er-page');
    T.check('the list and the open schedule', rt.includes('US Excavators 2026') && rt.includes('Default fallback') && rt.includes('Houston Yard'));
    T.check('the simulator prices 14 days on the Weekly tier', rt.includes('14 days on rent reach the Weekly tier'), rt.slice(rt.indexOf('Try it'), rt.indexOf('Try it') + 400));
    env.writes.length = 0;
    await page.fill('input[data-key="id:2"][data-field="billRate"]', '3800');
    await page.dispatchEvent('input[data-key="id:2"][data-field="billRate"]', 'change');
    await page.waitForTimeout(400);
    T.check('the margin check flags bill below cost before saving', (await env.text('.er-page')).includes('bill $3,800 is below cost $3,900'));
    T.eq('nothing sent while editing', env.writes.length, 0);
    shots.push(await env.shot('master-rates.png'));
    await page.click('#saveScheduleBtn');
    await page.waitForTimeout(2000);
    T.eq('Save: header PUT, then every line PUT (the old chain)', w(env).join(' > '), 'PUT /rate-schedules/9 > PUT /rate-period-lines/1 > PUT /rate-period-lines/2');
    const lb = env.writes[2].body;
    T.eq('the edited line: bill 3,800, total and cost kept', [lb.billRate, lb.rateAmount, lb.periodAmount, lb.costRate, lb.periodType, lb.fromUnit].join('|'), '3800|3800|3900|557.1429|WEEKLY|5');
    T.eq('the header keeps its yard and code', env.writes[0].body.yardOrgId + '|' + env.writes[0].body.scheduleCode, '300|RS-US-EXC-2026');

    clean('Rate schedules');

    T.section('Rental agreements: list, lines, Create request');
    await env.open('/vp/shell/master/agreements');
    await page.waitForSelector('#agreementsTable >> text=Lone Star MSA', { timeout: 30000 });
    T.check('chips by status with ending soon', (await env.text('.er-page')).includes('Ending soon'));
    shots.push(await env.shot('master-agreements.png'));
    await page.click('#agreementsTable >> text=Lone Star MSA');
    await page.waitForSelector('input[type="checkbox"][data-key="RNT-0002:1"]', { timeout: 30000 });
    await page.waitForTimeout(500);
    const al = await env.text('.er-page');
    T.check('the lines page: customer and lines', (await env.text('.er-band')).includes('Lone Star Paving') && al.includes('Any vibratory roller'));
    await page.check('input[type="checkbox"][data-key="all"]');
    await page.waitForTimeout(300);
    T.check('the hand-over is said before going', (await env.text('.er-page')).includes('2 lines go to New request at this agreement\'s rates.'));
    shots.push(await env.shot('master-agreement-lines.png'));
    env.writes.length = 0;
    const before = env.calls.length;
    await page.click('#createRequestBtn');
    await page.waitForURL(/request\/new-request/, { timeout: 20000 });
    await page.waitForTimeout(800);
    T.check('class-only line resolved to equipment of its class', env.calls.slice(before).some((c) => c.includes('/equipment-master?') && c.includes('equipmentClassId=4')));
    T.eq('nothing written by the hand-over', env.writes.length, 0);
    const handed = await page.evaluate(() => [
      sessionStorage.getItem('eqr.agreement.active'),
      JSON.parse(localStorage.getItem('eqr.draft.CartItemsArray') || '[]').map((i) => i.id + ':' + i.billingRate).join(','),
      localStorage.getItem('eqr.draft.fromAgreementId'),
      localStorage.getItem('eqr.draft.agreementLineIdByEquipmentId'),
    ].join(' | '));
    T.eq('handed over as the old app did: tab flag, cart at the agreement rates, agreement id, line ids', handed,
      '1 | 101:1050,104:720 | 31 | {"101":11,"104":12}');

    clean('Rental agreements');

    T.section('Agreement edit: Save');
    await env.open('/vp/shell/master/agreement-edit?agreementId=31');
    await page.waitForSelector('input[data-action="lineField"][data-field="unitPrice"][data-index="1"]', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.check('header and lines from the agreement', (await page.inputValue('#agreementName')) === 'Lone Star MSA' && (await env.text('.er-page')).includes('Lone Star Paving'));
    T.eq('the saved notes show', await page.$eval('#agreementNotes textarea', (t) => t.value), 'Minimum one week');
    T.check('opening the page does not count as a change', !(await env.text('.er-page')).includes('Not saved yet'));
    env.writes.length = 0;
    await page.fill('input[data-action="lineField"][data-field="unitPrice"][data-index="1"]', '990');
    await page.dispatchEvent('input[data-action="lineField"][data-field="unitPrice"][data-index="1"]', 'change');
    await page.waitForTimeout(300);
    shots.push(await env.shot('master-agreement-edit.png'));
    await page.click('#saveAgreementBtn');
    await page.waitForURL(/agreement-lines/, { timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('Save: PUT header, PATCH each kept line', w(env).join(' > '), 'PUT /agreement-headers/31 > PATCH /agreement-lines/11 > PATCH /agreement-lines/12');
    T.eq('PUT carries the loaded header\'s number, status and version', [env.writes[0].body.agreementNumber, env.writes[0].body.status, env.writes[0].body.objectVersionNumber].join('|'), 'RNT-0002|ACTIVE|4');
    T.eq('the edited rate', env.writes[1].body.unitPrice, 990);
    T.eq('the notes kept', env.writes[0].body.notes, 'Minimum one week');
    T.check('then the agreement\'s lines open', page.url().includes('agreementNumber=RNT-0002'));

    clean('Agreement edit');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('master-failed.png').catch(() => {});
    console.log(env.errors.join('\n'));
  } finally {
    await env.close();
    console.log('screenshots:\n  ' + shots.join('\n  '));
    T.report();
  }
})();
