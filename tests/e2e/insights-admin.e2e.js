'use strict';
/*
 * Analytics, Page access and Integration health in a real browser, against fake data:
 *   - Analytics renders the hero, the library, the charts and the rows of each live report; a chip and the
 *     Utilization period send the old page's params; Export CSV downloads the old file
 *   - Page access: changing a level shows the consequence and the preview, Save sends the old PUT
 *   - Integration health: cards, exception queue in plain language, Run now and Reprocess send the right calls
 *   - no console errors
 * Needs `npm run build`. Run: node tests/e2e/insights-admin.e2e.js   (screenshots go to the OS temp folder)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const PORT = 19160;

// ── Fake data ──────────────────────────────────────────────────────────
const YARDS = [{ organizationId: 300000047274447, organizationName: 'Atlanta' }, { organizationId: 300000047274448, organizationName: 'Houston' }];
const STOCK = [
  { className: 'Excavators', equipmentName: 'CAT 320', unitNumber: 'EX-101', unitType: 'SERIAL', assetNumber: 'A-1', invOrgName: 'Atlanta', invOrgId: 300000047274447, unitStatus: 'AVAILABLE', onhandQty: 1, projectName: '', currentStartDate: null, currentEndDate: null },
  { className: 'Excavators', equipmentName: 'CAT 320', unitNumber: 'EX-102', unitType: 'SERIAL', assetNumber: 'A-2', invOrgName: 'Atlanta', invOrgId: 300000047274447, unitStatus: 'RENTED', onhandQty: 1, projectName: 'Pipeline North', currentStartDate: '2026-10-01T00:00:00Z', currentEndDate: '2026-11-30T00:00:00Z' },
  { className: 'Cranes', equipmentName: 'Grove RT', unitNumber: 'CR-7', unitType: 'SERIAL', assetNumber: 'A-3', invOrgName: 'Houston', invOrgId: 300000047274448, unitStatus: 'AVAILABLE', onhandQty: 1, projectName: '', currentStartDate: null, currentEndDate: null },
  { className: 'Cranes', equipmentName: 'Grove RT', unitNumber: 'CR-8', unitType: 'SERIAL', assetNumber: 'A-4', invOrgName: 'Houston', invOrgId: 300000047274448, unitStatus: 'IN_MAINTENANCE', onhandQty: 1, projectName: '', currentStartDate: null, currentEndDate: null },
];
const PENDING = [
  { requestNumber: 'EQR-000101', lineNumber: 1, className: 'Excavators', equipmentName: 'CAT 320', quantity: 1, projectName: 'Pipeline North', taskName: 'Trenching', requestor: 'Pat Lee', lineStartDate: '2026-11-02', lineEndDate: '2026-11-27', lineStatus: 'IN_PROCESS', invOrgId: null, billRate: 1400, estimatedCost: 36400 },
  { requestNumber: 'EQR-000102', lineNumber: 1, className: 'Cranes', equipmentName: 'Grove RT', quantity: 1, projectName: 'Plant B', taskName: 'Lift', requestor: 'Pat Lee', lineStartDate: '2026-11-05', lineEndDate: '2026-11-20', lineStatus: 'ALLOCATED', invOrgId: 300000047274448, allocatedSerial: 'CR-7', billRate: 2100, estimatedCost: 33600 },
  { requestNumber: 'EQR-000103', lineNumber: 2, className: 'Excavators', equipmentName: 'CAT 320', quantity: 2, projectName: 'Plant B', taskName: 'Dig', requestor: 'Sam Ortiz', lineStartDate: '2026-11-10', lineEndDate: '2026-11-12', lineStatus: 'IN_PROCESS', invOrgId: null, billRate: 1400, estimatedCost: 8400 },
];
const ONHAND = [
  { equipmentMasterId: 21, className: 'Safety', equipmentName: 'Trench kit', invOrgName: 'Atlanta', invOrgId: 300000047274447, itemNumber: 'TK-1', uomCode: 'EA', onhandQty: 40 },
  { equipmentMasterId: 22, className: 'Safety', equipmentName: 'Cones', invOrgName: 'Houston', invOrgId: 300000047274448, itemNumber: 'CN-1', uomCode: 'EA', onhandQty: 250 },
];
const UTIL = [
  { yardName: 'Atlanta', dayDate: '2026-10-27', monthLabel: 'Oct 2026', fleetSize: 10, deployedUnits: 6, utilPercent: 60, usedHours: 48 },
  { yardName: 'Houston', dayDate: '2026-10-27', monthLabel: 'Oct 2026', fleetSize: 8, deployedUnits: 2, utilPercent: 25, usedHours: 16 },
  { yardName: 'Atlanta', dayDate: '2026-10-28', monthLabel: 'Oct 2026', fleetSize: 10, deployedUnits: 7, utilPercent: 70, usedHours: 56 },
  { yardName: 'Houston', dayDate: '2026-10-28', monthLabel: 'Oct 2026', fleetSize: 8, deployedUnits: 4, utilPercent: 50, usedHours: 32 },
];
const groupsOf = (rows, field, qty) => {
  const m = {};
  rows.forEach((r) => { const k = r[field]; m[k] = m[k] || { groupKey: k, count: 0, qtySum: 0 }; m[k].count++; m[k].qtySum += Number(r[qty] || 0); });
  return Object.values(m);
};

// Page access: two active roles (and an inactive one); the matrix is a little store so a save is read back.
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

// Integration health: a down AR invoice (expired sign-in), a healthy expense posting, failed sync runs.
const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const EVENTS = [
  { id: 1, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(5), httpStatus: 401 },
  { id: 2, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(20), httpStatus: 401 },
  { id: 3, integrationCode: 'INT-11', status: 'FAILED', createdAt: ago(40), httpStatus: 401 },
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
const lockState = { held: false };

function handle(req, res) {
  const p = req.path;
  const q = req.query;
  if (p.endsWith('/rbac/app-roles')) return res.json({ data: ROLES });
  if (p.endsWith('/rbac/page-access-matrix')) {
    const id = Number(q.get('appRoleId'));
    return res.json({ data: (matrix[id] || []).concat(matrix[id === 1 ? 2 : 1].slice(0, 1)) });
  }
  if (p.endsWith('/rbac/page-access') && req.method === 'PUT') {
    const b = req.json();
    (b.entries || []).forEach((e) => { const row = matrix[b.appRoleId].find((r) => r.pageCode === e.pageCode); if (row) row.accessLevel = e.accessLevel; });
    return res.json({ data: matrix[b.appRoleId] });
  }
  if (p.endsWith('/integration-events')) return res.json({ data: EVENTS });
  if (p.endsWith('/error-logs')) return res.json({ data: ERRORS });
  if (p.endsWith('/dead-letter-queue')) return res.json({ data: DLQ });
  if (p.endsWith('/job-run-logs')) return res.json({ data: JOBS });
  if (p.endsWith('/fusion-sync/exceptions')) return res.json({ items: [{ fusionSyncExceptionId: 5, equipmentNumber: 'EX-300', exceptionType: 'CONTROL_TYPE_CHANGE', eqrSerialControlled: 'Y', fusionSerialControlled: 'N', eqrLotControlled: 'N', fusionLotControlled: 'N', detectedDate: ago(26 * 60) }] });
  if (p.endsWith('/fusion-sync/lock')) {
    return res.json(lockState.held ? { held: true, runLabel: 'SYNC', syncCode: 'EQUIP_ITEM_REFRESH_SYNC', acquiredAt: ago(3), idleSeconds: 10, staleAfterSeconds: 1200 } : { held: false });
  }
  if (/\/int-configs\/[A-Z_]+\/run$/.test(p) && req.method === 'POST') return res.json({ jobRunId: 99, syncCode: p.split('/').slice(-2)[0], status: 'STARTED' }, 202);
  if (p.endsWith('/fusion-sync/refresh-units') && req.method === 'POST') return res.json({ itemsChanged: 0, itemsHeld: 1, serials: 12, lots: 3, onhand: 40, stockWaiting: 0 });
  if (p.endsWith('/inv-orgs')) return res.json({ data: YARDS });
  if (p.endsWith('/views/yard-stock')) {
    if (q.get('groupBy') === 'unitStatus') return res.json({ data: groupsOf(STOCK, 'unitStatus') });
    if (q.get('groupBy') === 'className') return res.json({ data: groupsOf(STOCK, 'className') });
    return res.json({ data: STOCK.filter((r) => !q.get('className') || r.className === q.get('className')) });
  }
  if (p.endsWith('/views/pending-approval-lines')) {
    if (q.get('groupBy') === 'lineStatus') return res.json({ data: groupsOf(PENDING, 'lineStatus').concat([{ groupKey: 'DEPLOYED', count: 9 }]) });
    if (q.get('groupBy') === 'className') return res.json({ data: groupsOf(PENDING, 'className') });
    return res.json({ data: PENDING });
  }
  if (p.endsWith('/views/onhand-qty')) {
    if (q.get('groupBy') === 'className') return res.json({ data: groupsOf(ONHAND, 'className', 'onhandQty') });
    return res.json({ data: ONHAND });
  }
  if (p.endsWith('/views/yard-utilization')) return res.json({ data: UTIL });
  return undefined;
}

(async () => {
  const env = await E.start({ port: PORT, handle });
  const { page } = env;
  const shots = [];
  try {
    T.section('Analytics: fleet stock renders from the old views');
    await env.open('/vp/shell/insights/analytics');
    await page.waitForSelector('.er-an-insight', { timeout: 30000 });
    await page.waitForTimeout(800);
    T.check('hero: utilization = rented ÷ total (1 of 4 = 25%)', (await env.text('.er-an-hero')).includes('25%'));
    T.check('library lists the live reports and the old ones', (await env.text('.er-an-lib')).includes('Approvals in progress')
      && (await env.text('.er-an-lib')).includes('Agreement expiry'));
    T.check('insight: 2 units free to send out', (await env.text('.er-an-insight')).includes('2') && (await env.text('.er-an-insight')).includes('free to send out'));
    T.eq('three charts on Fleet stock', await page.$$eval('.er-an-chart oj-chart', (c) => c.length), 3);
    T.check('rows table shows the units', (await env.text('#analyticsTable')).includes('EX-102'));
    T.check('the yard-stock status groups were asked', env.calls.some((c) => c.includes('/views/yard-stock?groupBy=unitStatus')));
    shots.push(await env.shot('analytics-stock.png'));

    T.section('a chip filters through the old criterion params');
    env.calls.length = 0;
    await page.click('.er-chip[data-field="className"][data-value="Cranes"]');
    await page.waitForTimeout(1200);
    T.check('className=Cranes sent to yard-stock', env.calls.some((c) => c.includes('/views/yard-stock?') && c.includes('className=Cranes') && !c.includes('groupBy')));

    T.section('Approvals in progress and On-hand stock');
    await page.click('.er-seg-btn[data-report="equipment-pending"]');
    await page.waitForSelector('.er-an-insight', { timeout: 15000 });
    await page.waitForTimeout(800);
    T.check('pending insight counts the lines', (await env.text('.er-an-insight')).includes('3'));
    T.check('line status labels in the rows', (await env.text('#analyticsTable')).includes('IN PROCESS'));
    shots.push(await env.shot('analytics-pending.png'));
    await page.click('.er-seg-btn[data-report="onhand"]');
    await page.waitForTimeout(1500);
    T.check('on-hand total 290', (await env.text('.er-an-insight')).includes('290'));

    T.section('Utilization: period and pivot');
    env.calls.length = 0;
    await page.click('.er-seg-btn[data-report="equip-utilization"]');
    await page.waitForSelector('.er-an-util', { timeout: 15000 });
    T.check('peak day = 11 units', (await env.text('.er-an-insight')).includes('11'));
    T.check('fromDate / toDate sent', env.calls.some((c) => c.includes('/views/yard-utilization?') && c.includes('fromDate=') && c.includes('toDate=')));
    env.calls.length = 0;
    await page.click('.er-seg-btn[data-preset="last-90"]');
    await page.waitForTimeout(1200);
    T.check('Last 90 days reloads utilization', env.calls.some((c) => c.includes('/views/yard-utilization?')));
    shots.push(await env.shot('analytics-utilization.png'));

    T.section('Export CSV');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('.er-band button:has-text("Export CSV")')]);
    T.eq('the old file name', dl.suggestedFilename(), 'Equipment_Utilization.csv');

    T.section('Page access: matrix, consequence, preview, save');
    await env.open('/vp/shell/admin/page-access');
    await page.waitForSelector('.er-pa-row', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.eq('only the active roles are offered', await page.$$eval('.er-pa-roles .er-chip', (b) => b.map((x) => x.textContent.trim()).join('|')), 'Administrator|Equipment manager');
    await page.click('.er-pa-roles .er-chip[data-role-id="2"]');
    await page.waitForTimeout(800);
    T.check('the matrix asked for role 2', env.calls.some((c) => c.includes('/rbac/page-access-matrix?appRoleId=2')));
    T.eq('rows of other roles are filtered out', await page.$$eval('.er-pa-row', (r) => r.length), 6);
    T.check('the preview shows Workbench before the change', (await env.text('.er-pa-menu')).includes('Workbench'));
    T.check('a read-only page is tagged in the preview', /read only/i.test(await env.text('.er-pa-menu')));
    await page.click('button[data-page-code="EQR_WORKBENCH"][data-level="HIDDEN"]');
    await page.waitForTimeout(400);
    T.check('the consequence is said before saving', (await env.text('.er-pa-unsaved')).includes('loses Workbench'));
    T.check('the preview drops Workbench', !(await env.text('.er-pa-menu')).includes('Workbench'));
    T.check('the row is marked unsaved with its old level', (await env.text('.er-pa-row--dirty')).includes('was Full'));
    shots.push(await env.shot('page-access-change.png'));
    env.writes.length = 0;
    await page.click('.er-band button:has-text("Save 1 change")');
    await page.waitForTimeout(1200);
    T.eq('one PUT to /rbac/page-access', env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', '')).join(' > '), 'PUT /rbac/page-access');
    T.eq('the old body: role and dirty rows only', JSON.stringify(env.writes[0] && env.writes[0].body),
      JSON.stringify({ appRoleId: 2, entries: [{ pageCode: 'EQR_WORKBENCH', accessLevel: 'HIDDEN' }] }));
    T.check('saved: nothing pending, the row reads Hidden', !(await page.$('.er-pa-unsaved'))
      && (await page.$eval('button[data-page-code="EQR_WORKBENCH"][data-level="HIDDEN"]', (b) => b.getAttribute('aria-pressed'))) === 'true');

    T.section('Integration health: cards, queue in plain language');
    await env.open('/vp/shell/admin/integration-health');
    await page.waitForSelector('.er-ih-card', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.check('INT-11 is down, first', (await env.text('.er-ih-card >> nth=0')).includes('INT-11') && (await env.text('.er-ih-card >> nth=0')).includes('Down'));
    T.check('the banner says the sign-in failed and the fix', (await env.text('.er-ih-down')).includes('sign-in') && (await env.text('.er-ih-down')).includes('Fix:'));
    T.check('a closed task reads as words', (await env.text('.er-ih-queue')).includes('closed for charges'));
    T.check('the dead letter entry is in the queue', (await env.text('.er-ih-queue')).includes('retries gave up'));
    T.check('the held item is explained', (await env.text('.er-ih-queue')).includes('EX-300'));
    T.check('an INFO log is not an exception', !(await env.text('.er-ih-queue')).includes('audit only'));
    shots.push(await env.shot('integration-health.png'));

    T.section('Run again: confirm, lock check, POST /int-configs/{syncCode}/run');
    env.writes.length = 0;
    env.calls.length = 0;
    await page.click('.er-ih-qrow button[data-sync="EQUIP_ITEM_REFRESH_SYNC"]');
    await page.waitForSelector('.er-ih-confirm');
    T.check('the confirmation says what a run does', (await env.text('.er-ih-confirm')).includes('Class and subclass are never touched'));
    T.eq('nothing is sent before confirming', env.writes.length, 0);
    await page.click('.er-ih-confirm button[data-confirmed="yes"]');
    await page.waitForTimeout(1500);
    T.eq('one POST to run the sync', env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', '')).join(' > '), 'POST /int-configs/EQUIP_ITEM_REFRESH_SYNC/run');
    const lockAt = env.calls.findIndex((c) => c.includes('/fusion-sync/lock'));
    const runAt = env.calls.findIndex((c) => c.includes('/int-configs/'));
    T.check('the lock is read first', lockAt >= 0 && lockAt < runAt);
    T.check('the start is reported', (await env.text('.er-ih-result')).includes('started'));

    T.section('Apply again: POST /fusion-sync/refresh-units, never a snapshot');
    env.writes.length = 0;
    await page.click('.er-ih-qrow button[data-sync="EQUIP_FUSION_REFRESH"]');
    await page.waitForSelector('.er-ih-confirm');
    await page.click('.er-ih-confirm button[data-confirmed="yes"]');
    await page.waitForTimeout(1500);
    T.eq('refresh-units with snapshot N', JSON.stringify(env.writes.map((w) => [w.method, w.path.replace('/equiprite/v1', ''), w.body])),
      JSON.stringify([['POST', '/fusion-sync/refresh-units', { snapshot: 'N' }]]));
    T.check('the counts are reported', (await env.text('.er-ih-result')).includes('12 serials'));

    T.section('a sync holding the lock stops a run');
    lockState.held = true;
    env.writes.length = 0;
    await page.click('.er-ih-qrow button[data-sync="EQUIP_ITEM_REFRESH_SYNC"]');
    await page.waitForSelector('.er-ih-confirm');
    await page.click('.er-ih-confirm button[data-confirmed="yes"]');
    await page.waitForTimeout(1200);
    T.eq('nothing is started', env.writes.length, 0);
    T.check('it says who holds it', (await env.text('.er-ih-result')).includes('A Sync from Fusion'));
    lockState.held = false;

    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('insights-admin-failed.png').catch(() => {});
  } finally {
    console.log('\nScreenshots:\n  ' + shots.join('\n  '));
    if (env.errors.length) console.log('\nConsole:\n  ' + env.errors.join('\n  '));
    await env.close();
    T.report();
  }
})();
