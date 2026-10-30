'use strict';
/*
 * EquipRite Next, Commercial (Rates and Agreements), in a real browser:
 *   Rates: who uses each schedule, the six periods per class with where each tier applies, the margin check, Try a
 *   rate ("17 days of a 320 excavator"), editing a rate and Save (New's calls, bodies and order), adding a period,
 *   removing a rate (asked first, deleted at once), export; a read-only role sees the rates without inputs.
 *   Agreements: what is active, ending soon, waiting for approval; chips, search, sort, export; an agreement in its own
 *   tab: lines and rates, Create request (the draftStorage hand-off, then the New request tab), Approve, Edit and Save,
 *   Reject (asked first), New agreement (numbered PREFIX-####, created as a draft, opened in its own tab).
 * Needs `npm run build`. Run: node tests/e2e/next-commercial.e2e.js
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
const iso = (d) => d + 'T00:00:00Z';

// ── Rates ────────────────────────────────────────────────────────────────────────────────────────────────
const SCHEDULES = [
  { id: 9, scheduleName: 'US Excavators 2026', scheduleCode: 'RS-US-EXC-2026', description: 'Base rates for the Gulf coast', currencyCode: 'USD',
    effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: iso(day(20)), isActiveFlag: 'Y', yardOrgId: 300, objectVersionNumber: 2 },
  { id: 10, scheduleName: 'Default fallback', scheduleCode: 'RS-DEFAULT', currencyCode: 'USD', effectiveFrom: '2026-01-01T00:00:00Z', isActiveFlag: 'N' },
  { id: 11, scheduleName: 'Pipeline North special', scheduleCode: 'RS-PN', currencyCode: 'USD', effectiveFrom: '2026-03-01T00:00:00Z',
    effectiveTo: '2027-02-28T00:00:00Z', isActiveFlag: 'Y', projectRefId: 7001, projectName: 'Pipeline North', taskRefId: 7101, taskName: 'Phase 2' },
  { id: 12, scheduleName: 'Odessa yard rates', scheduleCode: 'RS-ODESSA', currencyCode: 'USD', effectiveFrom: '2026-01-01T00:00:00Z',
    effectiveTo: '2026-12-31T00:00:00Z', isActiveFlag: 'Y', yardOrgId: 400 },
];
const EXC = { equipmentClassId: 1, equipmentClassName: 'Excavators', equipmentSubclassId: 11, equipmentSubclassName: 'Crawler', equipmentName: 'CAT 320 Excavator',
  calcMethod: 'COMPLETE_PERIOD', rateType: 'USAGE', rateScheduleId: 9, objectVersionNumber: 1 };
const RATE_LINES = [
  Object.assign({ id: 1, periodSeq: 1, periodType: 'DAILY', rateUom: 'DAY', calcBasis: 'DAILY', fromUnit: 0, periodAmount: 880, costRate: 880, billRate: 1240 }, EXC),
  Object.assign({ id: 2, periodSeq: 2, periodType: 'WEEKLY', rateUom: 'WEEK', calcBasis: 'WEEKLY', fromUnit: 5, periodAmount: 3900, costRate: 557.1429, billRate: 4700 }, EXC),
  Object.assign({ id: 3, periodSeq: 3, periodType: 'MONTHLY', rateUom: 'MONTH', calcBasis: 'MONTHLY', fromUnit: 30, periodAmount: 12800, costRate: 426.6667, billRate: 12000 }, EXC),
  { id: 4, rateScheduleId: 9, periodSeq: 4, equipmentClassId: 2, equipmentClassName: 'Generators', equipmentName: 'Generator 100 kVA', periodType: 'HOURLY', rateUom: 'HOUR',
    calcMethod: 'UTILIZED_DURATION', calcBasis: 'HOURLY', rateType: 'USAGE', fromUnit: 0, periodAmount: 120, costRate: 120, billRate: 175, objectVersionNumber: 1 },
  { id: 99, rateScheduleId: 10, periodSeq: 1, equipmentClassId: 1, equipmentClassName: 'Excavators', periodType: 'DAILY', calcMethod: 'COMPLETE_PERIOD', fromUnit: 0, costRate: 900 },
];

// ── Agreements ───────────────────────────────────────────────────────────────────────────────────────────
const agr = {
  31: { id: 31, agreementNumber: 'RNT-0002', agreementName: 'Lone Star MSA', customerName: 'Lone Star Paving', agreementType: 'RENTAL', status: 'ACTIVE',
    effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: iso(day(45)), lines: 2, fusionCustomerId: 900, notes: 'Minimum one week', currencyCode: 'USD', objectVersionNumber: 4 },
  30: { id: 30, agreementNumber: 'RNT-0001', agreementName: 'Gulf pipeline 2025', customerName: 'Gulf Midstream', agreementType: 'RENTAL', status: 'EXPIRED',
    effectiveFrom: '2025-01-01T00:00:00Z', effectiveTo: '2025-12-31T00:00:00Z', lines: 4, fusionCustomerId: 901, objectVersionNumber: 7 },
  32: { id: 32, agreementNumber: 'ST-0001', agreementName: 'Short term trench kit', customerName: 'Acme Utilities', agreementType: 'SHORT_TERM', status: 'DRAFT',
    effectiveFrom: iso(day(2)), effectiveTo: iso(day(90)), lines: 1, fusionCustomerId: 902, objectVersionNumber: 1 },
  33: { id: 33, agreementNumber: 'RNT-0003', agreementName: 'Permian 2027', customerName: 'Basin Energy', agreementType: 'RENTAL', status: 'PENDING',
    effectiveFrom: iso(day(60)), effectiveTo: '2027-12-31T00:00:00Z', lines: 1, fusionCustomerId: 903, objectVersionNumber: 2 },
};
const CUSTOMERS = { 900: 'Lone Star Paving', 901: 'Gulf Midstream', 902: 'Acme Utilities', 903: 'Basin Energy' };
const VIEW_LINES = {
  'RNT-0002': [
    { lineNumber: 1, equipmentName: 'CAT 320 Excavator', className: 'Excavators', subClassName: 'Crawler', qty: 1, billRate: 1050, priceUom: 'DAY', estCost: 0, totalAgreementCost: 48000 },
    { lineNumber: 2, equipmentName: '', description: 'Any vibratory roller', className: 'Rollers', subClassName: 'Vibratory', qty: 1, billRate: 720, priceUom: 'DAY' }],
  'ST-0001': [{ lineNumber: 1, equipmentName: 'Trench box 8x20', className: 'Shoring', subClassName: 'Trench boxes', qty: 2, billRate: 0, priceUom: 'DAY' }],
  'RNT-0003': [{ lineNumber: 1, equipmentName: 'Light tower LT6', className: 'Lighting', subClassName: '', qty: 1, billRate: 95, priceUom: 'DAY' }],
};
const RAW_LINES = {
  31: [{ id: 11, agreementHeaderId: 31, lineNumber: 1, equipmentClassId: 1, equipmentMasterId: 101, unitPrice: 1050, priceUom: 'DAY', description: '' },
    { id: 12, agreementHeaderId: 31, lineNumber: 2, equipmentClassId: 4, equipmentMasterId: null, unitPrice: 720, priceUom: 'DAY', description: 'Any vibratory roller' }],
  32: [{ id: 41, agreementHeaderId: 32, lineNumber: 1, equipmentClassId: 6, equipmentMasterId: 601, unitPrice: null, priceUom: 'DAY', description: '' }],
  33: [{ id: 51, agreementHeaderId: 33, lineNumber: 1, equipmentClassId: 7, equipmentMasterId: 701, unitPrice: 95, priceUom: 'DAY', description: '' }],
};
const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 4, className: 'Rollers' }, { id: 6, className: 'Shoring' }, { id: 7, className: 'Lighting' }];
const SUBCLASSES = { 4: [{ id: 41, subclassName: 'Vibratory' }] };
const MASTERS = [{ id: 101, equipmentName: 'CAT 320 Excavator', equipmentClassId: 1 }, { id: 205, equipmentName: 'Vibratory roller CS56', equipmentClassId: 4, equipmentSubclassId: 41 },
  { id: 206, equipmentName: 'Vibratory roller CS44', equipmentClassId: 4, equipmentSubclassId: 41 }];

function handle(req, res) {
  const p = req.path;
  const m = req.method;
  // settings: business unit 2 takes Fusion PPM rates, so the Odessa yard's schedule is not used
  if (p.endsWith('/conf-equipment-settings')) return res.json({ data: [{ businessUnitId: 1, rateSource: 'EQUIPRITE_RATES' }, { businessUnitId: 2, rateSource: 'PPM_RATES' }] });
  if (p === V1 + '/bu-org-mappings') {
    return res.json({ data: [{ orgRole: 'EQUIPMENT_YARD', invOrgId: 300, invOrgName: 'Houston Yard', businessUnitId: 1 },
      { orgRole: 'EQUIPMENT_YARD', invOrgId: 400, invOrgName: 'Odessa Yard', businessUnitId: 2 },
      { orgRole: 'VIRTUAL_PROJECT', invOrgId: 500, invOrgName: 'Not a yard', businessUnitId: 1 }] });
  }
  // rates (a schedule created here is kept as id 14 until it is deleted)
  if (p === V1 + '/rate-schedules' && m === 'GET') return res.json({ data: SCHEDULES });
  if (p === V1 + '/rate-schedules' && m === 'POST') {
    SCHEDULES.push(Object.assign({}, req.json(), { id: 14 }));
    return res.json({ id: 14 }, 201);
  }
  const rs = /\/rate-schedules\/(\d+)$/.exec(p);
  if (rs && m === 'DELETE') {
    const at = SCHEDULES.findIndex((s) => s.id === Number(rs[1]));
    if (at !== -1) SCHEDULES.splice(at, 1);
    return res.json({});
  }
  if (rs) return m === 'GET' ? res.json(SCHEDULES.find((s) => s.id === Number(rs[1])) || {}, SCHEDULES.find((s) => s.id === Number(rs[1])) ? 200 : 404) : res.json({ id: Number(rs[1]) });
  if (p === V1 + '/rate-period-lines' && m === 'GET') return res.json({ data: RATE_LINES });
  if (/\/rate-period-lines\/\d+$/.test(p)) return res.json({ id: Number(p.split('/').pop()) });
  if (p === V1 + '/rate-period-lines' && m === 'POST') return res.json({ id: 77 }, 201);
  // agreements
  if (p === V1 + '/views/rental-agreements') return res.json({ data: Object.values(agr).map((a) => Object.assign({}, a)) });
  if (p === V1 + '/agreement-headers' && m === 'GET') {
    const a = Object.values(agr).find((x) => x.agreementNumber === req.query.get('agreementNumber'));
    return a ? res.json(a) : res.json({});
  }
  if (p === V1 + '/agreement-headers' && m === 'POST') {
    const b = req.json();
    agr[40] = Object.assign({ id: 40, lines: 0, objectVersionNumber: 1 }, b, { customerName: CUSTOMERS[b.fusionCustomerId] || '' });
    return res.json(agr[40], 201);
  }
  const ah = /\/agreement-headers\/(\d+)$/.exec(p);
  if (ah) {
    const a = agr[Number(ah[1])];
    if (m === 'PATCH' || m === 'PUT') Object.assign(a, req.json());
    return res.json(a);
  }
  if (p === V1 + '/views/rental-agreement-lines') return res.json({ data: VIEW_LINES[req.query.get('agreementNumber')] || [] });
  if (p === V1 + '/agreement-lines' && m === 'GET') return res.json({ data: RAW_LINES[Number(req.query.get('agreementId'))] || [] });
  if (p === V1 + '/agreement-lines' && m === 'POST') return res.json({ id: 88 }, 201);
  if (/\/agreement-lines\/\d+$/.test(p)) return res.json({});
  if (p === V1 + '/conf-agreement-types') return res.json([{ typeCode: 'RENTAL', typeLabel: 'Rental', typePrefix: 'RNT' }, { typeCode: 'SHORT_TERM', typeLabel: 'Short term', typePrefix: 'ST' }]);
  if (p.endsWith('/shippingCustomersLOV')) {
    const q = req.query.get('q') || '';
    const byId = /CustomerId=(\d+)/.exec(q);
    if (byId) return res.json({ items: [{ CustomerId: Number(byId[1]), Customer: CUSTOMERS[byId[1]] }] });
    return res.json({ items: [{ CustomerId: 900, Customer: 'Lone Star Paving', CustomerNumber: 'C-900' }] });
  }
  // equipment
  if (p === V1 + '/equipment-classes') return res.json({ data: CLASSES, hasMore: false });
  const sc = /\/equipment-classes\/(\d+)\/subclasses$/.exec(p);
  if (sc) return res.json({ data: SUBCLASSES[sc[1]] || [], hasMore: false });
  if (p === V1 + '/equipment-master') {
    const cls = req.query.get('equipmentClassId');
    const sub = req.query.get('equipmentSubclassId');
    return res.json({ data: MASTERS.filter((x) => (!cls || String(x.equipmentClassId) === cls) && (!sub || String(x.equipmentSubclassId) === sub)) });
  }
  return undefined;
}

const w = (env) => env.writes.map((x) => x.method + ' ' + x.path.replace(V1, ''));
const ws = (env, from) => env.writes.slice(from).map((x) => x.method + ' ' + x.path.replace(V1, ''));
// Every tab keeps its page alive (hidden) while another is shown, and several agreement tabs are open at once: what a
// person sees is the visible one, so record-tab selectors are read and clicked on the visible match only.
const $v = (sel) => sel + ':visible';
const allText = async (page, sel) => (await page.$$eval(sel, (els) => els.filter((e) => e.getClientRects().length > 0)
  .map((e) => e.innerText.replace(/\s+/g, ' ').trim())));
const vtext = async (page, sel) => (await page.innerText($v(sel))).replace(/\s+/g, ' ').trim();

async function download(page, button, fmt) {
  await page.click(button);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.nx-menu-item[data-format="${fmt}"]`)]);
  const file = path.join(os.tmpdir(), 'next-cm-' + dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), file };
}

async function settle(page, ms) { await page.waitForTimeout(ms || 400); }

(async () => {
  let env = await E.start({ port: 19370, handle, app: 'next' });
  let page = env.page;
  try {
    // ════ Rates ═══════════════════════════════════════════════════════════════════════════════════════════
    T.section('Rates: the schedules and who uses them');
    await env.open('/?open=rates');
    await page.waitForSelector('.nx-cm-rgrid .nx-cm-rrow', { timeout: 30000 });
    await settle(page);
    T.eq('the summary', await env.text('#ratesSummary'),
      '4 schedules · 3 active · 1 ending within 30 days · 1 not used (Fusion PPM) · they price every cost the rate engine calculates');
    T.eq('each schedule says who uses it', (await allText(page, '.nx-cm-item-tags')).join(' | '),
      'Yard Houston Yard | No tags: the fallback rates | Project Pipeline North · Phase 2 | Yard Odessa Yard');
    T.check('an active schedule ending within 30 days says so', (await env.text('.nx-cm-item[data-id="9"]')).includes('Ends in 20 days'));
    T.check('a schedule whose yard takes Fusion PPM rates is marked, not hidden', (await env.text('.nx-cm-item[data-id="12"]')).includes('Not used: its yard takes Fusion PPM rates'));
    T.eq('chips', (await allText(page, '.nx-cm-list .nx-chip')).join(' | '), 'All 4 | Active 3 | Ending soon 1 | Inactive 1 | Tagged 3 | No tags 1');
    await page.click('.nx-cm-list .nx-chip[data-value="untagged"]');
    await settle(page, 200);
    T.eq('No tags: the fallback', (await page.$$eval('.nx-cm-item', (b) => b.map((x) => x.dataset.id))).join(), '10');
    await page.click('.nx-cm-list .nx-chip[data-value="untagged"]');
    await page.fill('.nx-cm-list .nx-search input', 'pipeline');
    await settle(page, 200);
    T.eq('search by project', (await page.$$eval('.nx-cm-item', (b) => b.map((x) => x.dataset.id))).join(), '11');
    await page.fill('.nx-cm-list .nx-search input', '');
    await settle(page, 200);

    T.section('Rates: the open schedule, per class and period');
    T.eq('the first active schedule is open', await env.text('#schedTitle'), 'US Excavators 2026 Active');
    T.check('Used by, in words', (await env.text('#schedUsedBy')).startsWith('Houston Yard Requests that match these tags take their rates from this schedule'));
    T.eq('a row per class (subclass, equipment)', (await page.$$eval('.nx-cm-rrow', (r) => r.map((x) => x.dataset.group))).join(' | '),
      'Excavators · Crawler · CAT 320 Excavator | Generators · Generator 100 kVA');
    const exc = '.nx-cm-rrow[data-group="Excavators · Crawler · CAT 320 Excavator"]';
    T.eq('where each tier applies', (await allText(page, exc + ' .nx-cm-tier')).join(' | '), '1–4 days | 5–29 days | 30 days or more');
    T.eq('the rate the engine bills, and the margin', (await allText(page, exc + ' .nx-cm-rfoot')).join(' | '),
      '$880 a day +29% × | $557.1429 a day +17% × | $426.6667 a day -6.7% ×');
    T.check('an hourly row cannot take a daily rate', (await page.$eval('.nx-cm-rrow[data-group="Generators · Generator 100 kVA"] .nx-cm-rcell[data-period="DAILY"]', (c) => c.innerText.trim())) === '—');
    T.eq('the margin check names the rate below cost', await env.text('#ratesMargin'),
      'One rate bills below its cost Excavators · Crawler · CAT 320 Excavator · Monthly: bill $12,000 is below cost $12,800.');
    T.check('that rate is marked in the grid', !!(await page.$('.nx-cm-rline--low[data-key="id:3"]')));

    T.check('every rate shows its whole value in its box', await page.$$eval('.nx-cm-rfield input', (i) => i.length > 0 && i.every((x) => x.scrollWidth <= x.clientWidth)));
    await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTop = 0; });
    await env.shot('next-rates.png');

    T.section('Rates: try a rate (17 days of a 320 excavator)');
    await page.click('.nx-cm-sim .nx-chip[data-value*="CAT 320 Excavator"]');
    await settle(page, 200);
    T.eq('it asks only what that row counts', (await allText(page, '.nx-cm-sim-in .nx-cm-label')).join(' | '), 'Days on rent | Quantity');
    await page.fill('.nx-cm-sim input[data-field="daysOnRent"]', '17');
    await settle(page, 300);
    T.eq('the answer, and why', await env.text('.nx-cm-sim-out li'),
      'Excavators · Crawler · CAT 320 Excavator $9,471.43 17 days on rent reach the Weekly tier (from 5 days) '
      + '17 × $557.1429 a day = $9,471.43 · 2.43 weeks at $3,900 a week At the bill rate ≈ $11,414.29');
    await page.fill('.nx-cm-sim input[data-field="qty"]', '2');
    await settle(page, 300);
    T.check('two of them', (await env.text('.nx-cm-sim-out li')).includes('2 × 17 × $557.1429 a day = $18,942.86'));
    await page.fill('.nx-cm-sim input[data-field="qty"]', '1');
    await page.click('.nx-cm-sim .nx-chip[data-value=""]');
    await settle(page, 300);
    T.eq('every Usage row, with a total', [(await allText(page, '.nx-cm-sim-in .nx-cm-label')).join(' | '), await env.text('#ratesSimTotal')].join(' / '),
      'Days on rent | Logged hours | Quantity / $19,071.43');
    await page.mouse.move(0, 0);
    await env.shot('next-rates-try.png');

    T.section('Rates: edit a rate, add a period, Save (New\'s calls and bodies)');
    T.eq('nothing written yet', env.writes.length, 0);
    await page.fill('input[data-key="id:3"][data-field="billRate"]', '13500');
    await page.dispatchEvent('input[data-key="id:3"][data-field="billRate"]', 'change');
    await settle(page, 300);
    T.check('the margin check clears', !(await page.$('#ratesMargin')));
    T.check('the save bar says it is not saved', (await env.text('.nx-cm-savebar')).startsWith('Not saved yet'));
    await page.click(exc + ' .nx-cm-rcell[data-period="QUARTERLY"] .nx-cm-radd');
    await settle(page, 300);
    const q = await page.$eval(exc + ' .nx-cm-rcell[data-period="QUARTERLY"] .nx-cm-rline', (l) => l.dataset.key);
    T.eq('a new quarter starts at one quarter', await page.inputValue(`input[data-key="${q}"][data-field="threshold"]`), '90');
    await page.fill(`input[data-key="${q}"][data-field="periodAmount"]`, '30000');
    await page.dispatchEvent(`input[data-key="${q}"][data-field="periodAmount"]`, 'change');
    await settle(page, 300);
    T.check('the cost per period makes the rate per day', (await env.text(exc + ' .nx-cm-rcell[data-period="QUARTERLY"]')).includes('$333.3333 a day'));
    await page.click('#ratesSave');
    await page.waitForSelector('#ratesSaveNote', { timeout: 20000 });
    T.eq('header PUT, then every line in turn (sorted by class): PUT the saved ones, POST the new one',
      w(env).join(' > '), 'PUT /rate-schedules/9 > PUT /rate-period-lines/1 > PUT /rate-period-lines/2 > PUT /rate-period-lines/3 > POST /rate-period-lines > PUT /rate-period-lines/4');
    const head = env.writes[0].body;
    T.eq('the header body', [head.scheduleCode, head.isActiveFlag, head.yardOrgId, head.rateType, head.effectiveFrom, 'calcBasis' in head].join('|'),
      'RS-US-EXC-2026|Y|300|STANDARD|2026-01-01T00:00:00Z|false');
    const l3 = env.writes[3].body;
    T.eq('the edited line: bill 13,500, total and rate kept, the full body', [l3.billRate, l3.rateAmount, l3.periodAmount, l3.costRate, l3.periodType, l3.rateUom,
      l3.calcBasis, l3.fromUnit, l3.periodSeq, String(l3.periodDivisor), l3.equipmentSubclassId].join('|'), '13500|13500|12800|426.6667|MONTHLY|MONTH|MONTHLY|30|3|null|11');
    const nl = env.writes[4].body;
    // New's UOM_MAP has no QUARTERLY (so HOUR) and the complete-period basis map no QUARTERLY (so DAILY): sent as New sends them.
    T.eq('the new line: numbered above the highest periodSeq', [nl.rateScheduleId, nl.periodType, nl.rateUom, nl.fromUnit, nl.periodAmount, nl.costRate, nl.periodSeq,
      nl.calcMethod, nl.calcBasis, nl.equipmentName].join('|'), '9|QUARTERLY|HOUR|90|30000|333.3333|5|COMPLETE_PERIOD|DAILY|CAT 320 Excavator');
    T.eq('it says what was saved', await env.text('#ratesSaveNote'), 'US Excavators 2026 was saved: the details and all 5 rates.');
    T.check('and reads the schedule back', env.calls.filter((c) => c.startsWith('GET ' + V1 + '/rate-schedules/9')).length >= 2);

    T.section('Rates: remove a rate (asked first, deleted at once)');
    let mark = env.writes.length;
    await page.click('.nx-cm-x[data-key="id:4"]');
    await page.waitForSelector('.nx-cm-ask');
    T.eq('it asks, and says the delete is immediate', await env.text('.nx-cm-ask'),
      'Remove the Hourly rate of Generators · Generator 100 kVA? It is deleted from the schedule now, not when you save (as in Old and New EquipRite). Keep it Remove the rate');
    await page.click('#ratesAskOk');
    await settle(page, 400);
    T.eq('DELETE at once', env.writes.slice(mark).map((x) => x.method + ' ' + x.path.replace(V1, '')).join(), 'DELETE /rate-period-lines/4');
    T.check('the row is gone', !(await page.$('.nx-cm-rrow[data-group="Generators · Generator 100 kVA"]')));

    T.section('Rates: export what is shown');
    const csv = await download(page, '#ratesExport', 'csv');
    const text = fs.readFileSync(csv.file, 'utf8');
    T.check('CSV file name', /^equiprite-rate-schedules-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), csv.name);
    T.eq('CSV: header and the four schedules', text.split('\r\n').filter(Boolean).length, 5);
    T.check('CSV: who uses it and the PPM note', text.includes('Yard Houston Yard') && text.includes('Not used: its yard takes Fusion PPM rates'));
    const xl = await download(page, '#ratesLinesExport', 'xlsx');
    let read = '';
    try {
      read = execFileSync('python3', ['-I', '-c', 'import sys, openpyxl\nws = openpyxl.load_workbook(sys.argv[1]).active\nrows = list(ws.iter_rows(values_only=True))\nprint(len(rows)); print(rows[0][:4]); print([r[6] for r in rows[1:]])', xl.file], { encoding: 'utf8' }).trim();
    } catch (e) { read = 'unavailable'; }
    if (read !== 'unavailable') T.eq('Excel: the rates of the open schedule', read.split('\n').join(' | '), "4 | ('Class', 'Subclass', 'Equipment', 'Location') | ['Daily', 'Weekly', 'Monthly']");
    T.check('no sideways scroll (1440)', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    T.section('Rates: a new schedule, then delete it (asked first)');
    mark = env.writes.length;
    await page.click('#ratesNew');
    await page.waitForSelector('#schedForm');
    await settle(page, 300);
    T.eq('a new schedule opens with its details form', await env.text('#schedTitle'), 'New schedule Active');
    T.eq('the yards: Equipment Yards only, those taking Fusion PPM rates left out', (await allText(page, '#schedForm .nx-chip[data-action="yard"]')).join(), 'Houston Yard');
    await page.click('#ratesSave');
    await page.waitForSelector('#ratesSaveNote');
    T.eq('a name and a start date first; nothing written', [await env.text('#ratesSaveNote'), env.writes.length - mark].join(' / '),
      'Not saved: a schedule needs a name and a start date. / 0');
    await page.fill('#schedName', 'Houston excavators 2027');
    await page.dispatchEvent('#schedName', 'change');
    await page.fill('#schedStart', '2027-01-01');
    await page.dispatchEvent('#schedStart', 'change');
    await page.click('#schedForm .nx-chip[data-action="yard"][data-value="300"]');
    await settle(page, 200);
    T.check('Used by follows the details', (await env.text('#schedUsedBy')).startsWith('Houston Yard'));
    await page.click('#ratesAddRow');
    await page.waitForSelector('#ratesAddPanel .nx-chip[data-action="class"][data-value="1"]');
    await page.click('#ratesAddPanel .nx-chip[data-action="class"][data-value="1"]');
    await page.waitForSelector('#ratesAddPanel .nx-chip[data-action="equipment"]');
    await page.click('#ratesAddPanel .nx-chip[data-action="equipment"][data-value="CAT 320 Excavator"]');
    await page.click('#ratesAddPanel button[data-action="calcMethod"][data-value="COMPLETE_PERIOD"]');
    await page.click('#ratesAddRowOk');
    await settle(page, 300);
    const newRow = '.nx-cm-rrow[data-group="Excavators · CAT 320 Excavator"]';
    T.eq('a row for the class and equipment, its first rate Daily from 0', await page.$eval(newRow + ' .nx-cm-rcell[data-period="DAILY"] input[data-field="threshold"]', (i) => i.value), '0');
    await page.fill(newRow + ' .nx-cm-rcell[data-period="DAILY"] input[data-field="periodAmount"]', '900');
    await page.dispatchEvent(newRow + ' .nx-cm-rcell[data-period="DAILY"] input[data-field="periodAmount"]', 'change');
    await page.click('#ratesSave');
    await page.waitForFunction(() => document.querySelector('#ratesSaveNote') && document.querySelector('#ratesSaveNote').innerText.includes('was saved'), null, { timeout: 20000 });
    T.eq('POST the schedule, then its line', ws(env, mark).join(' > '), 'POST /rate-schedules > POST /rate-period-lines');
    const cs = env.writes[mark].body;
    T.eq('the new header', [cs.scheduleName, cs.scheduleCode, cs.effectiveFrom, cs.effectiveTo, cs.isActiveFlag, cs.yardOrgId, cs.currencyCode, cs.customerRefId].join('|'),
      'Houston excavators 2027|RS-HOUSTON-EXCAVATORS-2027|2027-01-01T00:00:00Z||Y|300|USD|');
    const cl1 = env.writes[mark + 1].body;
    T.eq('its line, on the new schedule', [cl1.rateScheduleId, cl1.periodType, cl1.rateUom, cl1.calcMethod, cl1.calcBasis, cl1.fromUnit, cl1.periodAmount, cl1.costRate, cl1.periodSeq,
      cl1.equipmentClassId, cl1.equipmentName].join('|'), '14|DAILY|DAY|COMPLETE_PERIOD|DAILY|0|900|900|1|1|CAT 320 Excavator');
    T.eq('it says so, and it is open', [await env.text('#ratesSaveNote'), await env.text('#schedTitle')].join(' / '),
      'Houston excavators 2027 was saved: the details and its rate. / Houston excavators 2027 Active');
    mark = env.writes.length;
    await page.click('#schedDelete');
    await page.waitForSelector('.nx-cm-ask');
    T.eq('Delete asks first, and says what happens', await env.text('.nx-cm-ask'), 'Delete Houston excavators 2027? Deletes the schedule and its 0 rates. '
      + 'Requests priced from it fall back to the next matching schedule. This cannot be undone. Keep it Delete the schedule');
    await page.click('#ratesAskOk');
    await page.waitForFunction(() => !document.querySelector('.nx-cm-item[data-id="14"]'), null, { timeout: 20000 });
    await settle(page, 300);
    T.eq('DELETE, then the list again', ws(env, mark).join(), 'DELETE /rate-schedules/14');
    T.eq('the first schedule opens', await env.text('#schedTitle'), 'US Excavators 2026 Active');

    T.section('Rates: a narrow window');
    await page.setViewportSize({ width: 1000, height: 900 });
    await settle(page, 300);
    T.check('no sideways scroll (1000): the grid scrolls in its card', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.setViewportSize({ width: 1440, height: 1000 });

    // ════ Agreements ══════════════════════════════════════════════════════════════════════════════════════
    T.section('Agreements: what is active, ending soon, waiting');
    const agrStart = env.writes.length;
    await env.open('/?open=agreements');
    await page.waitForSelector('.nx-cm-agrid .nx-row--click', { timeout: 30000 });
    await settle(page);
    T.eq('the summary', await env.text('#agrSummary'), '4 agreements · 1 active · 1 ending within 60 days · 2 waiting for approval');
    T.eq('chips: ending soon first, then the statuses present', (await allText(page, '.nx-agreements .nx-chip')).join(' | '),
      'All 4 | Ending soon 1 | Draft 1 | Pending 1 | Active 1 | Expired 1');
    T.eq('newest first', (await page.$$eval('.nx-row--click', (r) => r.map((x) => x.dataset.number))).join(), 'RNT-0003,ST-0001,RNT-0002,RNT-0001');
    T.eq('a row in words: status, valid, ending, next step', await env.text('.nx-row--click[data-number="RNT-0002"]'),
      'RNT-0002 Lone Star MSA Lone Star Paving RENTAL Active ' + rangeText('2026-01-01', day(45)) + ' Ends in 45 days 2 lines Ends in 45 days: renew it with the customer, or let it end');
    T.check('a draft: who acts next', (await env.text('.nx-row--click[data-number="ST-0001"]')).includes('Finance to approve it; then its lines can be requested'));
    await page.click('.nx-agreements .nx-chip[data-value="expiring"]');
    await settle(page, 200);
    T.eq('Ending soon', (await page.$$eval('.nx-row--click', (r) => r.map((x) => x.dataset.number))).join(), 'RNT-0002');
    await page.click('.nx-agreements .nx-chip[data-value="all"]');
    await page.fill('.nx-agreements .nx-search input', 'trench');
    await settle(page, 200);
    T.eq('search', (await page.$$eval('.nx-row--click', (r) => r.map((x) => x.dataset.number))).join(), 'ST-0001');
    await page.fill('.nx-agreements .nx-search input', '');
    await settle(page, 200);
    await page.click('.nx-sort[data-key="customer"]');
    await settle(page, 200);
    T.eq('sort by customer', (await page.$$eval('.nx-row--click', (r) => r.map((x) => x.dataset.number))).join(), 'ST-0001,RNT-0003,RNT-0001,RNT-0002');
    const acsv = await download(page, '#agrExport', 'csv');
    const atext = fs.readFileSync(acsv.file, 'utf8').split('\r\n').filter(Boolean);
    T.eq('CSV: header and the four, as sorted', atext.map((l) => l.split(',')[0].replace(/^﻿/, '')).join(), 'Agreement,ST-0001,RNT-0003,RNT-0001,RNT-0002');
    T.check('CSV: the status in words and the next step', atext.some((l) => l.includes('Ends in 45 days') && l.includes('Active')));
    await page.click('.nx-sort[data-key="customer"]');
    await page.click('.nx-sort[data-key="customer"]');
    await env.shot('next-agreements.png');
    T.check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));


    T.section('An agreement in its own tab: lines and rates, Create request');
    await page.click('.nx-row--click[data-number="RNT-0002"] .nx-cm-num');
    await page.waitForSelector($v('.nx-agreement .nx-record-title'), { timeout: 20000 });
    await settle(page, 500);
    T.eq('it opens in a tab named after it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'agreement:RNT-0002=RNT-0002');
    T.eq('the heading', await vtext(page, '.nx-agreement .nx-record-title'), 'Lone Star MSA Active');
    T.eq('the customer, the dates and the end', await vtext(page, '.nx-agreement .nx-pagehead .nx-sub'),
      'RNT-0002 · Lone Star Paving · ' + rangeText('2026-01-01', day(45)) + ' Ends in 45 days');
    T.eq('what is next', await vtext(page, '#agrNext'), 'Next: Ends in 45 days: renew it with the customer, or let it end');
    T.eq('the lines and their rates', (await allText(page, '.nx-cm-lgrid .nx-row:not(.nx-row--head)')).join(' | '),
      '1 CAT 320 Excavator Excavators · Crawler $1,050 / day 1 — | 2 Any vibratory roller Rollers · Vibratory $720 / day 1 —');
    T.check('facts: the terms and the value', (await vtext(page, '.nx-facts')).includes('Minimum one week') && (await vtext(page, '.nx-facts')).includes('$48,000'));
    T.check('an active agreement cannot be approved or edited again', !(await page.$($v('#agrApprove'))) && !(await page.$($v('#agrEdit'))));
    T.eq('nothing ticked yet', await vtext(page, '#agrPreview'), 'Tick the lines to request.');
    await page.check($v('.nx-cm-lgrid .nx-row--head .nx-cm-tick'));
    await settle(page, 300);
    T.eq('what Create request will do, before the click', await vtext(page, '#agrPreview'),
      '2 lines go to New request at this agreement\'s rates. 1 line names only a class: it takes the first equipment of that class. You add the project, dates and delivery there.');
    T.eq('the button says how many', await vtext(page, '#agrCreateRequest'), 'Create request from 2 lines');
    await env.shot('next-agreement.png');
    // The hand-off is read (and cleared) by New request as soon as its tab opens: keep what was written, as written.
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        orig.call(this, k, v);
        if (this === window.sessionStorage && k === 'eqr.agreement.active') {
          const snap = {};
          Object.keys(localStorage).forEach((x) => { if (x.indexOf('eqr.draft.') === 0) snap[x] = localStorage.getItem(x); });
          window.__handoff = { snap, flag: v };
        }
      };
    });
    await page.click($v('#agrCreateRequest'));
    await page.waitForFunction(() => document.querySelector('.nx-tab--on') && document.querySelector('.nx-tab--on').dataset.tabId.indexOf('agreement-request:RNT-0002-') === 0, null, { timeout: 15000 });
    T.check('a class-only line takes the first equipment of its class', env.calls.some((c) => c.includes('/equipment-master?') && c.includes('equipmentClassId=4') && c.includes('size=5')));
    const hand = await page.evaluate(() => {
      const snap = (window.__handoff && window.__handoff.snap) || {};
      const keys = Object.keys(snap).sort();
      const get = (k) => JSON.parse(snap['eqr.draft.' + k] || 'null');
      return { keys: keys.join(','), cart: get('CartItemsArray'), origin: get('requestOrigin'), id: get('fromAgreementId'), number: get('fromAgreementNumber'),
        customer: get('fromAgreementCustomer'), fusion: get('fromAgreementFusionCustomerId'), from: get('fromAgreementEffectiveFrom'), notes: get('fromAgreementNotes'),
        lineIds: get('agreementLineIdByEquipmentId'), rates: get('agreementRateByEquipmentId'), flag: window.__handoff && window.__handoff.flag };
    });
    // draftStorage.save(key, null) removes the key, so fromAgreementCustomerRefId (null on a Fusion customer) is absent, as in New.
    T.eq('the hand-off keys, exactly as New writes them', hand.keys, ['agreementLineIdByEquipmentId', 'agreementRateByEquipmentId', 'CartItemsArray', 'fromAgreementCustomer',
      'fromAgreementEffectiveFrom', 'fromAgreementEffectiveTo', 'fromAgreementFusionCustomerId', 'fromAgreementId', 'fromAgreementNotes',
      'fromAgreementNumber', 'requestOrigin'].map((k) => 'eqr.draft.' + k).sort().join(','));
    T.eq('the cart', JSON.stringify(hand.cart), JSON.stringify([
      { id: 101, equipmentId: 101, name: 'CAT 320 Excavator', class: 'Excavators', classId: 1, quantity: 1, billingRate: 1050, billingUnit: 'DAY' },
      { id: 205, equipmentId: 205, name: 'Vibratory roller CS56', class: 'Rollers', classId: 4, quantity: 1, billingRate: 720, billingUnit: 'DAY' }]));
    T.eq('the agreement', [hand.origin, hand.id, hand.number, hand.customer, hand.fusion, hand.from, hand.notes, hand.flag].join('|'),
      'agreement|31|RNT-0002|Lone Star Paving|900|2026-01-01T00:00:00Z|Minimum one week|1');
    T.eq('the line ids and rates by equipment', JSON.stringify([hand.lineIds, hand.rates]),
      JSON.stringify([{ 101: 11, 205: 12 }, { 101: { billingRate: 1050, billingUnit: 'DAY' }, 205: { billingRate: 720, billingUnit: 'DAY' } }]));
    await page.waitForSelector('#orAgreement:visible', { timeout: 20000 });
    T.check('New request (its own tab) takes the lines at the agreement\'s rates', (await vtext(page, '#orAgreement')).includes('RNT-0002')
      && (await page.$$eval('.nx-or-line', (l) => l.filter((x) => x.offsetParent).length)) === 2, await vtext(page, '#orAgreement'));
    T.eq('the hand-off is read once', await page.evaluate(() => String(sessionStorage.getItem('eqr.agreement.active')) + '|' + Object.keys(localStorage).filter((k) => k.indexOf('eqr.draft.') === 0).length), 'null|0');
    T.eq('nothing written to the server', env.writes.length, agrStart);

    T.section('A draft agreement: Approve');
    mark = env.writes.length;
    await page.click('.nx-tab-btn[data-id="agreements"]');
    await settle(page, 300);
    await page.click('.nx-row--click[data-number="ST-0001"]');
    await page.waitForSelector($v('#agrApprove'), { timeout: 20000 });
    await settle(page, 400);
    T.check('a line without a rate takes the schedule\'s', (await vtext(page, '.nx-cm-lgrid')).includes('From the rate schedule'));
    T.check('a draft\'s lines cannot be requested yet', !(await page.$($v('#agrCreateRequest'))));
    T.eq('who acts next', await vtext(page, '#agrNext'), 'Next: Finance to approve it; then its lines can be requested');
    await page.click($v('#agrApprove'));
    await page.waitForSelector($v('#agrNote'), { timeout: 20000 });
    T.eq('PATCH the status, nothing else', env.writes.slice(mark).map((x) => x.method + ' ' + x.path.replace(V1, '') + ' ' + JSON.stringify(x.body)).join(),
      'PATCH /agreement-headers/32 {"status":"ACTIVE"}');
    T.eq('read back: active', await vtext(page, '#agrStatus'), 'Active');
    T.eq('it says so', await vtext(page, '#agrNote'), 'ST-0001 is approved and active: its lines can be requested now.');
    T.check('now its lines can be requested', !!(await page.$($v('#agrCreateRequest'))) && !(await page.$($v('#agrApprove'))));

    T.section('A pending agreement: Edit and Save (New\'s calls), then Reject');
    mark = env.writes.length;
    await page.click('.nx-tab-btn[data-id="agreements"]');
    await settle(page, 300);
    await page.click('.nx-row--click[data-number="RNT-0003"]');
    await page.waitForSelector($v('#agrEdit'), { timeout: 20000 });
    await settle(page, 300);
    await page.click($v('#agrEdit'));
    await page.waitForSelector($v('#agrName'), { timeout: 20000 });
    await settle(page, 400);
    T.check('the form holds the agreement', (await page.inputValue($v('#agrName'))) === 'Permian 2027' && (await vtext(page, '#agrCustomer')).includes('Basin Energy')
      && (await page.inputValue($v('#agrEnd'))) === '2027-12-31');
    await page.fill($v('#agrName'), 'Permian 2027 (revised)');
    await page.dispatchEvent($v('#agrName'), 'change');
    const rate1 = $v('.nx-cm-egrid input[data-field="unitPrice"][data-index="1"]');
    await page.fill(rate1, '90');
    await page.dispatchEvent(rate1, 'change');
    await page.click($v('#agrAddLine'));
    await page.waitForSelector($v('#agrAddPanel .nx-chip[data-value="4"]'));
    await page.click($v('#agrAddPanel .nx-chip[data-value="4"]'));
    await page.waitForSelector($v('#agrAddPanel .nx-chip[data-value="206"]'));
    await page.click($v('#agrAddPanel .nx-chip[data-value="206"]'));
    await page.click($v('#agrAddLineOk'));
    await settle(page, 200);
    T.eq('a line needs a rate above 0', await vtext(page, '.nx-agreement .nx-cm-inset'), 'Rate must be greater than 0.');
    await page.fill($v('#agrDraftRate'), '700');
    await page.dispatchEvent($v('#agrDraftRate'), 'change');
    await page.click($v('#agrAddLineOk'));
    await settle(page, 300);
    T.eq('the new line is numbered after the highest', (await page.$$eval('.nx-cm-egrid .nx-row:not(.nx-row--head)',
      (r) => r.filter((x) => x.getClientRects().length).map((x) => x.dataset.line))).join(), '1,2');
    T.eq('Save says what it will write', await vtext(page, '#agrSaveText'), 'Save updates the header, updates 1 line, adds 1 line.');
    T.eq('nothing written before Save', env.writes.length, mark);
    await env.shot('next-agreement-edit.png');
    await page.click($v('#agrSave'));
    await page.waitForSelector($v('#agrNote'), { timeout: 20000 });
    T.eq('PUT the header, PATCH the kept line, POST the new one', ws(env, mark).join(' > '), 'PUT /agreement-headers/33 > PATCH /agreement-lines/51 > POST /agreement-lines');
    const put = env.writes[mark].body;
    T.eq('the PUT carries the loaded number, status and version', [put.id, put.agreementNumber, put.agreementName, put.status, put.objectVersionNumber,
      put.fusionCustomerId, put.effectiveTo].join('|'), '33|RNT-0003|Permian 2027 (revised)|PENDING|2|903|2027-12-31T00:00:00Z');
    T.eq('the kept line', JSON.stringify(env.writes[mark + 1].body), JSON.stringify({ equipmentClassId: 7, equipmentMasterId: 701, description: '', unitPrice: 90, priceUom: 'DAY' }));
    T.eq('the new line', JSON.stringify(env.writes[mark + 2].body), JSON.stringify({ agreementHeaderId: 33, lineNumber: 2, equipmentClassId: 4, equipmentMasterId: 206,
      description: '', unitPrice: 700, priceUom: 'DAY', quantity: 1 }));
    T.eq('back on the agreement, saved', [await vtext(page, '.nx-agreement .nx-record-title'), await vtext(page, '#agrNote')].join(' / '),
      'Permian 2027 (revised) Pending / RNT-0003 was saved: the header and its 2 lines.');
    mark = env.writes.length;
    await page.click($v('#agrReject'));
    await page.waitForSelector($v('.nx-cm-ask'));
    T.eq('Reject asks first', await vtext(page, '.nx-cm-ask'),
      'Reject RNT-0003? A rejected agreement cannot be edited or approved again, and its lines cannot be requested. Keep it Reject the agreement');
    T.eq('nothing written before the answer', env.writes.length, mark);
    await page.click($v('#agrAskOk'));
    await page.waitForFunction(() => [...document.querySelectorAll('#agrStatus')].some((e) => e.getClientRects().length && e.innerText.trim() === 'Rejected'), null, { timeout: 20000 });
    await settle(page, 300);
    T.eq('PATCH REJECTED', env.writes.slice(mark).map((x) => x.method + ' ' + x.path.replace(V1, '') + ' ' + JSON.stringify(x.body)).join(),
      'PATCH /agreement-headers/33 {"status":"REJECTED"}');
    T.check('read back: rejected, nothing left to decide', !(await page.$($v('#agrApprove'))) && !(await page.$($v('#agrEdit'))) && !(await page.$($v('#agrReject'))));
    T.eq('it says what is next', await vtext(page, '#agrNext'), 'Next: Rejected: it cannot be edited or approved again');

    T.section('New agreement: every missing field at once, then numbered, created as a draft, opened in its own tab');
    mark = env.writes.length;
    await page.click('.nx-tab-btn[data-id="agreements"]');
    await settle(page, 300);
    await page.click('#agrNew');
    await page.waitForSelector($v('#agrName'), { timeout: 20000 });
    await settle(page, 400);
    T.eq('a tab of its own', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'agreement:new=New agreement');
    await page.click($v('#agrSave'));
    await page.waitForSelector($v('#agrMissing'));
    T.eq('every missing field at once', await vtext(page, '#agrMissing'), 'Fill in: Agreement Name, Agreement Type, Customer, Start Date, End Date.');
    T.eq('nothing written', env.writes.length, mark);
    await page.fill($v('#agrName'), 'Trench kit 2027');
    await page.dispatchEvent($v('#agrName'), 'change');
    await page.click($v('.nx-cm-chip--sm[data-field="agreementType"][data-value="SHORT_TERM"]'));
    await page.fill($v('#agrCustomerSearch'), 'lone');
    await page.waitForSelector($v('.nx-cm-result'), { timeout: 10000 });
    await page.click($v('.nx-cm-result'));
    await page.fill($v('#agrStart'), '2027-01-01');
    await page.dispatchEvent($v('#agrStart'), 'change');
    await page.fill($v('#agrEnd'), '2027-06-30');
    await page.dispatchEvent($v('#agrEnd'), 'change');
    await settle(page, 200);
    T.check('the missing list empties as they are filled', !(await page.$($v('#agrMissing'))));
    await page.click($v('#agrAddLine'));
    await page.waitForSelector($v('#agrAddPanel .nx-chip[data-value="1"]'));
    await page.click($v('#agrAddPanel .nx-chip[data-value="1"]'));
    await page.waitForSelector($v('#agrAddPanel .nx-chip[data-value="101"]'));
    await page.click($v('#agrAddPanel .nx-chip[data-value="101"]'));
    await page.fill($v('#agrDraftRate'), '980');
    await page.dispatchEvent($v('#agrDraftRate'), 'change');
    await page.click($v('#agrAddLineOk'));
    await settle(page, 200);
    T.eq('Save says what it will write', await vtext(page, '#agrSaveText'), 'Creates the agreement as a draft with 1 line; it is used once approved.');
    await page.click($v('#agrSave'));
    await page.waitForFunction(() => document.querySelector('.nx-tab--on') && document.querySelector('.nx-tab--on').dataset.tabId === 'agreement:ST-0002', null, { timeout: 20000 });
    await page.waitForSelector($v('.nx-agreement .nx-record-title'), { timeout: 20000 });
    await settle(page, 500);
    T.eq('POST the header (numbered ST-0002), then its line', ws(env, mark).join(' > '), 'POST /agreement-headers > POST /agreement-lines');
    T.check('numbered from the type\'s prefix and the highest number in use', env.calls.some((c) => c.includes('/conf-agreement-types'))
      && env.calls.some((c) => c.includes('/views/rental-agreements?') && c.includes('size=500')));
    const ch = env.writes[mark].body;
    T.eq('the new header', [ch.agreementNumber, ch.agreementName, ch.agreementType, ch.status, ch.fusionCustomerId, ch.effectiveFrom, ch.currencyCode].join('|'),
      'ST-0002|Trench kit 2027|SHORT_TERM|DRAFT|900|2027-01-01T00:00:00Z|USD');
    const cl = env.writes[mark + 1].body;
    T.eq('its line', [cl.agreementHeaderId, cl.lineNumber, cl.equipmentClassId, cl.equipmentMasterId, cl.unitPrice, cl.priceUom, cl.quantity].join('|'), '40|1|1|101|980|DAY|1');
    T.eq('the new agreement in its own tab', await vtext(page, '.nx-agreement .nx-record-title'), 'Trench kit 2027 Draft');
    T.check('the form\'s tab closed', !(await page.$('.nx-tab[data-tab-id="agreement:new"]')));
    T.check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-commercial-failed.png').catch(() => {});
  } finally {
    await env.close();
  }

  // ════ A read-only role ════════════════════════════════════════════════════════════════════════════════
  try {
    const access = Object.fromEntries(E.ALL_CODES.map((c) => [c, 'FULL']));
    access.EQR_RATE_SCHEDULE = 'READ_ONLY';
    access.EQR_RENTAL_AGREEMENTS = 'READ_ONLY';
    env = await E.start({ port: 19370, handle, app: 'next', access });
    page = env.page;
    T.section('Read only: rates and agreements to look at');
    await env.open('/?open=rates');
    await page.waitForSelector('.nx-cm-rgrid .nx-cm-rrow', { timeout: 30000 });
    await settle(page);
    T.check('no inputs, no New schedule, no Save', !(await page.$('.nx-cm-rgrid input')) && !(await page.$('#ratesNew')) && !(await page.$('#ratesSave')) && !(await page.$('.nx-cm-radd')));
    T.check('the rates as text', (await env.text('.nx-cm-rcell[data-period="WEEKLY"]')).includes('Cost $3,900') && (await env.text('.nx-cm-rcell[data-period="WEEKLY"]')).includes('Bill $4,700'));
    T.check('Try a rate still works', (await env.text('.nx-cm-sim')).includes('$7,800'));
    await env.shot('next-rates-readonly.png');
    await env.open('/?open=agreement&number=ST-0001');
    await page.waitForSelector($v('.nx-agreement .nx-record-title'), { timeout: 30000 });
    await settle(page, 500);
    T.check('a deep link opens the agreement', (await vtext(page, '.nx-agreement .nx-record-title')).startsWith('Short term trench kit'));
    T.check('no Approve, Reject or Edit below full access', !(await page.$($v('#agrApprove'))) && !(await page.$($v('#agrReject'))) && !(await page.$($v('#agrEdit'))));
    await env.open('/?open=agreements');
    await page.waitForSelector('.nx-cm-agrid .nx-row--click', { timeout: 30000 });
    T.check('no New agreement below full access', !(await page.$('#agrNew')));
    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('read-only run finished', false, e.message);
    await env.shot('next-commercial-readonly-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();

/** fmt.range's words: '1 Jan – 14 Dec 2026'. */
function rangeText(a, b) {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = (s, y) => Number(s.slice(8, 10)) + ' ' + MON[Number(s.slice(5, 7)) - 1] + (y ? ' ' + s.slice(0, 4) : '');
  return a.slice(0, 4) === b.slice(0, 4) ? d(a, false) + ' – ' + d(b, true) : d(a, true) + ' – ' + d(b, true);
}
