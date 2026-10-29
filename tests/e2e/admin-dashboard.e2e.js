'use strict';
/*
 * The Administrator's Home and "View as" in a real browser. Needs `npm run build`.
 * Run: node tests/e2e/admin-dashboard.e2e.js   (screenshots in the OS temp folder, equiprite-e2e/)
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const REQ = (id, status, start, end, extra) => Object.assign({ eqrEquipmentRequestId: id, requestNumber: 'REQ-' + id, status,
  startDate: start, endDate: end, projectName: 'Pipeline North', taskName: '2.1 Trenching', requestorName: 'Priya Raman', requestOrigin: 'Internal', lines: 2 }, extra || {});
const REQUESTS = [
  REQ(10501, 'DRAFT', day(-5), day(10), { projectName: 'Plant Expansion B', requestorName: 'John Dunbar' }),
  REQ(10503, 'SUBMITTED', day(2), day(30)),
  REQ(10504, 'SUBMITTED', day(20), day(40), { projectName: 'Substation 4' }),
  REQ(10505, 'IN_PROCESS', day(6), day(30)),
  REQ(10506, 'PICK_INITIATED', day(1), day(15)),
  REQ(10482, 'DEPLOYED', day(-30), day(-4)),
  REQ(10490, 'DEPLOYED', day(-10), day(10)),
  REQ(10498, 'SHIP_TO_SITE', day(-20), day(-12), { requestOrigin: 'External', customerName: 'Lone Star Paving', projectName: null, requestorName: 'Maria Torres' }),
  REQ(10470, 'RETURN_IN_PROCESS', day(-40), day(-2)),
  REQ(10377, 'CLOSED', day(-60), day(-30)),
];
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/my-requests')) return res.json({ data: REQUESTS });
  if (p.endsWith('/views/yard-stock')) return res.json({ data: [{ groupKey: 'RENTED', count: 118 }, { groupKey: 'AVAILABLE', count: 64 }, { groupKey: 'MAINTENANCE', count: 9 }] });
  if (p.endsWith('/views/timesheet-approvals')) return res.json({ data: [{ timesheetStatus: 'SUBMITTED' }, { timesheetStatus: 'SUBMITTED' }, { timesheetStatus: 'SUBMITTED' }] });
  if (p.endsWith('/views/post-cost')) return res.json({ data: [
    { requestNumber: 'REQ-10482', eqrEquipmentRequestId: 10482, weekStartDate: day(-14), totalBillCost: 8400, totalHours: 80 },
    { requestNumber: 'REQ-10482', eqrEquipmentRequestId: 10482, weekStartDate: day(-7), totalBillCost: 8400, totalHours: 80 }] });
  if (p.endsWith('/integration-events')) return res.json({ data: [
    { integrationCode: 'INT-07', status: 'SUCCESS', createdAt: ago(2) }, { integrationCode: 'INT-07', status: 'SUCCESS', createdAt: ago(1) }] });
  if (p.endsWith('/error-logs')) return res.json({ data: [] });
  if (p.endsWith('/dead-letter-queue')) return res.json({ data: [{ id: 1, status: 'OPEN' }, { id: 2, status: 'OPEN' }] });
  if (p.endsWith('/job-run-logs')) return res.json({ data: [
    { id: 9, jobName: 'EQUIP_FUSION_REFRESH', status: 'FAILED', startedAt: ago(1), notes: 'Fusion returned 401 Unauthorized' }] });
  if (p.endsWith('/fusion-sync/exceptions')) return res.json({ data: [] });
  if (p.endsWith('/fusion-sync/lock')) return res.json({});
  if (p.endsWith('/equipment-certifications')) return res.json({ data: [{ id: 1, expiryDate: day(-3), status: 'EXPIRED' }, { id: 2, expiryDate: day(12) }] });
  if (p.endsWith('/customer-portal-users')) return res.json({ data: [{ id: 1, status: 'LOCKED' }, { id: 2, status: 'ACTIVE' }] });
  if (p.endsWith('/audit-trail')) return res.json({ data: [{ id: 3, changedDate: ago(20), changedBy: 'priya.raman', changeSummary: 'TIMESHEETS_ENABLED switched on' }] });
  if (p.endsWith('/rbac/app-roles')) return res.json({ data: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }] });
  if (p.endsWith('/views/workbench-requests')) return res.json({ data: [] });
  if (p.endsWith('/views/equipment-master')) return res.json({ data: [], recordCount: 191 });
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19190, handle, sessionRole: 'EQUIP_ADMIN', username: 'priya.raman' });
  const { page } = env;
  try {
    T.section('the Administrator lands on the Admin Home');
    await env.open('/');
    await page.waitForSelector('.er-att-list, .er-ad-clear', { timeout: 30000 });
    await page.waitForTimeout(800);
    T.check('title', (await env.text('.er-band')).includes('Administration') || (await env.text('.er-band-sub')).length > 0);
    const kpis = await page.$$eval('.er-kpi', (ks) => ks.map((k) => k.dataset.kpi + '=' + k.querySelector('.er-kpi-value').innerText.trim()));
    T.eq('FDD 7.1.3 KPI bar', kpis.slice(0, 5).join(' '), 'active=8 deployed=118 approvals=2 overdue=2 utilization=62%');
    const att = await page.$$eval('.er-att', (as) => as.map((a) => a.dataset.key));
    T.eq('attention, most severe first', att.join(','), 'integration-down,overdue,approvals-urgent,certificates,at-risk,dlq,timesheets,post-costs,locked-users,drafts');
    T.check('the down integration explains itself in plain words, with the fix', /refused EquipRite's sign-in.*Update the stored Fusion credential/.test(await env.text('.er-att--critical')));
    T.check('cost waiting to post comes from the Finance rule', (await env.text('.er-att[data-key="post-costs"]')).includes('$16,800'));
    const pipe = await page.$$eval('.er-stage--draft .er-bar-value, .er-stage--submitted .er-bar-value, .er-stage--onsite .er-bar-value', (vs) => vs.map((v) => v.innerText.trim()).join(','));
    T.eq('draft, submitted, on site', pipe, '1,2,2');
    T.check('fleet utilisation', (await env.text('.er-ad-big')).includes('62%'));
    T.check('modules show on/off', (await page.$$eval('.er-mod--on', (m) => m.length)) >= 2);
    T.check('recent change listed', (await env.text('.er-ad-grid')).includes('TIMESHEETS_ENABLED switched on'));
    T.eq('latest requests table: the newest 8', await page.$$eval('.er-grid--recent .er-grid-row:not(.er-grid-head)', (r) => r.length), 8);
    await env.shot('admin-home.png');

    T.section('View as');
    const chips = await page.$$eval('.er-viewas button', (bs) => bs.map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
    T.eq('every persona, the user\'s own marked', chips.join(' | '),
      'Administrator you | Equipment Manager | Equipment Requestor | Inspection | Timekeeper | Time Approver | Finance');
    await page.click('.er-viewas button[data-role="EQUIP_MGR"]');
    await page.waitForSelector('#homeTable', { timeout: 20000 });
    await page.waitForTimeout(800);
    T.check('the Equipment Manager Home replaces the Admin one', !(await page.$('.er-att-list')) && (await env.text('.er-kpis')).includes('TOTAL EQUIPMENT'));
    T.check('a preview says so', (await env.text('.er-viewas')).includes('Previewing the Equipment Manager Home'));
    await env.shot('admin-view-as-manager.png');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#homeTable', { timeout: 60000 });
    T.check('the choice is kept on reload', (await env.text('.er-viewas')).includes('Previewing the Equipment Manager Home'));
    await page.click('.er-viewas button[data-role="EQUIP_ADMIN"]');
    await page.waitForSelector('.er-att-list', { timeout: 20000 });
    T.check('back to the Admin Home', !(await env.text('.er-viewas')).includes('Previewing'));

    T.section('actions go where they say');
    await page.click('.er-att[data-key="overdue"] button');
    await page.waitForURL(/logistics\/receipt/, { timeout: 20000 });
    T.check('overdue returns open Receipt & returns', page.url().includes('/logistics/receipt'));
    T.eq('only GET calls (a dashboard writes nothing)', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('admin-home-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
