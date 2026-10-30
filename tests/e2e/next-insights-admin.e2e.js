'use strict';
/*
 * EquipRite Next, Analytics and Admin (Settings, Access, Integrations), in a real browser against fake data:
 *   - Analytics: each question's sentence, tiles, charts and table from the views New and Old EquipRite read; a bar
 *     clicked is a filter; the utilization period sends New's window; export files; a late row opens its request
 *   - Settings: what each switch does and what saving changes, the guards (one module stays on, PPM needs timesheets),
 *     Save sends New's PATCH / POST, a business unit saves New's PATCH
 *   - Access: the role by page matrix, locked rows, the consequence before saving, one PUT per role as New sends it
 *   - Integrations: what is down, since when, what failed, what to do; nothing written (re-running is New's)
 *   - no sideways scroll, no browser errors; screenshots
 * Needs `npm run build`. Run: node tests/e2e/next-insights-admin.e2e.js   (screenshots go to the OS temp folder)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const PORT = 19380;
const NOW = Date.now();
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const ago = (min) => new Date(NOW - min * 60000).toISOString();

// ── Analytics data ────────────────────────────────────────────────────────────────────────────────────────
const STOCK = [
  { className: 'Excavators', equipmentName: 'CAT 320', unitNumber: 'EX-101', unitType: 'SERIAL', assetNumber: 'A-1', invOrgName: 'Atlanta', invOrgId: 300000047274447, unitStatus: 'AVAILABLE' },
  { className: 'Excavators', equipmentName: 'CAT 320', unitNumber: 'EX-102', unitType: 'SERIAL', assetNumber: 'A-2', invOrgName: 'Atlanta', invOrgId: 300000047274447, unitStatus: 'RENTED', projectName: 'Pipeline North', currentStartDate: day(-30) + 'T00:00:00Z', currentEndDate: day(-4) + 'T00:00:00Z' },
  { className: 'Excavators', equipmentName: 'CAT 336', unitNumber: 'EX-103', unitType: 'SERIAL', assetNumber: 'A-5', invOrgName: 'Houston', invOrgId: 300000047274448, unitStatus: 'RENTED', projectName: 'Plant B', currentStartDate: day(-3) + 'T00:00:00Z', currentEndDate: day(20) + 'T00:00:00Z' },
  { className: 'Cranes', equipmentName: 'Grove RT', unitNumber: 'CR-7', unitType: 'SERIAL', assetNumber: 'A-3', invOrgName: 'Houston', invOrgId: 300000047274448, unitStatus: 'AVAILABLE' },
  { className: 'Cranes', equipmentName: 'Grove RT', unitNumber: 'CR-8', unitType: 'SERIAL', assetNumber: 'A-4', invOrgName: 'Houston', invOrgId: 300000047274448, unitStatus: 'IN_MAINTENANCE' },
];
const UTIL = [
  { yardName: 'Atlanta', dayDate: day(-2), monthLabel: 'Oct 2026', fleetSize: 10, deployedUnits: 6, utilPercent: 60, usedHours: 48 },
  { yardName: 'Houston', dayDate: day(-2), monthLabel: 'Oct 2026', fleetSize: 8, deployedUnits: 2, utilPercent: 25, usedHours: 16 },
  { yardName: 'Atlanta', dayDate: day(-1), monthLabel: 'Oct 2026', fleetSize: 10, deployedUnits: 7, utilPercent: 70, usedHours: 56 },
  { yardName: 'Houston', dayDate: day(-1), monthLabel: 'Oct 2026', fleetSize: 8, deployedUnits: 4, utilPercent: 50, usedHours: 32 },
];
const REQS = [
  { eqrEquipmentRequestId: 1764, requestNumber: 'REQ-1764', status: 'IN_PROCESS', startDate: day(-40), endDate: day(-6), projectName: 'Pipeline North', requestorName: 'User Rite', requestOrigin: 'Internal' },
  { eqrEquipmentRequestId: 1765, requestNumber: 'REQ-1765', status: 'IN_PROCESS', startDate: day(-3), endDate: day(30), projectName: 'Plant B', requestorName: 'Rite.User', requestOrigin: 'Internal' },
  { eqrEquipmentRequestId: 1766, requestNumber: 'REQ-1766', status: 'SUBMITTED', startDate: day(12), endDate: day(20), customerName: 'Lone Star Paving', requestorName: 'Dana Cole', requestOrigin: 'External' },
  { eqrEquipmentRequestId: 1767, requestNumber: 'REQ-1767', status: 'IN_PROCESS', startDate: day(-70), endDate: day(-50), projectName: 'Harbor Wall', requestorName: 'User Rite', requestOrigin: 'Internal' },
];
const LINES = [
  { requestNumber: 'REQ-1764', lineNumber: 1, equipmentName: 'Komatsu D65EX Dozer', className: 'Earthmoving', qty: 1, lineStatus: 'DEPLOYED', allocationStatus: 'ALLOCATED', allocatedSerialNumber: 'KD-0018', deploymentLocation: 'Pier A' },
  { requestNumber: 'REQ-1764', lineNumber: 2, equipmentName: 'Bobcat S76', className: 'Earthmoving', qty: 1, lineStatus: 'RETURNED' },
  { requestNumber: 'REQ-1765', lineNumber: 1, equipmentName: 'CAT 320 Excavator', className: 'Excavators', qty: 1, lineStatus: 'ALLOCATED', allocationStatus: 'ALLOCATED' },
  { requestNumber: 'REQ-1766', lineNumber: 1, equipmentName: 'Light Tower', className: 'Lighting', qty: 4, lineStatus: 'SUBMITTED' },
  { requestNumber: 'REQ-1767', lineNumber: 1, equipmentName: 'Generator 100kVA', className: 'Power', qty: 1, lineStatus: 'CLOSED' },
];
const COST = [
  { requestNumber: 'REQ-1764', lineNumber: 1, equipmentNumber: 'EQ-01', equipmentName: 'Komatsu D65EX Dozer', projectNumber: 'P-100', projectName: 'Pipeline North', yardLocation: 'Atlanta', cost: 1200, quantity: 10, totalCost: 12000, postedStatus: 'POSTED', postedDate: day(-10) },
  { requestNumber: 'REQ-1764', lineNumber: 2, equipmentNumber: 'EQ-02', equipmentName: 'Bobcat S76', projectNumber: 'P-100', projectName: 'Pipeline North', yardLocation: 'Atlanta', cost: 400, quantity: 5, totalCost: 2000, postedStatus: 'UNPOSTED' },
  { requestNumber: 'REQ-1765', lineNumber: 1, equipmentNumber: 'EQ-03', equipmentName: 'CAT 320 Excavator', projectNumber: 'P-200', projectName: 'Plant B', yardLocation: 'Houston', cost: 900, quantity: 3, totalCost: 2700, postedStatus: 'UNPOSTED' },
];
const groupsOf = (rows, field) => {
  const m = {};
  rows.forEach((r) => { const k = r[field]; m[k] = m[k] || { groupKey: k, count: 0 }; m[k].count++; });
  return Object.values(m);
};

// ── Settings data: a little store, so a save is read back ────────────────────────────────────────────────────
const SETTINGS = [
  { id: 1, settingKey: 'PROJECTS_MODULE_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 2, settingKey: 'CUSTOMERS_MODULE_ENABLED', settingValue: 'false', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 3, settingKey: 'AGREEMENTS_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 4, settingKey: 'TIMESHEETS_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 5, settingKey: 'PPM_RATES_ENABLED', settingValue: 'false', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 6, settingKey: 'ENABLE_QUOTES', settingValue: 'CUSTOMER', settingCategory: 'SYSTEM', isActiveFlag: 'Y' },
  { id: 7, settingKey: 'WEEK_CONFIG_ENABLED', settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' },
  { id: 8, settingKey: 'WEEK_END_DAY', settingValue: 'FRIDAY', settingCategory: 'SYSTEM', isActiveFlag: 'Y' },
  { id: 9, settingKey: 'EMAIL_NOTIFICATIONS_ENABLED', settingValue: 'true', settingCategory: 'NOTIFICATION', isActiveFlag: 'Y' },
];
const BU_ROWS = [
  { id: 501, businessUnitId: 300000046987012, businessUnitName: 'US1 BU (stored)', rateSource: 'EQUIPRITE_RATES', ppmTransSource: 'EQUIPRITE', ppmBatchPrefix: 'EQRP-HOU',
    marginPercentage: 0, passProcurementCost: 'N', adhocTimesheetEnabled: 'Y', isActiveFlag: 'Y' },
];
const FUSION_BU = { BusinessUnitId: 300000046987012, BusinessUnitName: 'US1 Business Unit', PrimaryLedgerId: '300000046975971', LocationId: 1234, ManagerId: null, LegalEntityId: '300000046974641' };
const AUDIT = [
  { timestamp: '2026-10-28 14:02', modifiedBy: 'priya.raman', section: 'Feature Flags', field: 'AGREEMENTS_ENABLED', oldValue: 'false', newValue: 'true' },
  { timestamp: '2026-10-20 09:15', modifiedBy: 'sam.ortiz', section: 'BU Settings', field: 'RATE_SOURCE', oldValue: 'PPM_RATES', newValue: 'EQUIPRITE_RATES' },
];

// ── Access data: two active roles and an inactive one; the matrix is a store so a save is read back ──────────
const ROLES = [
  { appRoleId: 1, roleCode: 'ADMIN', roleName: 'Administrator', isActive: 'Y' },
  { appRoleId: 2, roleCode: 'EQUIP_MANAGER', roleName: 'Equipment manager', isActive: 'Y' },
  { appRoleId: 3, roleCode: 'RETIRED', roleName: 'Retired role', isActive: 'N' },
];
const matrix = {};
[1, 2].forEach((id) => {
  matrix[id] = [
    { pageCode: 'EQR_DASHBOARD', pageLabel: 'Dashboard', moduleCode: 'PROJECT_REQUESTOR', sortOrder: 1, accessLevel: 'FULL', isLocked: 'N' },
    { pageCode: 'EQR_WORKBENCH', pageLabel: 'Workbench', moduleCode: 'EQUIP_MANAGER', sortOrder: 10, accessLevel: 'FULL', isLocked: 'N' },
    { pageCode: 'EQR_EQUIPMENT_MASTER', pageLabel: 'Equipment master', moduleCode: 'EQUIP_MANAGER', sortOrder: 11, accessLevel: 'READ_ONLY', isLocked: 'N' },
    { pageCode: 'EQR_ANALYTICS', pageLabel: 'Equipment analytics', moduleCode: 'ANALYTICS', sortOrder: 20, accessLevel: 'FULL', isLocked: 'N' },
    { pageCode: 'EQR_REPORTS', pageLabel: 'Equipment reports', moduleCode: 'ANALYTICS', sortOrder: 21, accessLevel: 'HIDDEN', isLocked: 'N' },
    { pageCode: 'EQR_RBAC_ADMIN', pageLabel: 'Page access', moduleCode: 'ADMINISTRATOR', sortOrder: 30, accessLevel: id === 1 ? 'FULL' : 'HIDDEN', isLocked: id === 1 ? 'Y' : 'N' },
  ].map((r) => Object.assign({ appRoleId: id }, r));
});
let failRole2Once = true;

// ── Integrations data: AR invoice down (expired sign-in), expense posting healthy, sync runs failed ───────────
const EVENTS = [
  { id: 1, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(5), httpStatus: 401 },
  { id: 2, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(20), httpStatus: 401 },
  { id: 3, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(40), httpStatus: 401 },
  { id: 6, integrationCode: 'INT-11', status: 'SUCCESS', createdAt: ago(300) },
  { id: 4, integrationCode: 'INT-08', status: 'SUCCESS', createdAt: ago(30), durationMs: 640 },
  { id: 5, integrationCode: 'INT-08', status: 'SUCCESS', createdAt: ago(90), durationMs: 700 },
];
const ERRORS = [
  { id: 7, integrationCode: 'INT-11', errorCode: 'EQR-API-002', httpStatus: 401, errorMessage: 'Unauthorized', severity: 'CRITICAL', createdAt: ago(12), entityType: 'Request', entityId: 'REQ-10418', retryCount: 3 },
  { id: 8, integrationCode: 'INT-08', errorMessage: 'Project 4.2 is closed for charges', severity: 'ERROR', createdAt: ago(51 * 60), requestNumber: 'REQ-10392', retryCount: 5 },
  { id: 9, integrationCode: 'INT-08', errorMessage: 'audit only', severity: 'INFO', createdAt: ago(60) },
];
const DLQ = [{ id: 3, integrationCode: 'INT-05', errorMessage: 'Serial EX-2207 already reserved', status: 'DEAD', createdAt: ago(3 * 24 * 60), retryCount: 3 }];
const JOBS = [
  { jobRunId: 41, jobName: 'EQUIP_ITEM_REFRESH_SYNC', status: 'FAILED', startedAt: ago(120), endedAt: ago(118), notes: 'Fusion report EQP_ITEMS_RP timed out' },
  { jobRunId: 40, jobName: 'EQUIP_FUSION_REFRESH', status: 'FAILED', startedAt: ago(125), endedAt: ago(124), notes: 'ORA-00060: deadlock detected' },
  { jobRunId: 39, jobName: 'EQUIP_UNIT_SERIAL_SYNC', status: 'SUCCESS', startedAt: ago(130), endedAt: ago(126), notes: 'rowsMerged=12' },
];

function adminHandle(req, res) {
  const p = req.path;
  const q = req.query;
  if (p.endsWith('/conf-global-settings') && req.method === 'GET') return res.json({ data: SETTINGS });
  let m = /\/conf-global-settings\/(\d+)$/.exec(p);
  if (m && req.method === 'PATCH') {
    const row = SETTINGS.find((r) => r.id === Number(m[1]));
    if (row) row.settingValue = req.json().settingValue;
    return res.json(row || {});
  }
  if (p.endsWith('/conf-global-settings') && req.method === 'POST') {
    const row = Object.assign({ id: 100 + SETTINGS.length }, req.json());
    SETTINGS.push(row);
    return res.json(row, 201);
  }
  if (p.endsWith('/conf-equipment-settings') && req.method === 'GET') return res.json({ data: BU_ROWS });
  m = /\/conf-equipment-settings\/(\d+)$/.exec(p);
  if (m && req.method === 'PATCH') {
    const row = BU_ROWS.find((r) => r.id === Number(m[1]));
    Object.assign(row, req.json());
    return res.json(row);
  }
  if (p.endsWith('/finBusinessUnitsLOV')) return res.json({ items: [FUSION_BU] });
  if (p.endsWith('/audit-trail')) return res.json({ data: AUDIT });
  if (p.endsWith('/rbac/app-roles')) return res.json({ data: ROLES });
  if (p.endsWith('/rbac/page-access-matrix')) {
    const id = Number(q.get('appRoleId'));
    return res.json({ data: (matrix[id] || []).concat(matrix[id === 1 ? 2 : 1].slice(0, 1)) });
  }
  if (p.endsWith('/rbac/page-access') && req.method === 'PUT') {
    const b = req.json();
    if (b.appRoleId === 2 && failRole2Once) {
      failRole2Once = false;
      return res.json({ message: 'EQR_WORKBENCH cannot be hidden while the role has open allocations.' }, 400);
    }
    (b.entries || []).forEach((e) => { const row = matrix[b.appRoleId].find((r) => r.pageCode === e.pageCode); if (row) row.accessLevel = e.accessLevel; });
    return res.json({ data: matrix[b.appRoleId] });
  }
  if (p.endsWith('/integration-events')) return res.json({ data: EVENTS });
  if (p.endsWith('/error-logs')) return res.json({ data: ERRORS });
  if (p.endsWith('/dead-letter-queue')) return res.json({ data: DLQ });
  if (p.endsWith('/job-run-logs')) return res.json({ data: JOBS });
  if (p.endsWith('/fusion-sync/exceptions')) return res.json({ items: [{ fusionSyncExceptionId: 5, equipmentNumber: 'EX-300', eqrSerialControlled: 'Y', fusionSerialControlled: 'N', eqrLotControlled: 'N', fusionLotControlled: 'N', detectedDate: ago(26 * 60) }] });
  if (p.endsWith('/fusion-sync/lock')) return res.json({ held: false });
  return undefined;
}

function handle(req, res) {
  const p = req.path;
  const q = req.query;
  const admin = adminHandle(req, res);
  if (admin) return admin;
  if (p.endsWith('/views/yard-stock')) {
    if (q.get('groupBy') === 'unitStatus') return res.json({ data: groupsOf(STOCK, 'unitStatus') });
    if (q.get('groupBy') === 'className') return res.json({ data: groupsOf(STOCK, 'className') });
    return res.json({ data: STOCK });
  }
  if (p.endsWith('/views/yard-utilization')) return res.json({ data: UTIL });
  if (p.endsWith('/views/my-requests')) return res.json({ data: REQS });
  if (p.endsWith('/views/my-request-lines')) return res.json({ data: LINES });
  if (p.endsWith('/views/project-cost-detail')) return res.json({ data: COST });
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: [] });
  return undefined;
}

/** The tab's content back to the top, the mouse out of the way: then a screenshot shows the screen as it opens. */
async function top(page) {
  await page.mouse.move(5, 5);
  await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTo(0, 0); });
  await page.waitForTimeout(150);
}

async function download(page, trigger, fmt) {
  await page.click(trigger);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.nx-menu-item[data-format="${fmt}"]`)]);
  const file = path.join(os.tmpdir(), 'next-ia-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}

(async () => {
  const env = await E.start({ port: PORT, handle, app: 'next' });
  const { page } = env;
  const A = '.nx-an ';
  try {
    T.section('Analytics: what is out, and what is idle');
    await env.open('/?open=analytics');
    await page.waitForSelector(A + '#anAnswer', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.eq('the answer, from the fleet tiles (rented ÷ all units)', await env.text(A + '#anAnswer'),
      '2 of 5 units are out on rent (40% utilization). 2 are available in a yard (Atlanta 1, Houston 1). 1 cannot go out (in maintenance).');
    T.eq('the tiles', await page.$$eval(A + '.nx-an-kpi', (k) => k.map((x) => x.querySelector('.nx-kpi-value').innerText.trim()).join()), '5,2,2,1');
    T.eq('out or idle by yard: out, available, not available', await page.$$eval(A + '#anYards .nx-an-bar', (b) => b.map((x) => x.dataset.value + ':'
      + [...x.querySelectorAll('.nx-an-seg')].map((s) => s.className.split('--')[1]).join('+') + ':' + x.querySelector('.nx-an-bar-value').innerText.trim()).join(' | ')),
      'Houston:out+idle+other:1 of 3 out | Atlanta:out+idle:1 of 2 out');
    T.eq('utilization by class, the busiest first', await page.$$eval(A + '#anClasses .nx-an-bar', (b) => b.map((x) => x.dataset.value + ' ' + x.querySelector('.nx-an-bar-value').innerText.trim()).join(', ')),
      'Excavators 67%, Cranes 0%');
    T.check('a unit out past its end date is flagged', (await env.text(A + '#anPastEnd')).includes('1 unit is still out after its rental ended')
      && (await env.text(A + '.nx-an-grid--fleet .nx-row[data-unit="EX-102"]')).includes('Past its end date'));
    T.check('the fleet calls are New\'s: unitStatus groups, the units (size 2000), className groups', ['groupBy=unitStatus', 'size=2000', 'groupBy=className']
      .every((q) => env.calls.some((c) => c.includes('/views/yard-stock') && c.includes(q))));
    await page.click(A + '#anYards .nx-an-bar[data-value="Houston"]');
    await page.waitForTimeout(300);
    T.eq('a yard clicked filters the units', await page.$$eval(A + '.nx-an-grid--fleet .nx-row[data-unit]', (r) => r.map((x) => x.dataset.unit).join()), 'EX-103,CR-7,CR-8');
    T.check('and says so, with a way to clear it', (await env.text(A + '.nx-an-pill')).includes('Yard: Houston'));
    await page.click(A + '.nx-an-kpi[data-kpi="idle"]');
    await page.waitForTimeout(300);
    T.eq('a tile is a filter too (available in Houston)', await page.$$eval(A + '.nx-an-grid--fleet .nx-row[data-unit]', (r) => r.map((x) => x.dataset.unit).join()), 'CR-7');
    await env.shot('next-analytics-fleet.png');
    const xl = await download(page, A + '#anExport', 'xlsx');
    T.check('Excel file name', /^equiprite-fleet-out-or-idle-\d{4}-\d{2}-\d{2}\.xlsx$/.test(xl.name), xl.name);
    let read = '';
    try {
      read = execFileSync('python3', ['-I', '-c', 'import sys, openpyxl\nws = openpyxl.load_workbook(sys.argv[1]).active\nrows = list(ws.iter_rows(values_only=True))\nprint(len(rows)); print(rows[0][:7]); print(rows[1][2], rows[1][5])', xl.file], { encoding: 'utf8' }).trim();
    } catch (e) { read = 'unavailable'; }
    if (read !== 'unavailable') {
      T.eq('the Excel rows are what is shown', read.split('\n').join(' | '), "2 | ('Class', 'Equipment', 'Unit / serial', 'Asset', 'Yard', 'Out or idle', 'Unit status') | CR-7 Available");
    }
    await page.click(A + '.nx-an-pill');
    await page.click(A + '.nx-an-kpi[data-kpi="all"]');
    await page.waitForTimeout(200);
    T.eq('cleared: every unit again', await page.$$eval(A + '.nx-an-grid--fleet .nx-row[data-unit]', (r) => r.length), 5);

    T.section('Analytics: how busy each yard has been');
    await page.click(A + '#anQ-use');
    await page.waitForSelector(A + '#anDays', { timeout: 20000 });
    await page.waitForTimeout(300);
    const util = env.calls.filter((c) => c.includes('/views/yard-utilization'));
    T.check('New\'s window: the last 30 days, size 2000', util.length === 1 && util[0].includes('size=2000') && /fromDate=\d{4}-\d{2}-\d{2}/.test(util[0]) && util[0].includes('toDate=' + new Date().toISOString().slice(0, 10)), util[0]);
    T.check('the answer: the average, the busiest day, the busiest and quietest yard', (await env.text(A + '#anAnswer')).includes('53% of the fleet was out on an average day (9.5 of 18 units)')
      && (await env.text(A + '#anAnswer')).includes('Busiest yard: Atlanta (65%); quietest: Houston (38%).'));
    T.eq('a column per day', await page.$$eval(A + '#anDays .nx-an-col', (c) => c.length), 2);
    T.eq('by yard, with a trend line drawn in SVG', await page.$$eval(A + '#anUseYards .nx-an-bar', (b) => b.map((x) => x.dataset.value + ' ' + x.querySelector('.nx-an-bar-value').innerText.trim()
      + ' ' + (x.querySelector('.nx-an-spark-line').getAttribute('d') || '').slice(0, 1)).join(', ')), 'Atlanta 65% M, Houston 38% M');
    await page.click(A + '.nx-seg-btn[data-preset="last-90"]');
    await page.waitForTimeout(800);
    const util2 = env.calls.filter((c) => c.includes('/views/yard-utilization'));
    T.check('another period loads New\'s window again', util2.length === 2 && util2[1] !== util2[0]);
    await page.click(A + '.nx-seg-btn[data-value="day"]');
    await page.waitForTimeout(300);
    T.eq('the table by yard and day', await page.$$eval(A + '.nx-an-grid--day .nx-row:not(.nx-row--head)', (r) => r.length), 4);
    const csv = await download(page, A + '#anExport', 'csv');
    T.eq('the CSV by day has New\'s columns', fs.readFileSync(csv.file, 'utf8').split('\r\n')[0].replace(/^﻿/, ''), 'Yard,Date,Month,Fleet Size,Deployed Units,Utilization %,Used Hours');
    await env.shot('next-analytics-utilization.png');

    T.section('Analytics: what is late');
    await page.click(A + '#anQ-late');
    await page.waitForSelector(A + '.nx-an-grid--late', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.eq('the answer, by requestProgress\'s rule', await env.text(A + '#anAnswer'),
      '2 pieces of equipment are late: 1 past its end date and not back (the oldest 6 days), and 1 not shipped by its start date (the oldest 3 days).');
    T.eq('the oldest first, with what is next', await page.$$eval(A + '.nx-an-grid--late .nx-row--click', (r) => r.map((x) => x.dataset.number + ' ' + x.querySelector('.nx-cell-next').innerText.trim()).join(' | ')),
      'REQ-1764 Requester to return it | REQ-1765 Equipment Manager to confirm it for picking');
    T.eq('how late, in buckets', await page.$$eval(A + '#anBuckets .nx-an-bar', (b) => b.map((x) => x.querySelector('.nx-an-bar-value').innerText.trim()).join()), '1,1,0,0,0');
    await page.click(A + '.nx-chip[data-value="overdue"]');
    await page.waitForTimeout(200);
    T.eq('the chip: past the end date only', await page.$$eval(A + '.nx-an-grid--late .nx-row--click', (r) => r.map((x) => x.dataset.number).join()), 'REQ-1764');
    await env.shot('next-analytics-late.png');
    await page.click(A + '.nx-an-grid--late .nx-row--click[data-number="REQ-1764"] .nx-link');
    await page.waitForSelector('.nx-tab[data-tab-id="request:1764"]', { timeout: 20000 });
    T.check('a late row opens its request in a tab', true);
    await page.click('.nx-tab-btn[data-id="analytics"]');
    await page.waitForTimeout(400);

    T.section('Analytics: how requests are moving');
    await page.click(A + '#anQ-flow');
    await page.waitForSelector(A + '#anMonths', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.check('the answer: where they are and what started', (await env.text(A + '#anAnswer')).startsWith('4 requests: 1 waiting for approval, 1 getting ready, 1 with equipment out and 1 done.'),
      await env.text(A + '#anAnswer'));
    T.eq('where every request is now', await page.$$eval(A + '#anLanes .nx-an-bar', (b) => b.map((x) => x.dataset.value + ':' + x.querySelector('.nx-an-bar-value').innerText.trim()).join(' ')),
      'action:0 approval:1 ready:1 out:0 onsite:1 back:0 done:1');
    T.eq('a column per month, two ahead', await page.$$eval(A + '#anMonths .nx-an-month', (m) => [m.length, m.filter((x) => x.className.includes('--ahead')).length].join()), '8,2');
    await page.click(A + '#anLanes .nx-an-bar[data-value="approval"]');
    await page.waitForTimeout(200);
    T.eq('a stage clicked shows its requests', await page.$$eval(A + '.nx-an-grid--flow .nx-row--click', (r) => r.map((x) => x.dataset.number).join()), 'REQ-1766');
    await env.shot('next-analytics-requests.png');

    T.section('Analytics: what it costs');
    await page.click(A + '#anQ-cost');
    await page.waitForSelector(A + '.nx-an-grid--cost', { timeout: 20000 });
    await page.waitForTimeout(300);
    T.check('Old\'s Project cost detail call: page 0, size 2000', env.calls.some((c) => c.includes('/views/project-cost-detail?') && c.includes('page=0') && c.includes('size=2000')));
    T.eq('the answer', await env.text(A + '#anAnswer'), '$16,700 of equipment cost on 3 lines: $12,000 posted to projects, $4,700 not posted yet. The largest is Pipeline North ($14,000, 84%).');
    await page.click(A + '.nx-chip[data-value="unposted"]');
    await page.waitForTimeout(200);
    T.eq('not posted yet, the largest first', await page.$$eval(A + '.nx-an-grid--cost .nx-row[data-request]', (r) => r.map((x) => x.dataset.request).join()), 'REQ-1765,REQ-1764');
    T.check('posting is New\'s: the link says so', (await page.getAttribute(A + '#anPostCosts', 'href')) === env.newUrl + '/vp/shell/usage/post-costs');
    await env.shot('next-analytics-cost.png');
    T.check('more reports: where each one opens', (await page.getAttribute(A + '.nx-an-more-list li[data-more="onhand"] a', 'href')) === env.newUrl + '/vp/shell/insights/analytics?report=onhand'
      && (await page.getAttribute(A + '.nx-an-more-list li[data-more="history"] a', 'href')) === env.oldUrl + '/vp/shell/equipment-foundation/equipment-reports');
    T.check('no sideways scroll on Analytics', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    T.eq('Analytics reads only', env.writes.length, 0);
    const path0 = (x) => x.path.replace(/^.*\/equiprite\/v1/, '');

    T.section('Settings: what each switch does, and what saving changes');
    const S = '.nx-st ';
    await page.click('.nx-nav-item[data-nav-id="settings"]');
    await page.waitForSelector(S + '.nx-st-row[data-key="TIMESHEETS_ENABLED"]', { timeout: 30000 });
    await page.waitForTimeout(400);
    const row = async (k) => env.text(S + `.nx-st-row[data-key="${k}"]`);
    T.check('a switch says what it does and what changes', (await row('TIMESHEETS_ENABLED')).includes('Master costing switch')
      && (await row('TIMESHEETS_ENABLED')).includes('What changes: Menu: Time entry and Timesheet approval'), await row('TIMESHEETS_ENABLED'));
    T.check('a setting that needs another says so', (await row('PPM_RATES_ENABLED')).includes('Needs: Timesheets is on'));
    T.check('the saved week-ending day is locked, with a Reset', (await row('WEEK_END_DAY')).includes('Saved as Friday. It is locked') && !!(await page.$(S + '#stResetWeek')));
    T.check('New\'s reads: the whole settings table, the history, the business units', env.calls.some((c) => c.includes('/conf-global-settings?size=500'))
      && env.calls.some((c) => c.includes('/audit-trail')) && env.calls.some((c) => c.includes('/conf-equipment-settings?') && c.includes('pageSize=10000') && c.includes('limit=10000')),
      env.calls.filter((c) => /conf-|audit/.test(c)).join(' '));
    T.eq('nothing is staged on entry', await page.$(S + '#stPending'), null);
    await page.click(S + '.nx-st-switch[data-key="PROJECTS_MODULE_ENABLED"]');
    await page.waitForTimeout(400);
    T.check('one module must stay on: refused, in words', (await env.text('.nx-toast')).includes('At least one module must stay on') && !(await page.$(S + '#stPending')));
    await page.click(S + '.nx-st-switch[data-key="PPM_RATES_ENABLED"]');
    await page.waitForSelector(S + '#stPending');
    T.eq('PPM on also stages the posting labels never saved (in New\'s order: the labels, then the switch)', await page.$$eval(S + '.nx-st-changes li', (l) => l.map((x) => x.dataset.key).join()), 'PPM_TXN_SOURCE,PPM_DOCUMENT,PPM_DOC_ENTRY,PPM_RATES_ENABLED');
    T.check('the consequence is said before saving', (await env.text(S + '#stPending')).includes('Fusion PPM rates: Off → On')
      && (await env.text(S + '#stPending')).includes('The menu will hide Post costs, Rates.'), await env.text(S + '#stPending'));
    await page.click(S + '.nx-st-switch[data-key="TIMESHEETS_ENABLED"]');
    await page.waitForTimeout(400);
    T.check('timesheets cannot go off under PPM: refused', (await env.text('.nx-toast')).includes('Fusion PPM rates depends on timesheets'));
    await page.click(S + '#stDiscard');
    await page.waitForFunction(() => !document.querySelector('.nx-st #stPending'), null, { timeout: 10000 });
    T.check('Discard puts every setting back', !(await row('PPM_RATES_ENABLED')).includes('Unsaved'));
    await page.click(S + '.nx-st-switch[data-key="TIMESHEETS_ENABLED"]');
    await page.click(S + '.nx-st-switch[data-key="NOTIFY_ON_APPROVAL"]');
    await page.waitForTimeout(400);
    T.check('turning timesheets off says what the menu loses', (await env.text(S + '#stPending')).includes('The menu will hide Timesheets, Approve time.'));
    T.eq('Save says how many', await env.text(S + '#stSave'), 'Save 2 changes');
    await page.mouse.move(5, 5);
    await env.shot('next-settings-pending.png');
    const before = env.writes.length;
    await page.click(S + '#stSave');
    await page.waitForFunction(() => !document.querySelector('.nx-st #stPending'), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const w = env.writes.slice(before);
    T.eq('Save: New\'s calls, in the order staged', w.map((x) => x.method + ' ' + path0(x)).join(' | '), 'PATCH /conf-global-settings/4 | POST /conf-global-settings');
    T.eq('the PATCH body', JSON.stringify(w[0] && w[0].body), '{"settingValue":"false"}');
    T.eq('the POST body of a never-saved key', JSON.stringify(w[1] && w[1].body), JSON.stringify({ settingKey: 'NOTIFY_ON_APPROVAL', settingValue: 'true',
      settingCategory: 'NOTIFICATION', isActiveFlag: 'Y', description: 'Email on approval', createdBy: 'EQUIPRITE', lastUpdatedBy: 'EQUIPRITE' }));
    T.check('the menu follows at once', !(await page.$('.nx-nav-item[data-nav-id="timesheets"]')) && !!(await page.$('.nx-nav-item[data-nav-id="costs"]')));
    await page.click(S + '#stResetWeek');
    await page.waitForSelector(S + '#stConfirm');
    T.check('Reset says what it does first', (await env.text(S + '#stConfirm')).includes('clears the saved day'));
    const b2 = env.writes.length;
    await page.click(S + '#stConfirmOk');
    await page.waitForTimeout(900);
    T.eq('Reset: New\'s PATCH', JSON.stringify(env.writes.slice(b2).map((x) => [x.method, path0(x), x.body])), JSON.stringify([['PATCH', '/conf-global-settings/8', { settingValue: '' }]]));
    T.check('the day can be picked again', !(await row('WEEK_END_DAY')).includes('locked'));
    await page.click(S + '.nx-st-grid--bu .nx-row[data-bu="300000046987012"] button');
    await page.waitForSelector(S + '#stBuEditor');
    await page.click(S + '#stBuEditor .nx-seg-btn[data-field="RATE_SOURCE"][data-value="PPM_RATES"]');
    await page.waitForTimeout(300);
    T.check('a business-unit change says what it does to the menu', (await env.text(S + '#stBuChanges')).includes('Rate source: EquipRite Rates → PPM Rates')
      && (await env.text(S + '#stBuChanges')).includes('Rates will leave the menu'), await env.text(S + '#stBuChanges'));
    await page.mouse.move(5, 5);
    await env.shot('next-settings-business-unit.png');
    const b3 = env.writes.length;
    await page.click(S + '#stBuSave');
    await page.waitForFunction(() => !document.querySelector('.nx-st #stBuEditor'), null, { timeout: 15000 });
    await page.waitForTimeout(400);
    const bw = env.writes.slice(b3);
    T.eq('the business unit: one PATCH of its row, as New', bw.map((x) => x.method + ' ' + path0(x)).join(), 'PATCH /conf-equipment-settings/501');
    T.eq('its body: the typed columns, the Fusion business-unit columns, lastUpdatedBy', JSON.stringify(bw[0] && bw[0].body), JSON.stringify({ rateSource: 'PPM_RATES',
      passProcurementCost: 'N', ppmTransSource: 'EQUIPRITE', ppmBatchPrefix: 'EQRP-HOU', adhocTimesheetEnabled: 'Y', marginPercentage: 0, businessUnitName: 'US1 Business Unit',
      buPrimaryLedgerId: 300000046975971, buLocationId: 1234, buManagerId: null, buLegalEntityId: 300000046974641, lastUpdatedBy: 'EQUIPRITE' }));
    T.check('Rates left the menu', !(await page.$('.nx-nav-item[data-nav-id="rates"]')));
    T.eq('the change history', await page.$$eval(S + '.nx-st-grid--hist .nx-row:not(.nx-row--head)', (r) => r.length), 2);
    const hcsv = await download(page, S + '#stExportHistory', 'csv');
    T.check('the history exports', fs.readFileSync(hcsv.file, 'utf8').split('\r\n')[0].includes('When,Who,Section,Field,Old value,New value'));
    T.check('no sideways scroll on Settings', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    T.section('Access: every role against every page');
    const C = '.nx-ac ';
    await page.click('.nx-nav-item[data-nav-id="access"]');
    await page.waitForSelector(C + '.nx-ac-grid', { timeout: 30000 });
    await page.waitForTimeout(300);
    T.eq('a column per active role', await page.$$eval(C + '.nx-ac-rolehead', (h) => h.map((x) => x.textContent.trim().split(/\s{2,}/)[0]).join()), 'Administrator,Equipment manager');
    T.eq('each role read with New\'s call', env.calls.filter((c) => /\/rbac\/page-access-matrix\?appRoleId=[12]$/.test(c)).length, 2);
    T.eq('pages by module', await page.$$eval(C + '.nx-ac-module', (m) => m.map((x) => x.textContent.trim()).join()), 'Project Requestor,Equipment Manager,Analytics,Administrator');
    T.check('a locked row cannot change', !!(await page.$(C + '.nx-ac-row[data-page="EQR_RBAC_ADMIN"] .nx-ac-cell[data-role="1"] .nx-ac-locked'))
      && !(await page.$(C + '.nx-ac-row[data-page="EQR_RBAC_ADMIN"] .nx-ac-cell[data-role="1"] select')));
    T.check('a page says which Next screen it opens', (await env.text(C + '.nx-ac-row[data-page="EQR_ANALYTICS"]')).includes('Opens Analytics in Next'));
    await page.selectOption(C + '.nx-ac-row[data-page="EQR_WORKBENCH"] select[data-role="2"]', 'HIDDEN');
    await page.selectOption(C + '.nx-ac-row[data-page="EQR_DASHBOARD"] select[data-role="1"]', 'READ_ONLY');
    await page.waitForSelector(C + '#acPending');
    await page.waitForTimeout(200);
    T.check('what a role loses in the menu, before saving', (await env.text(C + '#acPending li[data-role="2"]')).includes('Workbench: Full → Hidden')
      && (await env.text(C + '#acPending li[data-role="2"]')).includes('Equipment manager loses Approve & allocate, Inspections, Transfers in the menu.'), await env.text(C + '#acPending'));
    T.check('and when the menu stays the same', (await env.text(C + '#acPending li[data-role="1"]')).includes('Administrator\'s menu stays the same'));
    await page.selectOption(C + '.nx-ac-row[data-page="EQR_EQUIPMENT_MASTER"] select[data-role="2"]', 'FULL');
    await page.selectOption(C + '.nx-ac-row[data-page="EQR_EQUIPMENT_MASTER"] select[data-role="2"]', 'READ_ONLY');
    await page.waitForTimeout(200);
    T.eq('the saved level again drops the edit', await env.text(C + '#acSave'), 'Save 2 changes');
    await top(page);
    await env.shot('next-access-pending.png');
    const b4 = env.writes.length;
    await page.click(C + '#acSave');
    await page.waitForSelector(C + '.nx-error', { timeout: 15000 });
    await page.waitForTimeout(400);
    T.eq('one PUT per role, in role order, only its changed rows', JSON.stringify(env.writes.slice(b4).map((x) => [x.method, path0(x), x.body])), JSON.stringify([
      ['PUT', '/rbac/page-access', { appRoleId: 1, entries: [{ pageCode: 'EQR_DASHBOARD', accessLevel: 'READ_ONLY' }] }],
      ['PUT', '/rbac/page-access', { appRoleId: 2, entries: [{ pageCode: 'EQR_WORKBENCH', accessLevel: 'HIDDEN' }] }]]));
    T.check('a refused role stays on the page in words, its change kept', (await env.text(C)).includes('Equipment manager: Not saved: EQR_WORKBENCH cannot be hidden while the role has open allocations.')
      && (await env.text(C + '#acSave')) === 'Save 1 change');
    T.check('the saved role was read again', (await page.$eval(C + '.nx-ac-row[data-page="EQR_DASHBOARD"] select[data-role="1"]', (s) => s.value)) === 'READ_ONLY'
      && !(await page.$(C + '.nx-ac-row[data-page="EQR_DASHBOARD"] .nx-ac-cell--dirty[data-role="1"]')),
      (await page.$eval(C + '.nx-ac-row[data-page="EQR_DASHBOARD"] select[data-role="1"]', (s) => s.value)) + ' ' + (await page.$$eval(C + '.nx-ac-cell--dirty', (c) => c.map((x) => x.dataset.role).join())));
    const b5 = env.writes.length;
    await page.click(C + '#acSave');
    await page.waitForFunction(() => !document.querySelector('.nx-ac #acPending'), null, { timeout: 15000 });
    T.eq('Save again: that role only', env.writes.slice(b5).map((x) => x.method + ' ' + path0(x) + ' ' + x.body.appRoleId).join(), 'PUT /rbac/page-access 2');
    const acsv = await download(page, C + '#acExport', 'csv');
    T.eq('the matrix exports, a column per role', fs.readFileSync(acsv.file, 'utf8').split('\r\n')[0].replace(/^﻿/, ''), 'Module,Page,Page code,In Next,Administrator,Equipment manager');
    T.check('no sideways scroll on Access', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    T.section('Integrations: what is down, since when, what failed, what to do');
    const I = '.nx-ih ';
    const wBefore = env.writes.length;
    await page.click('.nx-nav-item[data-nav-id="integrations"]');
    await page.waitForSelector(I + '#ihAnswer', { timeout: 30000 });
    await page.waitForTimeout(300);
    T.check('New\'s six reads', ['/integration-events', '/error-logs', '/dead-letter-queue', '/job-run-logs?', '/fusion-sync/exceptions?status=OPEN', '/fusion-sync/lock']
      .every((p) => env.calls.some((c) => c.includes(p))) && env.calls.some((c) => c.includes('/job-run-logs?') && c.includes('size=200') && c.includes('orderBy=startedAt')));
    const down = await env.text(I + '#ihDown li[data-key="INT-11"]');
    T.check('what is down and since when (the first failure after the last success)', down.includes('Down since') && down.includes('(40 min)') && down.includes('The last 3 calls failed'), down);
    T.check('what failed and what to do, in words', down.includes('What failed: Fusion refused EquipRite\'s sign-in.') && down.includes('What to do: Update the stored Fusion credential'));
    T.eq('every down integration is listed', await page.$$eval(I + '#ihDown li', (l) => l.map((x) => x.dataset.key).join()), 'INT-11,EQUIP_ITEM_REFRESH_SYNC,EQUIP_FUSION_REFRESH');
    T.eq('the cards, the worst first', await page.$$eval(I + '.nx-ih-card', (c) => c.slice(0, 4).map((x) => x.dataset.key + ':' + x.className.split('--')[1]).join(' ')),
      'INT-11:down EQUIP_ITEM_REFRESH_SYNC:down EQUIP_FUSION_REFRESH:down INT-08:degraded');
    T.check('running a sync again is New\'s: a link that says so', (await page.getAttribute(I + '.nx-ih-card[data-key="EQUIP_ITEM_REFRESH_SYNC"] .nx-ih-action a', 'href')) === env.newUrl + '/vp/shell/admin/integration-health'
      && (await env.text(I + '.nx-ih-card[data-key="EQUIP_ITEM_REFRESH_SYNC"]')).includes('Run now in New EquipRite'));
    T.eq('the exception queue, the oldest first', await page.$$eval(I + '.nx-ih-grid--queue .nx-row[data-key]', (r) => r.map((x) => x.dataset.key).join()), 'd3,e8,s5,jEQUIP_FUSION_REFRESH,jEQUIP_ITEM_REFRESH_SYNC,e7');
    await page.click(I + '.nx-chip[data-value="INT-08"]');
    await page.waitForTimeout(200);
    T.eq('a chip narrows it to one integration', await page.$$eval(I + '.nx-ih-grid--queue .nx-row[data-key]', (r) => r.map((x) => x.dataset.key).join()), 'e8');
    const qcsv = await download(page, I + '#ihExportQueue', 'csv');
    T.eq('the queue exports what is shown', fs.readFileSync(qcsv.file, 'utf8').split('\r\n').filter(Boolean).length, 2);
    await page.click(I + '.nx-chip[data-value="INT-08"]');
    await top(page);
    await env.shot('next-integrations.png');
    T.eq('Integrations writes nothing', env.writes.length, wBefore);
    T.check('no sideways scroll on Integrations', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    T.section('a tablet (1024 px): every screen fits');
    await page.setViewportSize({ width: 1024, height: 900 });
    for (const [tab, sel, shot] of [['analytics', '.nx-an', 'next-analytics-1024.png'], ['settings', '.nx-st', ''], ['access', '.nx-ac', 'next-access-1024.png'], ['integrations', '.nx-ih', '']]) {
      await page.click(`.nx-tab-btn[data-id="${tab}"]`);
      await page.waitForTimeout(400);
      const fits = await page.evaluate((s) => {
        const root = document.querySelector(s);
        return document.documentElement.scrollWidth <= document.documentElement.clientWidth && !!root && root.scrollWidth <= root.clientWidth + 1;
      }, sel);
      T.check(tab + ': no sideways scroll at 1024 px (wide tables scroll inside their card)', fits);
      if (shot) { await top(page); await env.shot(shot); }
    }
    // The refused save above logs its 400 (as New's saveMatrixChain does); nothing else may.
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning') && !/400 \(Bad Request\)|\[access saveChain\] save failed/.test(e)).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-insights-admin-failed.png').catch(() => {});
  } finally {
    if (process.env.SHOW_WARNINGS) console.log(env.errors.join('\n'));
    await env.close();
    T.report();
  }
})();
