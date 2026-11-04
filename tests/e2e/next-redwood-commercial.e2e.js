'use strict';
/*
 * EquipRite Next, Commercial in the Redwood look (your menu, Look), in a real browser, as Old EquipRite builds these
 * screens from Oracle's own Redwood templates:
 *   Rates (master-detail, as Old's Rate Management): the schedules as Oracle's Smart Search page (Smart Search with a
 *     filter per column, oj-table, oj-badge, oj-c buttons), New schedule its primary action; a row opens the schedule
 *     as its record under Oracle's general overview header (its name and status, in-flow back, Save and its actions)
 *     over the screen's own detail body ("Rates by period" and the rest); Current's left-hand list is not there.
 *   Agreements (list, as Old's Rental Agreements): Oracle's Smart Search page; a row opens the agreement in its tab.
 *   An agreement (record, as Old's rental-agreement-lines page): Oracle's general overview header over its own body:
 *     Approve on the band, Edit and Cancel, in-flow back to Agreements.
 * Then Current again: every screen as it was, showing the same state (the schedule and agreement opened, the filter).
 * Needs `npm run build`. Run: node tests/e2e/next-redwood-commercial.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const V1 = '/equiprite/v1';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const iso = (d) => d + 'T00:00:00Z';

// ── Rates (as tests/e2e/next-commercial.e2e.js) ──────────────────────────────────────────────────────────
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
  Object.assign({ id: 21, periodSeq: 1, periodType: 'DAILY', rateUom: 'DAY', calcBasis: 'DAILY', fromUnit: 0, periodAmount: 820, costRate: 820, billRate: 1150 },
    EXC, { rateScheduleId: 11 }),
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
  'ST-0001': [{ lineNumber: 1, equipmentName: 'Trench box 8x20', className: 'Shoring', subClassName: 'Trench boxes', qty: 2, billRate: 0, priceUom: 'DAY' }],
};
const RAW_LINES = { 32: [{ id: 41, agreementHeaderId: 32, lineNumber: 1, equipmentClassId: 6, equipmentMasterId: 601, unitPrice: null, priceUom: 'DAY', description: '' }] };
const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 6, className: 'Shoring' }];

function handle(req, res) {
  const p = req.path;
  const m = req.method;
  // settings: business unit 2 takes Fusion PPM rates, so the Odessa yard's schedule is not used
  if (p.endsWith('/conf-equipment-settings')) return res.json({ data: [{ businessUnitId: 1, rateSource: 'EQUIPRITE_RATES' }, { businessUnitId: 2, rateSource: 'PPM_RATES' }] });
  if (p === V1 + '/bu-org-mappings') {
    return res.json({ data: [{ orgRole: 'EQUIPMENT_YARD', invOrgId: 300, invOrgName: 'Houston Yard', businessUnitId: 1 },
      { orgRole: 'EQUIPMENT_YARD', invOrgId: 400, invOrgName: 'Odessa Yard', businessUnitId: 2 }] });
  }
  if (p === V1 + '/rate-schedules' && m === 'GET') return res.json({ data: SCHEDULES });
  const rs = /\/rate-schedules\/(\d+)$/.exec(p);
  if (rs) {
    const s = SCHEDULES.find((x) => x.id === Number(rs[1]));
    if (m === 'GET') return res.json(s || {}, s ? 200 : 404);
    if (m === 'PUT' && s) Object.assign(s, req.json());
    return res.json({ id: Number(rs[1]) });
  }
  if (p === V1 + '/rate-period-lines' && m === 'GET') return res.json({ data: RATE_LINES });
  if (/\/rate-period-lines\/\d+$/.test(p)) return res.json({ id: Number(p.split('/').pop()) });
  if (p === V1 + '/views/rental-agreements') return res.json({ data: Object.values(agr).map((a) => Object.assign({}, a)) });
  if (p === V1 + '/agreement-headers' && m === 'GET') {
    const a = Object.values(agr).find((x) => x.agreementNumber === req.query.get('agreementNumber'));
    return res.json(a || {});
  }
  const ah = /\/agreement-headers\/(\d+)$/.exec(p);
  if (ah) {
    const a = agr[Number(ah[1])];
    if (m === 'PATCH' || m === 'PUT') Object.assign(a, req.json());
    return res.json(a);
  }
  if (p === V1 + '/views/rental-agreement-lines') return res.json({ data: VIEW_LINES[req.query.get('agreementNumber')] || [] });
  if (p === V1 + '/agreement-lines' && m === 'GET') return res.json({ data: RAW_LINES[Number(req.query.get('agreementId'))] || [] });
  if (p === V1 + '/conf-agreement-types') return res.json([{ typeCode: 'RENTAL', typeLabel: 'Rental', typePrefix: 'RNT' }, { typeCode: 'SHORT_TERM', typeLabel: 'Short term', typePrefix: 'ST' }]);
  if (p.endsWith('/shippingCustomersLOV')) {
    const byId = /CustomerId=(\d+)/.exec(req.query.get('q') || '');
    return res.json({ items: byId ? [{ CustomerId: Number(byId[1]), Customer: CUSTOMERS[byId[1]] }] : [] });
  }
  if (p === V1 + '/equipment-classes') return res.json({ data: CLASSES, hasMore: false });
  return undefined;
}

const settle = (page, ms) => page.waitForTimeout(ms || 400);
const ws = (env, from) => env.writes.slice(from).map((x) => x.method + ' ' + x.path.replace(V1, '') + (x.method === 'PATCH' ? ' ' + JSON.stringify(x.body) : ''));
/** The table's rows (its first cell holds the record's link), each row's text. */
const rwRows = (page, table) => page.$$eval(table + ' tbody tr', (r) => r.filter((x) => x.querySelector('.nx-rw-num'))
  .map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
const rwKeys = (page, table) => page.$$eval(table + ' .nx-rw-num', (n) => n.map((x) => x.innerText.trim()));
const complete = (page, scope, tags) => page.evaluate((a) => a[1].map((t) => {
  const el = document.querySelector(a[0] + ' ' + t);
  return t + ':' + (el ? el.classList.contains('oj-complete') : 'missing');
}).join(' '), [scope, tags]);
const visibleText = async (page, sel) => (await page.$$eval(sel, (els) => els.filter((e) => e.getClientRects().length > 0)
  .map((e) => e.innerText.replace(/\s+/g, ' ').trim()))).join(' | ');
/** Oracle's general overview header, as shown: its title, its badge (text and Oracle's status), all its words. */
const header = (page, sel) => page.evaluate((s) => {
  const h = Array.from(document.querySelectorAll(s)).filter((e) => e.getClientRects().length > 0)[0];
  if (!h) return { title: '', badge: '', text: '' };
  const t = h.querySelector('h1');
  const b = h.querySelector('.oj-sp-header-general-overview-badge-text');
  const tone = b ? (/oj-badge-(success|info|warning|danger)/.exec(b.className) || [0, 'neutral'])[1] : '';
  return { title: t ? t.innerText.trim() : '', badge: b && b.innerText.trim() ? b.innerText.trim() + ' (' + tone + ')' : '', text: h.innerText.replace(/\s+/g, ' ').trim() };
}, sel);

/** Smart Search: a filter chip's options (what the rows hold, with how many). */
async function filterOptions(page, scope, chip, sample) {
  await page.click(`${scope} oj-sp-smart-search .oj-sp-filter-chip-container:has-text("${chip}")`);
  await page.waitForSelector(`text=${sample}`, { timeout: 10000 });
  await settle(page, 300);
  return page.$$eval('[role=option], li', (o) => o.filter((x) => x.offsetParent !== null).map((x) => x.innerText.trim()).filter((t) => /\(\d+\)$/.test(t)));
}
/** Picks one; Smart Search applies it as its list closes (Oracle's own behaviour, as in Old): click the page title. */
async function pickOption(page, scope, option) {
  await page.click(`text=${option}`);
  await settle(page, 600);
  await page.click(`${scope} oj-sp-smart-search-page h1`);
}
/** Waits until the chips show (Smart Search lays them out one by one, after measuring them). */
async function chips(page, scope, n) {
  await page.waitForFunction((a) => Array.from(document.querySelectorAll(a[0] + ' oj-sp-smart-search .oj-sp-filter-chip-container'))
    .filter((x) => x.innerText.trim()).length === a[1], [scope, n], { timeout: 15000 }).catch(() => {});
  await settle(page, 500);
  return (await page.$$eval(scope + ' oj-sp-smart-search .oj-sp-filter-chip-container', (b) => b.map((x) => x.innerText.trim()))).join(',');
}
/** One of the header's actions: Oracle's header keeps them in its More Actions menu (a button while one fits). */
async function headerAction(page, head, label) {
  const inline = page.locator(head + ' button:visible', { hasText: label });
  if (await inline.count()) {
    await inline.first().click();
    return;
  }
  await page.locator(head + ' button[aria-label="More Actions"]:visible').click();
  const item = page.locator('[role="menuitem"]:visible', { hasText: label }).first();
  await item.waitFor({ state: 'visible', timeout: 10000 });
  await item.click();
}
async function headerMenu(page, head) {
  await page.locator(head + ' button[aria-label="More Actions"]:visible').click();
  await page.waitForSelector('[role="menuitem"]:visible', { timeout: 10000 });
  const items = await page.$$eval('[role="menuitem"]', (m) => m.filter((x) => x.getClientRects().length).map((x) => x.innerText.trim()));
  await page.keyboard.press('Escape');
  await settle(page, 300);
  return items.join(', ');
}

(async () => {
  const env = await E.start({ port: 19600, handle, app: 'next' });
  const { page } = env;
  const errs = () => env.errors.filter((e) => !/404|Failed to load resource/.test(e));
  const look = () => page.getAttribute('html', 'data-nx-look');
  try {
    // ════ Current, to start ════════════════════════════════════════════════════════════════════════════════
    await env.open('/?open=rates');
    await page.waitForSelector('.nx-cm-rgrid .nx-cm-rrow', { timeout: 30000 });
    await settle(page, 500);
    T.section('Current, to start: Rates as it is');
    T.check('Current: Next\'s head, the left-hand list with its chips, no Redwood view', (await look()) === 'current' && await page.isVisible('.nx-rates .nx-pagehead')
      && await page.isVisible('.nx-cm-list .nx-chips') && !(await page.$('#ratesRwList')));

    // ════ Rates: Oracle's Smart Search page of the schedules ═════════════════════════════════════════════
    await env.setLook('redwood');
    T.section('Rates in Redwood: Oracle\'s Smart Search page of the schedules');
    await page.waitForSelector('#ratesRwList oj-sp-smart-search-page', { timeout: 20000 });
    await page.waitForFunction(() => /Odessa yard rates/.test((document.querySelector('#ratesRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    T.eq('Oracle\'s components, upgraded: smart search page, Smart Search, collection container, oj-table, oj-c buttons',
      await complete(page, '#ratesRwList', ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button']),
      'oj-sp-smart-search-page:true oj-sp-smart-search:true oj-sp-collection-container:true oj-table:true oj-c-button:true');
    const rHead = await env.text('#ratesRwList oj-sp-smart-search-page');
    T.check('the template\'s own header: Rates, the summary, New schedule its primary action', rHead.startsWith('Rates')
      && rHead.includes('4 schedules · 3 active · 1 ending within 30 days · 1 not used (Fusion PPM)')
      && (await page.locator('#ratesRwList button:visible', { hasText: 'New schedule' }).count()) > 0, rHead.slice(0, 200));
    T.check('the left-hand card list with chip filters is not there; nor Next\'s head; nor the open schedule under the list',
      !(await page.$('.nx-cm-list')) && !(await page.isVisible('.nx-rates .nx-pagehead')) && !(await page.isVisible('.nx-rates .nx-cm-detail')));
    T.eq('a table row per schedule, in the list\'s order', (await rwKeys(page, '#ratesRwTable')).join(' | '),
      'US Excavators 2026 | Default fallback | Pipeline North special | Odessa yard rates');
    const rr = await rwRows(page, '#ratesRwTable');
    T.check('a row: the schedule and its description, who uses it, when, the currency, its status and that it ends soon',
      rr.some((r) => /^US Excavators 2026 Base rates for the Gulf coast Yard Houston Yard 1 Jan – \d+ \w+ 2026 USD Active Ends in 20 days$/.test(r)), rr.join(' || '));
    T.check('the fallback (no tags) and a schedule its yard\'s Fusion PPM rates make unused say so', rr.some((r) => r.includes('Default fallback No tags: the fallback rates')
      && r.includes('Inactive')) && rr.some((r) => r.includes('Odessa yard rates') && r.includes('Not used: its yard takes Fusion PPM rates')), rr.join(' || '));
    T.eq('statuses are Oracle\'s oj-badge (Active, Inactive, Ends in …)', await page.$$eval('#ratesRwTable .oj-badge', (b) => b.map((x) => x.className.replace('oj-badge ', '')
      .replace(/\s+/g, '.') + '=' + x.innerText.trim()).join(' ')),
      'oj-badge-success.oj-badge-subtle=Active oj-badge-warning.oj-badge-subtle=Ends in 20 days oj-badge-subtle=Inactive oj-badge-success.oj-badge-subtle=Active '
      + 'oj-badge-success.oj-badge-subtle=Active');
    T.check('every column fits: the table does not scroll sideways', await page.$eval('#ratesRwTable .oj-table-scroller', (sc) => sc.scrollWidth <= sc.clientWidth + 1));
    await env.shot('rw-commercial-rates.png');

    T.section('Rates: New schedule, the list\'s primary action');
    await page.locator('#ratesRwList button:visible', { hasText: 'New schedule' }).first().click();
    await page.waitForSelector('#ratesRwHead:not([hidden]) oj-sp-general-overview-page', { timeout: 15000 });
    await page.waitForSelector('#schedForm', { timeout: 15000 });
    await settle(page, 600);
    T.check('a new schedule, as Current\'s New schedule: Oracle\'s header over its details form', (await header(page, '#ratesRwHead')).title === 'New schedule'
      && (await env.text('#schedTitle')) === 'New schedule Active' && !(await page.isVisible('#ratesRwList')));
    await page.click('#ratesRwHead button[aria-label="Back"]');
    await page.waitForSelector('#ratesRwList:not([hidden])', { timeout: 10000 });
    T.check('in-flow back: the list of schedules again', await page.isVisible('#ratesRwTable') && !(await page.isVisible('#ratesRwHead')));

    T.section('Rates: a filter per column; one narrows the rows');
    T.eq('the filters are the columns', await chips(page, '#ratesRwList', 5), 'Schedule,Used by,Effective,Currency,Status');
    T.eq('Used by offers who uses the schedules, with how many', (await filterOptions(page, '#ratesRwList', 'Used by', 'Yard Houston Yard (1)')).join(' | '),
      'No tags: the fallback rates (1) | Project Pipeline North · Phase 2 (1) | Yard Houston Yard (1) | Yard Odessa Yard (1)');
    await pickOption(page, '#ratesRwList', 'Project Pipeline North · Phase 2 (1)');
    await page.waitForFunction(() => !/US Excavators/.test((document.querySelector('#ratesRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 600);
    T.eq('picked: the schedules that project uses', (await rwKeys(page, '#ratesRwTable')).join(), 'Pipeline North special');
    T.check('the header\'s colour runs on behind the top of the table', /linear-gradient\(rgb\(44, 82, 102\)/.test(await page.$eval('.nx-rates', (e) => getComputedStyle(e).backgroundImage)));
    await env.shot('rw-commercial-rates-filter.png');

    T.section('Rates: a row opens the schedule as its record, under Oracle\'s header');
    const before = env.calls.length;
    await page.click('#ratesRwTable .nx-rw-num');
    await page.waitForSelector('#ratesRwHead:not([hidden])', { timeout: 15000 });
    await page.waitForFunction(() => /Pipeline North special/.test((document.querySelector('#schedTitle') || {}).innerText || ''), null, { timeout: 15000 });
    await settle(page, 800);
    T.check('it opens as on Current (the schedule and its rates read)', env.calls.slice(before).some((c) => c.startsWith('GET ' + V1 + '/rate-schedules/11'))
      && env.calls.slice(before).some((c) => c.startsWith('GET ' + V1 + '/rate-period-lines')));
    T.eq('Oracle\'s general overview page, upgraded', await complete(page, '#ratesRwHead', ['oj-sp-general-overview-page']), 'oj-sp-general-overview-page:true');
    const rec = await header(page, '#ratesRwHead');
    T.eq('the header: its name and its status as Oracle\'s badge', rec.title + ' / ' + rec.badge, 'Pipeline North special / Active (success)');
    T.check('…what it is (the kicker, who uses it, when, the currency), and Save schedule on the band',
      rec.text.includes('Rate schedule · Used by Pipeline North · Phase 2 · 1 Mar 2026 – 28 Feb 2027 · USD') && rec.text.includes('Save schedule'), rec.text);
    T.check('…and in-flow back to the list', await page.isVisible('#ratesRwHead button[aria-label="Back"]'));
    T.check('under it: the schedule\'s facts, Rates by period as Oracle\'s table, Try a rate, the save bar', await page.isVisible('#schedUsedBy')
      && await page.isVisible('#ratesGridTitle') && await page.isVisible('#ratesRwRates') && await page.isVisible('#ratesSim') && await page.isVisible('.nx-cm-savebar')
      && !(await page.$('.nx-cm-rrow')));
    T.check('the schedule card does not repeat what Oracle\'s header shows (its name, badge and buttons)', !(await page.isVisible('#schedTitle'))
      && !(await page.isVisible('#schedEditHeader')));
    T.check('the list is not shown with it, and Current\'s left-hand list stays away', !(await page.isVisible('#ratesRwList')) && !(await page.$('.nx-cm-list')));
    T.eq('its actions, as on Current', await headerMenu(page, '#ratesRwHead'), 'Edit details, Add equipment, Export the rates, Compare with other schedules, Delete, Refresh');
    await env.shot('rw-commercial-rates-record.png');

    T.section('Rates: the rates as Oracle\'s table; a row opens Oracle\'s drawer to change them');
    const rateRows = () => page.$$eval('#ratesRwRates .oj-table-body-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    const labels = (sel) => page.$$eval(sel, (e) => e.map((x) => x.innerText.trim()).join(' | '));
    await page.waitForFunction(() => document.querySelectorAll('#ratesRwRates .oj-table-body-row').length > 0, null, { timeout: 15000 });
    T.eq('Oracle\'s table, upgraded', await complete(page, '.nx-rt-rw', ['oj-table']), 'oj-table:true');
    const firstRate = (await rateRows())[0] || '';
    T.check('a row per equipment, a column per period: each tier as Old\'s rate grid (Threshold, Period total, Rate / day)',
      firstRate.includes('Excavators · Crawler · CAT 320 Excavator') && firstRate.includes('1 day or more')
      && /Threshold 0 Period total \$820 Rate \/ day \$820/.test(firstRate), firstRate);
    T.check('no Cost, no Bill, no below-cost banner, badge or Show only (Old has none of them)', !/\bCost\b|\bBill\b|below cost/i.test(firstRate)
      && !(await page.$('#ratesRwMargin')) && !(await page.$('#ratesRwOnlyLow')) && (await page.$$eval('#ratesRwRates .oj-badge', (b) => b.length)) === 0);
    await page.click('#ratesRwRates oj-c-button[data-act="edit"]');
    await page.waitForSelector('#ratesRwEdit input[data-field="costRate"]', { state: 'visible', timeout: 10000 });
    await settle(page, 500);
    T.check('Edit rates: Oracle\'s drawer, the equipment and each period with its tiers', await page.isVisible('#ratesRwDrawer oj-sp-general-drawer-template')
      && (await env.text('#ratesRwDrawer')).includes('Excavators · Crawler · CAT 320 Excavator') && (await env.text('#ratesRwEdit')).includes('Daily per day'));
    T.eq('…each tier\'s fields named as Old names them', await labels('#ratesRwEdit .nx-rt-drfield > span'), 'Threshold (days) | Period total (per day) | Rate / day');
    T.eq('…and their values', (await Promise.all(['threshold', 'periodAmount', 'costRate'].map((f) => page.inputValue(`#ratesRwEdit input[data-field="${f}"]`)))).join(' · '), '0 · 820 · 820');
    T.check('…no bill field', !(await page.$('#ratesRwEdit input[data-field="billRate"]')));
    await page.fill('#ratesRwEdit input[data-field="periodAmount"]', '900');
    await page.dispatchEvent('#ratesRwEdit input[data-field="periodAmount"]', 'change');
    await page.waitForFunction(() => /Period total \$900/.test(((document.querySelector('#ratesRwRates .oj-table-body-row') || {}).innerText || '').replace(/\s+/g, ' ')), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 400);
    T.eq('a new Period total restates the Rate / day, as in Old', await page.inputValue('#ratesRwEdit input[data-field="costRate"]'), '900');
    T.check('…and the table shows it', /Period total \$900 Rate \/ day \$900/.test((await rateRows())[0] || ''), (await rateRows())[0]);
    await env.shot('rw-commercial-rates-drawer.png');
    await page.press('#ratesRwEdit input[data-field="periodAmount"]', 'Escape');
    await page.waitForSelector('#ratesRwEdit', { state: 'hidden', timeout: 5000 }).catch(() => {});
    T.check('Escape closes the drawer', !(await page.isVisible('#ratesRwEdit')));
    await env.shot('rw-commercial-rates-table.png');
    await page.click('#ratesRwRates .nx-rt-rweq span');
    await page.click('#ratesRwRates .nx-rt-rwtier');
    await settle(page, 1000);
    T.check('a click on the row (its name, a rate) does not open it: only Edit rates does', !(await page.isVisible('#ratesRwEdit')));
    await page.click('#ratesRwRates oj-c-button[data-act="edit"]');
    await page.waitForSelector('#ratesRwEdit input[data-field="periodAmount"]', { state: 'visible', timeout: 10000 });
    await page.fill('#ratesRwEdit input[data-field="periodAmount"]', '820');
    await page.dispatchEvent('#ratesRwEdit input[data-field="periodAmount"]', 'change');
    await settle(page, 500);
    await page.locator('#ratesRwDrawer button[aria-label^="Close"]').first().click();
    await page.waitForSelector('#ratesRwEdit', { state: 'hidden', timeout: 5000 }).catch(() => {});
    T.check('its Close (×) closes it; the rate back at $820', !(await page.isVisible('#ratesRwEdit'))
      && /Period total \$820 Rate \/ day \$820/.test((await rateRows())[0] || ''));

    T.section('Rates: search the schedule\'s rates, Oracle\'s Smart Search in its header');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#ratesRwRateSearch .oj-sp-filter-chip-container'))
      .filter((x) => x.innerText.trim()).length === 7, null, { timeout: 15000 }).catch(() => {});
    T.eq('a filter per column of Old\'s rate grid, and the location', (await page.$$eval('#ratesRwRateSearch .oj-sp-filter-chip-container',
      (b) => b.map((x) => x.innerText.trim()))).join(','), 'Class,Subclass,Equipment,Rate type,Tier,Calc method,Location');
    await page.click('#ratesRwRateSearch .oj-sp-filter-chip-container:has-text("Tier")');
    await page.waitForSelector('text=Daily (1)', { timeout: 10000 }).catch(() => {});
    T.check('…each offers what the rates hold, with how many (Tier: Daily)', await page.isVisible('text=Daily (1)'));
    await page.keyboard.press('Escape');
    await settle(page, 400);
    const rateBox = await page.$('#ratesRwRateSearch input');
    await rateBox.click();
    await rateBox.type('trench', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#ratesRwRates .oj-table-body-row').length === 0, null, { timeout: 10000 }).catch(() => {});
    await settle(page, 500);
    T.check('typed words no rate has: no rows, and the table says why', (await rateRows()).length === 0
      && (await env.text('#ratesRwCount')).startsWith('0 of 1') && (await env.text('.nx-rt-rw')).includes('No rate matches the search'), await env.text('#ratesRwCount'));
    await env.shot('rw-commercial-rates-search.png');

    T.section('Rates: the header\'s actions call Current\'s chains');
    await headerAction(page, '#ratesRwHead', 'Edit details');
    await page.waitForSelector('#schedForm', { timeout: 10000 });
    T.check('Edit details: the details form, as Current\'s button', await page.isVisible('#schedName') && (await page.inputValue('#schedName')) === 'Pipeline North special');
    T.check('…and the action says Done with the details', (await headerMenu(page, '#ratesRwHead')).startsWith('Done with the details'));
    await headerAction(page, '#ratesRwHead', 'Add equipment');
    await page.waitForSelector('#ratesAddPanel', { timeout: 10000 });
    T.check('Add equipment: the add panel, as Current\'s button', await page.isVisible('#ratesAddPanel'));
    const mark = env.writes.length;
    await page.locator('#ratesRwHead button:visible', { hasText: 'Save schedule' }).first().click();
    await page.waitForFunction(() => /was saved/.test((document.querySelector('#ratesSaveNote') || {}).innerText || ''), null, { timeout: 20000 });
    T.eq('Save schedule (the band\'s button): Current\'s save, the header then its rate', ws(env, mark).join(' > '), 'PUT /rate-schedules/11 > PUT /rate-period-lines/21');
    T.eq('…and it says so on the page', await env.text('#ratesSaveNote'), 'Pipeline North special was saved: the details and its rate.');
    const dm = env.writes.length;
    await headerAction(page, '#ratesRwHead', 'Delete');
    await page.waitForSelector('.nx-cm-ask', { timeout: 10000 });
    T.check('Delete asks first (Current\'s question), under the header and over the schedule', (await env.text('.nx-cm-ask')).startsWith('Delete Pipeline North special?')
      && await page.evaluate(() => {
        const h = document.querySelector('#ratesRwHead').getBoundingClientRect();
        const a = document.querySelector('.nx-cm-ask').getBoundingClientRect();
        const d = document.querySelector('.nx-cm-detail').getBoundingClientRect();
        return a.top >= h.bottom - 1 && a.bottom <= d.top + 1;
      }));
    await page.click('.nx-cm-ask button[data-answer="cancel"]');
    await settle(page, 300);
    T.check('…Keep it: nothing deleted, the schedule still open', !(await page.$('.nx-cm-ask')) && env.writes.length === dm
      && (await header(page, '#ratesRwHead')).title === 'Pipeline North special');
    await page.click('#ratesRwHead button[aria-label="Back"]');
    await page.waitForSelector('#ratesRwList:not([hidden])', { timeout: 10000 });
    T.eq('back on the list, as it was filtered', (await rwKeys(page, '#ratesRwTable')).join(), 'Pipeline North special');
    T.eq('no browser errors on Rates', errs().join(' | ').slice(0, 1500), '');

    // ════ Agreements: Oracle's Smart Search page ═════════════════════════════════════════════════════════
    T.section('Agreements in Redwood: Oracle\'s Smart Search page');
    await page.click('.nx-nav-item[data-nav-id="agreements"]');
    await page.waitForSelector('#agrRwList oj-sp-smart-search-page', { timeout: 20000 });
    await page.waitForFunction(() => /RNT-0001/.test((document.querySelector('#agrRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    T.eq('Oracle\'s components, upgraded', await complete(page, '#agrRwList', ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button']),
      'oj-sp-smart-search-page:true oj-sp-smart-search:true oj-sp-collection-container:true oj-table:true oj-c-button:true');
    const aHead = await env.text('#agrRwList oj-sp-smart-search-page');
    T.check('the header: Agreements, the summary, New agreement its primary action', aHead.startsWith('Agreements')
      && aHead.includes('4 agreements · 1 active · 1 ending within 60 days · 2 waiting for approval')
      && (await page.locator('#agrRwList button:visible', { hasText: 'New agreement' }).count()) > 0, aHead.slice(0, 200));
    T.check('Next\'s head, search box and chips are not there', !(await page.$('.nx-agreements .nx-pagehead')) && !(await page.$('.nx-agreements .nx-chips'))
      && !(await page.$('.nx-cm-agrid')));
    T.eq('a row per agreement, newest first (as Current)', (await rwKeys(page, '#agrRwTable')).join(), 'RNT-0003,ST-0001,RNT-0002,RNT-0001');
    const ar = await rwRows(page, '#agrRwTable');
    T.check('a row: number and name, customer, type, status, valid and when it ends, lines, the next step', ar.some((r) => r.startsWith('RNT-0002 Lone Star MSA Lone Star Paving RENTAL Active')
      && r.includes('Ends in 45 days 2 lines Ends in 45 days: renew it with the customer, or let it end')), ar.join(' || '));
    T.eq('statuses are Oracle\'s oj-badge', await page.$$eval('#agrRwTable [title^="Stored status"]', (b) => b.map((x) => x.className + '=' + x.innerText.trim()).join(' | ')),
      'oj-badge oj-badge-info oj-badge-subtle=Pending | oj-badge oj-badge-subtle=Draft | oj-badge oj-badge-success oj-badge-subtle=Active | oj-badge oj-badge-subtle=Expired');
    T.check('every column fits: the table does not scroll sideways', await page.$eval('#agrRwTable .oj-table-scroller', (sc) => sc.scrollWidth <= sc.clientWidth + 1));
    await env.shot('rw-commercial-agreements.png');

    T.section('Agreements: a filter per column; one narrows the rows');
    T.eq('the filters are the columns', await chips(page, '#agrRwList', 7), 'Agreement,Customer,Type,Status,Valid,Lines,Next step');
    T.eq('Status offers the list\'s chips, with how many', (await filterOptions(page, '#agrRwList', 'Status', 'Draft (1)')).join(' | '),
      'All (4) | Ending soon (1) | Draft (1) | Pending (1) | Active (1) | Expired (1)');
    await pickOption(page, '#agrRwList', 'Draft (1)');
    await page.waitForFunction(() => !/RNT-0001/.test((document.querySelector('#agrRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 600);
    T.eq('picked: the drafts', (await rwKeys(page, '#agrRwTable')).join(), 'ST-0001');

    T.section('Agreements: a row opens the agreement in its tab, as on Current');
    await page.click('#agrRwTable .nx-rw-num');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'agreement:ST-0001', null, { timeout: 15000 });
    await page.waitForSelector('#agrRwHead:visible', { timeout: 20000 });
    await page.waitForFunction(() => /Short term trench kit/.test(Array.from(document.querySelectorAll('#agrRwHead')).map((e) => e.innerText).join(' ')), null, { timeout: 20000 });
    await settle(page, 800);
    T.eq('its own tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId + '=' + t.innerText.trim()), 'agreement:ST-0001=ST-0001');

    // ════ An agreement: Oracle's general overview header over its own body ══════════════════════════════
    T.section('An agreement in Redwood: Oracle\'s header over its own body');
    T.eq('Oracle\'s general overview page, upgraded', await complete(page, '#agrRwHead', ['oj-sp-general-overview-page']), 'oj-sp-general-overview-page:true');
    const ah = await header(page, '#agrRwHead');
    T.eq('the header: its name and its status as Oracle\'s badge', ah.title + ' / ' + ah.badge, 'Short term trench kit / Draft (neutral)');
    T.check('…the kicker and its line, Approve on the band', ah.text.includes('Rental agreement · SHORT_TERM · ST-0001 · Acme Utilities ·') && ah.text.includes('Approve'), ah.text);
    T.check('…and in-flow back to Agreements', (await page.locator('#agrRwHead:visible button[aria-label="Back"]').count()) === 1);
    T.check('Current\'s head is not there; the body is: what is next, its lines, its facts', (await visibleText(page, '.nx-agreement .nx-pagehead')) === ''
      && (await visibleText(page, '#agrNext')) === 'Next: Finance to approve it; then its lines can be requested'
      && (await visibleText(page, '.nx-cm-lgrid')).includes('Trench box 8x20') && (await visibleText(page, '.nx-agreement .nx-facts')).includes('Acme Utilities'));
    T.eq('its other actions, as Current\'s head', await headerMenu(page, '#agrRwHead:visible'), 'Reject, Edit, Export the lines, Refresh');
    await env.shot('rw-commercial-agreement.png');

    T.section('An agreement: Edit and Cancel, then Approve, from the header');
    await headerAction(page, '#agrRwHead:visible', 'Edit');
    await page.waitForSelector('#agrName:visible', { timeout: 20000 });
    await settle(page, 600);
    const eh = await header(page, '#agrRwHead');
    T.check('Edit: the form, under the header (Save agreement on the band)', eh.title === 'Short term trench kit' && eh.text.includes('Edit agreement · ST-0001')
      && eh.text.includes('Save agreement') && (await page.inputValue('#agrName:visible')) === 'Short term trench kit', JSON.stringify(eh));
    T.check('…no back while editing: Cancel is its other action (one action: a button, not a menu)',
      (await page.locator('#agrRwHead:visible button[aria-label="Back"]:visible').count()) === 0
      && (await page.locator('#agrRwHead:visible button[aria-label="More Actions"]:visible').count()) === 0
      && (await page.locator('#agrRwHead:visible button:visible', { hasText: 'Cancel' }).count()) > 0);
    await env.shot('rw-commercial-agreement-edit.png');
    await headerAction(page, '#agrRwHead:visible', 'Cancel');
    await page.waitForSelector('#agrNext:visible', { timeout: 20000 });
    await settle(page, 400);
    const ch = await header(page, '#agrRwHead');
    T.eq('Cancel: the agreement as saved', [!!(await page.$('#agrName:visible')), ch.title, ch.badge].join(' / '), 'false / Short term trench kit / Draft (neutral)');
    const am = env.writes.length;
    await page.locator('#agrRwHead:visible button:visible', { hasText: 'Approve' }).first().click();
    await page.waitForSelector('#agrNote:visible', { timeout: 20000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#agrRwHead .oj-sp-header-general-overview-badge-text'))
      .some((e) => e.getClientRects().length && e.innerText.trim() === 'Active'), null, { timeout: 20000 });
    await settle(page, 500);
    T.eq('Approve (the band\'s button): Current\'s Approve, the status alone', ws(env, am).join(), 'PATCH /agreement-headers/32 {"status":"ACTIVE"}');
    T.eq('…read back: Active in the badge, it says so', [(await header(page, '#agrRwHead')).badge, await visibleText(page, '#agrNote')].join(' / '),
      'Active (success) / ST-0001 is approved and active: its lines can be requested now.');
    T.check('…nothing left to approve: the band\'s button goes; its lines can be requested', (await page.locator('#agrRwHead:visible button:visible', { hasText: 'Approve' }).count()) === 0
      && (await page.locator('#agrCreateRequest:visible').count()) === 1);
    await page.click('#agrRwHead:visible button[aria-label="Back"]');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'agreements', null, { timeout: 15000 });
    T.check('in-flow back: the Agreements tab', await page.isVisible('#agrRwTable'));
    T.eq('no browser errors in Redwood', errs().join(' | ').slice(0, 1500), '');

    // ════ Current again ═════════════════════════════════════════════════════════════════════════════════
    T.section('Current again: every screen as it was, on the same state');
    const from = errs().length;
    await env.setLook('current');
    await page.waitForSelector('.nx-agreements .nx-pagehead', { timeout: 15000 });
    T.check('Agreements: Next\'s head, chips and rows; the Redwood view kept, hidden', (await look()) === 'current' && await page.isVisible('.nx-agreements .nx-pagehead')
      && await page.isVisible('.nx-cm-agrid') && !(await page.isVisible('#agrRwList')) && !!(await page.$('#agrRwList')));
    T.eq('…filtered as Redwood left it (Status: Draft is its chip)', await page.getAttribute('.nx-agreements .nx-chip[data-value="DRAFT"]', 'aria-pressed'), 'true');
    await page.click('.nx-tab-btn[data-id="agreement:ST-0001"]');
    await page.waitForSelector('.nx-agreement .nx-pagehead:visible', { timeout: 15000 });
    T.eq('the agreement: Current\'s head again', await visibleText(page, '.nx-agreement .nx-record-title'), 'Short term trench kit Active');
    T.check('…its Redwood header hidden', (await visibleText(page, '#agrRwHead')) === '');
    await page.click('.nx-tab-btn[data-id="rates"]');
    await page.waitForSelector('.nx-cm-list', { timeout: 15000 });
    await settle(page, 500);
    T.check('Rates: Next\'s head and the left-hand list again; the Redwood views hidden', await page.isVisible('.nx-rates .nx-pagehead') && await page.isVisible('.nx-cm-list')
      && !(await page.isVisible('#ratesRwList')) && !(await page.isVisible('#ratesRwHead')));
    T.eq('…the schedule Redwood opened is the one open', [await env.text('#schedTitle'), await page.getAttribute('.nx-cm-item--on', 'data-id')].join(' / '),
      'Pipeline North special Active / 11');
    T.check('…the open schedule beside the list, as before', await page.evaluate(() => {
      const l = document.querySelector('.nx-cm-list').getBoundingClientRect();
      const d = document.querySelector('.nx-cm-detail').getBoundingClientRect();
      return l.width > 200 && l.width < 300 && d.left > l.right;
    }));
    await env.shot('rw-commercial-current.png');
    T.eq('no browser errors after switching back', errs().slice(from).join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('run finished', false, String((e && e.stack) || e).slice(0, 1500));
    await env.shot('rw-commercial-failed.png').catch(() => {});
  } finally {
    await env.close();
  }
  T.report();
})();
