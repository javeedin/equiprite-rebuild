'use strict';
/*
 * EquipRite Next, Requests and a request's tab, in a real browser: each request read from its equipment, the views
 * (list, board, equipment), chips and search, export (the files are checked), a request in its own tab.
 * Needs `npm run build`. Run: node tests/e2e/next-requests.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const REQS = [
  { eqrEquipmentRequestId: 1764, requestNumber: 'REQ-1764', status: 'IN_PROCESS', startDate: day(-22), endDate: day(0), projectName: 'EPC_MO_Operations',
    taskName: 'Process Design Package', requestorName: 'User Rite', requestOrigin: 'Internal' },
  { eqrEquipmentRequestId: 1765, requestNumber: 'REQ-1765', status: 'IN_PROCESS', startDate: day(7), endDate: day(30), projectName: 'Plant B',
    requestorName: 'Rite.User', requestOrigin: 'Internal' },
  { eqrEquipmentRequestId: 1766, requestNumber: 'REQ-1766', status: 'SUBMITTED', startDate: day(10), endDate: day(20), customerName: 'Lone Star Paving',
    requestorName: 'Dana Cole', requestOrigin: 'External' },
  { eqrEquipmentRequestId: 1767, requestNumber: 'REQ-1767', status: 'IN_PROCESS', startDate: day(-10), endDate: day(12), projectName: '=HYPERLINK("x")',
    requestorName: 'User Rite', requestOrigin: 'Internal' },
];
const LINES = [
  { requestNumber: 'REQ-1764', lineNumber: 1, equipmentName: 'Komatsu D65EX-18 Dozer', className: 'Earthmoving', qty: 1, lineStatus: 'CLOSED', allocationStatus: 'ALLOCATED' },
  { requestNumber: 'REQ-1764', lineNumber: 2, equipmentName: 'Bobcat S76 Skid Steer Loader', className: 'Earthmoving', qty: 1, lineStatus: 'IN_PROCESS', allocationStatus: 'PENDING' },
  { requestNumber: 'REQ-1764', lineNumber: 3, equipmentName: 'Mack Granite Mixer Truck', className: 'Transport', qty: 1, lineStatus: 'IN_PROCESS', allocationStatus: 'PENDING' },
  { requestNumber: 'REQ-1765', lineNumber: 1, equipmentName: 'CAT 320 Excavator', className: 'Excavators', qty: 1, lineStatus: 'SHIP_TO_SITE' },
  { requestNumber: 'REQ-1765', lineNumber: 2, equipmentName: 'Volvo A30 Dump Truck', className: 'Trucks', qty: 1, lineStatus: 'SCHEDULED_FOR_PICKING' },
  { requestNumber: 'REQ-1765', lineNumber: 3, equipmentName: 'Roller 10t', className: 'Rollers', qty: 1, lineStatus: 'ALLOCATED' },
  { requestNumber: 'REQ-1766', lineNumber: 1, equipmentName: 'Light Tower', className: 'Lighting', qty: 4, lineStatus: 'SUBMITTED' },
  { requestNumber: 'REQ-1767', lineNumber: 1, equipmentName: 'Generator 100kVA', className: 'Power', qty: 2, lineStatus: 'DEPLOYED', deploymentLocation: 'Pier A' },
];
const DETAIL = (id) => LINES.filter((l) => l.requestNumber === 'REQ-' + id).map((l, i) => Object.assign({}, l, {
  lineId: id * 10 + i, quantity: l.qty, allocatedSerial: l.lineStatus === 'CLOSED' ? 'KD-0018' : '', requestStatus: REQS.find((r) => r.eqrEquipmentRequestId === id).status,
  projectName: REQS.find((r) => r.eqrEquipmentRequestId === id).projectName, requestedStartDate: REQS.find((r) => r.eqrEquipmentRequestId === id).startDate,
  requestedEndDate: REQS.find((r) => r.eqrEquipmentRequestId === id).endDate, deploymentLocation: 'Pier A', requestorName: 'User Rite', billRate: 1200, priceUom: 'DAY',
  allocStatus: l.allocationStatus }));

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/my-requests')) return res.json({ data: REQS });
  if (p.endsWith('/views/my-request-lines')) return res.json({ data: LINES });
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: DETAIL(Number(req.query.get('requestId'))) });
  const m = /\/equipment-requests\/(\d+)$/.exec(p);
  if (m) return res.json({ id: Number(m[1]), requestNumber: 'REQ-' + m[1], status: 'IN_PROCESS', contractNumber: 'K-77' });
  return undefined;
}

async function download(page, fmt) {
  await page.click('#reqExport');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.nx-menu-item[data-format="${fmt}"]`)]);
  const file = path.join(os.tmpdir(), 'next-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}

(async () => {
  const env = await E.start({ port: 19260, handle, app: 'next' });
  const { page } = env;
  try {
    T.section('the list');
    await env.open('/?open=requests');
    await page.waitForSelector('.nx-grid--req .nx-row--click', { timeout: 30000 });
    await page.waitForTimeout(400);
    T.eq('the summary', await env.text('#reqSummary'), '4 requests · 12 pieces of equipment · 1 late');
    const status = async (n) => page.$eval(`.nx-row--click[data-number="${n}"] .nx-pill`, (e) => e.innerText.trim());
    T.eq('read from the equipment, never IN PROCESS', [await status('REQ-1764'), await status('REQ-1765'), await status('REQ-1767')].join(' | '),
      'Partly returned · 1 of 3 | Partly shipped · 1 of 3 | On site');
    T.check('next step and late on the row', (await env.text('.nx-row--click[data-number="REQ-1764"]')).includes('Equipment Manager to assign a unit (2 of 3)')
      && (await env.text('.nx-row--click[data-number="REQ-1764"]')).includes('2 not shipped, due'));
    T.eq('a bar segment per piece, by stage', await page.$$eval('.nx-row--click[data-number="REQ-1765"] .nx-jbar-seg', (s) => s.map((x) => x.className.split('--')[1]).join()), 'out,ready,ready');
    T.eq('chips, Late first', (await page.$$eval('.nx-chips[aria-label="Where the equipment is"] .nx-chip', (c) => c.map((x) => x.dataset.value))).slice(0, 3).join(), 'all,late,action');
    await page.click('.nx-chip[data-value="late"]');
    await page.waitForTimeout(300);
    T.eq('Late', await page.$$eval('.nx-row--click', (r) => r.map((x) => x.dataset.number).join()), 'REQ-1764');
    await page.click('.nx-chip[data-value="all"]');
    await page.fill('.nx-search input', 'mixer');
    await page.waitForTimeout(300);
    T.eq('search finds a request by its equipment', await page.$$eval('.nx-row--click', (r) => r.map((x) => x.dataset.number).join()), 'REQ-1764');
    await page.fill('.nx-search input', '');
    await page.waitForTimeout(200);
    await page.click('.nx-sort[data-key="party"]');
    await page.waitForTimeout(200);
    T.eq('sort by project or customer', (await page.$$eval('.nx-row--click', (r) => r.map((x) => x.dataset.number))).join(), 'REQ-1767,REQ-1764,REQ-1766,REQ-1765');
    await page.click('.nx-sort[data-key="number"]');
    await page.waitForTimeout(200);
    T.check('a manager can pick project or customer requests', !!(await page.$('.nx-chip[data-value="EXTERNAL"]')));
    await env.shot('next-requests-list.png');

    T.section('export what is shown');
    const xl = await download(page, 'xlsx');
    T.check('Excel file name', /^equiprite-requests-\d{4}-\d{2}-\d{2}\.xlsx$/.test(xl.name), xl.name);
    let read = '';
    try {
      read = execFileSync('python3', ['-I', '-c', 'import sys, openpyxl\nws = openpyxl.load_workbook(sys.argv[1]).active\nrows = list(ws.iter_rows(values_only=True))\nprint(len(rows)); print(rows[0][:5]); print([r[0] for r in rows[1:]]); print(rows[1][4]); print([r for r in rows if r[0] == "REQ-1767"][0][2])', xl.file], { encoding: 'utf8' }).trim();
    } catch (e) { read = 'unavailable'; }
    if (read !== 'unavailable') {
      T.eq('the Excel rows: header + 4, the columns, the status words', read.split('\n').join(' | '),
        "5 | ('Request', 'Type', 'Project or customer', 'Task', 'Status') | ['REQ-1767', 'REQ-1766', 'REQ-1765', 'REQ-1764'] | On site | '=HYPERLINK(\"x\")");
    }
    await page.click('.nx-chip[data-value="late"]');
    await page.waitForTimeout(300);
    const csv = await download(page, 'csv');
    const text = fs.readFileSync(csv.file, 'utf8');
    T.check('CSV exports only what the chip shows', text.split('\r\n').filter(Boolean).length === 2 && text.includes('REQ-1764') && !text.includes('REQ-1765'));
    await page.click('.nx-chip[data-value="all"]');

    T.section('board and equipment');
    await page.click('button[data-value="board"]');
    await page.waitForSelector('.nx-lane');
    const lanes = await page.$$eval('.nx-lane', (l) => l.map((x) => x.dataset.lane + ':' + x.querySelectorAll('.nx-rcard').length).join(' '));
    T.eq('a column per stage, each request where it is held up', lanes, 'action:0 approval:1 ready:2 out:0 onsite:1 back:0 done:0');
    await env.shot('next-requests-board.png');
    await page.click('button[data-value="equipment"]');
    await page.waitForSelector('.nx-grid--eq');
    T.eq('a row per piece', await page.$$eval('.nx-grid--eq .nx-row--click', (r) => r.length), 8);
    T.check('each piece in words, the unit column says when none is assigned', (await env.text('.nx-grid--eq')).includes('Approved, no unit assigned yet')
      && (await env.text('.nx-grid--eq')).includes('No unit assigned yet'));
    await page.click('button[data-value="list"]');
    await page.waitForSelector('.nx-grid--req');

    T.section('a request in its own tab');
    await page.click('.nx-row--click[data-number="REQ-1764"] .nx-req-num');
    await page.waitForSelector('.nx-record-title', { timeout: 20000 });
    await page.waitForTimeout(500);
    T.eq('it opens in a tab named after it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'request:1764=REQ-1764');
    T.eq('the heading reads from the equipment', await env.text('.nx-record-pill'), 'Partly returned · 1 of 3');
    T.eq('the journey: pieces at each stop', await page.$$eval('.nx-stop', (s) => s.map((x) => x.dataset.stop + ':' + x.className.match(/nx-stop--(\w+)/)[1]).join(' ')),
      'approval:done ready:here out:passed onsite:passed back:passed done:here');
    T.check('next and late', (await env.text('.nx-journey')).includes('Next: Equipment Manager to assign a unit (2 of 3)') && (await env.text('.nx-journey')).includes('22 days late'));
    T.check('lines in words, the unit when assigned', (await env.text('.nx-grid--lines')).includes('Back at the yard, closed') && (await env.text('.nx-grid--lines')).includes('KD-0018'));
    T.check('facts: contract from the header', (await env.text('.nx-facts')).includes('K-77'));
    T.eq('act on it in New (until Next has those steps)', await page.getAttribute('#recInNew', 'href'), env.newUrl + '/vp/shell/request/request-detail?requestId=REQ-1764&requestNumericId=1764');
    await env.shot('next-request-record.png');
    await page.click('.nx-tab-btn[data-id="requests"]');
    await page.waitForTimeout(300);
    T.check('back on the list, as it was left', (await page.$$eval('.nx-row--click', (r) => r.length)) === 4 && (await page.isVisible('.nx-grid--req')));
    T.check('no sideways scroll on the page', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-requests-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
