'use strict';
/*
 * My requests in a real browser: request cards with their equipment, expanding a card, the Equipment view, search.
 * Needs `npm run build`. Run: node tests/e2e/my-requests.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const REQ = (id, status, start, end, extra) => Object.assign({ eqrEquipmentRequestId: id, requestNumber: 'REQ-178650000' + id, status,
  startDate: start, endDate: end, projectName: 'EPC_MO_Operations', taskName: 'Process Design Package', requestorName: 'User Rite',
  requestOrigin: 'Internal', customerName: '01TechVantage Solutions LLC', lines: 2 }, extra || {});
const ROWS = [
  REQ(41, 'IN_PROCESS', day(-21), day(1)),
  REQ(42, 'DEPLOYED', day(-10), day(12), { projectName: 'AFE-1007-9GRI Testing9 Seventh Avenue Ext', taskName: 'Foundation', customerName: 'US2 Legal Entity' }),
  REQ(43, 'SUBMITTED', day(5), day(20), { lines: 3 }),
  REQ(44, 'SHIP_TO_SITE', day(-2), day(30), { requestOrigin: 'External', projectName: null, customerName: 'Lone Star Paving' }),
];
const LINES = [
  { requestNumber: 'REQ-17865000041', lineNumber: 1, equipmentName: 'EQ-00001 CAT 390F Excavator', className: 'Excavators', qty: 1, requestStatus: 'IN_PROCESS', allocationStatus: 'ALLOCATED' },
  { requestNumber: 'REQ-17865000041', lineNumber: 2, equipmentName: 'EQ-00102 Volvo A30 Dump Truck', className: 'Trucks', qty: 2, requestStatus: 'IN_PROCESS' },
  { requestNumber: 'REQ-17865000042', lineNumber: 1, equipmentName: 'EQ-00230 Light Tower', className: 'Lighting', qty: 4, requestStatus: 'DEPLOYED', deploymentLocation: 'Seventh Avenue site', utilPct: 64 },
  { requestNumber: 'REQ-17865000044', lineNumber: 1, equipmentName: 'EQ-00310 Roller 10t', className: 'Rollers', qty: 1, requestStatus: 'SHIP_TO_SITE' },
];
// REQ-…43 is not in the bulk view: its lines come from request-detail-lines when the card is opened.
const DETAIL_43 = [
  { lineId: 1, equipmentName: 'EQ-00009 Hitachi ZX350 Excavator', equipmentClass: 'Excavators', quantity: 1, lineStatus: 'SUBMITTED' },
  { lineId: 2, equipmentName: 'EQ-00440 Generator 100kVA', equipmentClass: 'Generators', quantity: 2, lineStatus: 'SUBMITTED' },
];

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/my-requests')) return res.json({ data: ROWS });
  if (p.endsWith('/views/my-request-lines')) return res.json({ data: LINES });
  if (p.endsWith('/views/request-detail-lines')) {
    return res.json({ data: req.query.get('requestId') === '43' ? DETAIL_43 : [] });
  }
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19200, handle });
  const { page } = env;
  try {
    T.section('Requests: a card per request, its equipment on the card');
    await env.open('/vp/shell/request/my-requests');
    await page.waitForSelector('.er-mr-card', { timeout: 30000 });
    await page.waitForTimeout(600);
    T.eq('a card per request', await page.$$eval('.er-mr-card', (c) => c.length), 4);
    T.check('request numbers are shown whole', await page.$$eval('.er-mr-number', (bs) => bs.every((b) => b.scrollWidth <= b.clientWidth + 1 && !b.innerText.includes('…'))));
    T.check('long project names are not cut', (await env.text('.er-mr-card[data-number="REQ-17865000042"]')).includes('AFE-1007-9GRI Testing9 Seventh Avenue Ext'));
    const chips41 = await page.$$eval('.er-mr-card[data-number="REQ-17865000041"] .er-eqchip', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    T.eq('equipment on the card, with quantities', chips41.join(' | '), 'EQ-00001 CAT 390F Excavator ×1 | EQ-00102 Volvo A30 Dump Truck ×2');
    T.check('the rental window says where today is', /Day \d+ of \d+/.test(await env.text('.er-mr-card[data-number="REQ-17865000041"] .er-mr-when')));
    T.check('the header counts the equipment', (await env.text('.er-band-sub')).includes('8 pieces of equipment'));
    const fill = (num) => page.$eval(`.er-mr-card[data-number="${num}"] .er-mr-progress`, (t) => Math.round((t.firstElementChild.getBoundingClientRect().width / t.getBoundingClientRect().width) * 100));
    T.eq('an upcoming rental has an empty bar', await fill('REQ-17865000043'), 0);
    const running = await fill('REQ-17865000042');
    T.check('a running rental fills its share of the bar', running > 20 && running < 80, String(running));
    T.check('no sideways scroll on the page', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    T.section('Show equipment: in place, no navigation');
    await page.click('.er-mr-card[data-number="REQ-17865000042"] button[aria-expanded]');
    await page.waitForSelector('.er-mr-card[data-number="REQ-17865000042"] .er-grid--mrlines');
    T.check('the full list opens inside the card', (await env.text('.er-mr-card[data-number="REQ-17865000042"] .er-mr-lines')).includes('Seventh Avenue site'));
    T.check('still on My requests', page.url().includes('/my-requests'));
    await page.click('.er-mr-card[data-number="REQ-17865000043"] button[aria-expanded]');
    await page.waitForSelector('.er-mr-card[data-number="REQ-17865000043"] .er-grid--mrlines', { timeout: 10000 });
    T.check('a request the bulk view missed loads its own lines', (await env.text('.er-mr-card[data-number="REQ-17865000043"] .er-mr-lines')).includes('Generator 100kVA')
      && env.calls.some((c) => c.includes('/views/request-detail-lines?') && c.includes('requestId=43')));
    T.check('...and its chips appear too', (await env.text('.er-mr-card[data-number="REQ-17865000043"] .er-mr-chips')).includes('Hitachi ZX350'));
    await env.shot('my-requests-cards.png');

    T.section('search by equipment');
    await page.fill('.er-search input', 'excavator');
    await page.waitForTimeout(500);
    T.eq('requests holding an excavator, newest first', (await page.$$eval('.er-mr-card', (c) => c.map((x) => x.dataset.number))).join(','), 'REQ-17865000043,REQ-17865000041');
    await page.fill('.er-search input', '');
    await page.waitForTimeout(300);

    T.section('Equipment view');
    await page.click('button[data-view="equipment"]');
    await page.waitForSelector('.er-grid--equip');
    await page.waitForTimeout(300);
    T.eq('a row per piece of equipment (bulk + opened)', await page.$$eval('.er-grid--equip .er-grid-row:not(.er-grid-head)', (r) => r.length), 6);
    const chipText = (await env.text('.er-page > .er-chip-row')).replace(/\s+/g, ' ');
    T.check('chips count equipment by its own status', chipText.includes('All 6') && chipText.includes('On site 1') && chipText.includes('On the way 1'));
    await page.click('button[data-group="onsite"]');
    await page.waitForTimeout(300);
    T.check('the Equipment table fits the page', await page.$eval('.er-grid--equip', (g) => g.scrollWidth <= g.parentElement.clientWidth + 1));
    T.check('On site: the light tower, its place and use', (await env.text('.er-grid--equip')).includes('EQ-00230 Light Tower') && (await env.text('.er-grid--equip')).includes('64%'));
    await env.shot('my-requests-equipment.png');
    await page.click('.er-grid--equip .er-link');
    await page.waitForURL(/request-detail/, { timeout: 15000 });
    T.check('a request number opens Request detail', page.url().includes('requestNumericId=42'));
    T.eq('reading only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('my-requests-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
