'use strict';
/*
 * EquipRite Next, Compare rates (flows/commercial rate-compare; rules resources/js/rateCompare.js), in a real browser:
 * the first active schedules picked (the first the base), each tier's Rate / day side by side with the cheapest and
 * dearest marked and each against the base; make another the base; a tier, a search, only the differences; a rental
 * priced by each schedule; remove and add a schedule; export; opened from Rates with the open schedule as the base;
 * then the Redwood look: Oracle's header and Oracle's table with a column per schedule.
 * Needs `npm run build`. Run: node tests/e2e/next-rate-compare.e2e.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const V1 = '/equiprite/v1';

const SCHEDULES = [
  { id: 1, scheduleName: 'Gulf base 2026', scheduleCode: 'RS-GULF', currencyCode: 'USD', effectiveFrom: '2026-01-01T00:00:00Z', isActiveFlag: 'Y', yardOrgId: 300 },
  { id: 2, scheduleName: 'Pipeline North special', scheduleCode: 'RS-PN', currencyCode: 'USD', effectiveFrom: '2026-03-01T00:00:00Z', isActiveFlag: 'Y',
    projectName: 'Pipeline North' },
  { id: 3, scheduleName: 'Odessa yard rates', scheduleCode: 'RS-ODESSA', currencyCode: 'USD', effectiveFrom: '2026-01-01T00:00:00Z', isActiveFlag: 'Y', yardOrgId: 400 },
  { id: 4, scheduleName: 'Old fallback', scheduleCode: 'RS-OLD', currencyCode: 'USD', effectiveFrom: '2025-01-01T00:00:00Z', isActiveFlag: 'N' },
];
const AV = { equipmentClassId: 7, equipmentClassName: 'Audio Visual', equipmentSubclassId: 71, equipmentSubclassName: 'Audio', calcMethod: 'UTILIZED_DURATION',
  calcBasis: 'DAILY', rateType: 'USAGE', objectVersionNumber: 1 };
const AVID = 'Avid VENUE S6L-32D Touring Mixing Console';
const SUB = 'd&b audiotechnik SL-SUB Cardioid Subwoofer';
const UOM = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH' };
let seq = 0;
const L = (schedule, eq, period, from, total, rate) => Object.assign({ id: ++seq, periodSeq: seq, rateScheduleId: schedule, equipmentName: eq, periodType: period,
  rateUom: UOM[period], fromUnit: from, periodAmount: total, costRate: rate, billRate: 0 }, AV);
const RATE_LINES = [
  L(1, AVID, 'DAILY', 0, 900, 900), L(1, AVID, 'WEEKLY', 5, 5040, 720), L(1, AVID, 'MONTHLY', 26, 17550, 585), L(1, SUB, 'DAILY', 0, 240, 240), L(1, SUB, 'WEEKLY', 5, 1344, 192),
  L(2, AVID, 'DAILY', 0, 950, 950), L(2, AVID, 'WEEKLY', 7, 4900, 700), L(2, AVID, 'MONTHLY', 26, 17550, 585), L(2, SUB, 'DAILY', 0, 240, 240),
  L(3, AVID, 'DAILY', 0, 850, 850),
  L(4, AVID, 'DAILY', 0, 990, 990),
];

function handle(req, res) {
  const p = req.path;
  const m = req.method;
  if (p.endsWith('/conf-equipment-settings')) return res.json({ data: [{ businessUnitId: 1, rateSource: 'EQUIPRITE_RATES' }] });
  if (p === V1 + '/bu-org-mappings') {
    return res.json({ data: [{ orgRole: 'EQUIPMENT_YARD', invOrgId: 300, invOrgName: 'Houston Yard', businessUnitId: 1 },
      { orgRole: 'EQUIPMENT_YARD', invOrgId: 400, invOrgName: 'Odessa Yard', businessUnitId: 1 }] });
  }
  if (p === V1 + '/rate-schedules' && m === 'GET') return res.json({ data: SCHEDULES });
  const rs = /\/rate-schedules\/(\d+)$/.exec(p);
  if (rs && m === 'GET') {
    const s = SCHEDULES.find((x) => x.id === Number(rs[1]));
    return res.json(s || {}, s ? 200 : 404);
  }
  // as the service may: every line, whatever rateScheduleId asks (the page keeps only the schedule's own)
  if (p === V1 + '/rate-period-lines' && m === 'GET') return res.json({ data: RATE_LINES });
  return undefined;
}

async function settle(page, ms) { await page.waitForTimeout(ms || 400); }
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const avidDaily = '#rcGrid .nx-cm-rc-row[data-key$="#DAILY"]';
const cellText = (page, rowSel, id) => text(page, `${rowSel} .nx-cm-rc-cell[data-schedule="${id}"]`);
const complete = (page, scope, tags) => page.evaluate((a) => a[1].map((t) => {
  const el = document.querySelector(a[0] + ' ' + t);
  return t + ':' + (el ? el.classList.contains('oj-complete') : 'missing');
}).join(' '), [scope, tags]);

(async () => {
  const env = await E.start({ port: 19740, handle, app: 'next' });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('Compare rates: the first active schedules, the first the base');
    await env.open('/?open=rate-compare');
    await page.waitForSelector('#rcGrid .nx-cm-rc-row[data-key]', { timeout: 30000 });
    await settle(page, 800);
    T.eq('its menu item, under Commercial', await text(page, '.nx-nav-item--on'), 'Compare rates');
    T.eq('the cards: active ones by name, the first the base', (await texts(page, '#rcCards .nx-cm-rc-cardname')).join(' | '),
      'Gulf base 2026 | Odessa yard rates | Pipeline North special');
    T.check('…the base marked, and what each is', (await text(page, '#rcCards .nx-cm-rc-card--base')).includes('Base')
      && (await text(page, '#rcCards [data-schedule="1"]')).includes('Yard Houston Yard'));
    T.eq('the others to add', (await texts(page, '#rcAdd .nx-chip')).join(' | '), 'Old fallback (inactive)');
    T.eq('the grid: Equipment, Tier, a column per schedule', (await page.$$eval('#rcGrid .nx-cm-rc-row--head [role="columnheader"]', (h) => h.map((x) => x.textContent.replace(/\s+/g, ' ').trim()))).join(' | '),
      'Equipment | Tier | Gulf base 2026 Base · USD | Odessa yard rates USD | Pipeline North special USD');
    T.check('…side by side: every cell of a row on one line', await page.$eval(avidDaily, (r) => { const t = [...r.children].map((c) => Math.round(c.getBoundingClientRect().top)); return t.every((x) => x === t[0]); }));
    const a1 = await cellText(page, avidDaily + '[data-key*="Avid"]', 1);
    const a3 = await cellText(page, avidDaily + '[data-key*="Avid"]', 3);
    const a2 = await cellText(page, avidDaily + '[data-key*="Avid"]', 2);
    T.eq('…the base', a1, '$900 / day Period total $900 Threshold 0 days');
    T.eq('…the cheapest', a3, '$850 / day Cheapest −5.6% vs base Period total $850 Threshold 0 days');
    T.eq('…the dearest', a2, '$950 / day Dearest +5.6% vs base Period total $950 Threshold 0 days');
    T.eq('the line over it', await text(page, '#rcInsight'), '5 rates 5 of 5 rates differ · cheapest most often: Odessa yard rates (1), Pipeline North special (1)');
    T.check('a schedule without the tier says so', (await cellText(page, '#rcGrid .nx-cm-rc-row[data-key*="Avid"][data-key$="#WEEKLY"]', 3)) === '— Not in this schedule');
    T.check('and the page reads only: no writes', env.writes.length === 0);
    await env.shot('next-rate-compare.png');

    T.section('another base, a tier, a search, only the differences');
    await page.click('#rcCards [data-schedule="2"] .nx-cm-rc-makebase');
    await page.waitForFunction(() => /Pipeline North special/.test((document.querySelector('#rcCards .nx-cm-rc-card--base') || {}).innerText || ''), null, { timeout: 10000 });
    await settle(page, 400);
    T.eq('Pipeline North the base: first, and the others against it', [(await texts(page, '#rcCards .nx-cm-rc-cardname')).join(' | '),
      await cellText(page, avidDaily + '[data-key*="Avid"]', 1)].join(' / '), 'Pipeline North special | Gulf base 2026 | Odessa yard rates / $900 / day −5.3% vs base Period total $900 Threshold 0 days');
    T.check('…its card says how it compares on average', (await text(page, '#rcCards [data-schedule="1"] .nx-cm-rc-cardavg')).includes('against the base on average'));
    await page.click('#rcPeriods .nx-chip[data-value="WEEKLY"]');
    await settle(page, 500);
    T.eq('Weekly only', (await texts(page, '#rcGrid .nx-cm-rc-row:not(.nx-cm-rc-row--head) .nx-cm-rc-tier')).join(','), 'Weekly,Weekly');
    T.check('a tier starting elsewhere says so', (await cellText(page, '#rcGrid .nx-cm-rc-row[data-key*="Avid"][data-key$="#WEEKLY"]', 1)).includes('Starts at 5, the base at 7'));
    await page.click('#rcPeriods .nx-chip[data-value=""]');
    await page.fill('#rcSearch', 'subwoofer');
    await settle(page, 600);
    T.eq('a search', (await texts(page, '#rcGrid .nx-cm-rc-row:not(.nx-cm-rc-row--head) .nx-cm-rc-eq .nx-cell-main')).map((t) => t.includes('SL-SUB')).join(','), 'true,true');
    await page.fill('#rcSearch', '');
    await settle(page, 400);
    await page.click('#rcCards [data-schedule="3"] .nx-cm-rc-x');
    await page.waitForFunction(() => document.querySelectorAll('#rcCards .nx-cm-rc-card').length === 2, null, { timeout: 10000 });
    await page.check('#rcOnlyDiff');
    await settle(page, 600);
    T.eq('two schedules, only where they differ', (await texts(page, '#rcGrid .nx-cm-rc-row:not(.nx-cm-rc-row--head) .nx-cm-rc-tier')).join(','), 'Daily,Weekly,Weekly');
    T.eq('…said', await text(page, '#rcInsight'), '3 of 5 rates 3 of 3 rates differ · cheapest most often: Pipeline North special (1), Gulf base 2026 (1)');
    await page.uncheck('#rcOnlyDiff');
    await page.click('#rcAdd .nx-chip[data-id="3"]');
    await page.waitForFunction(() => document.querySelectorAll('#rcCards .nx-cm-rc-card').length === 3, null, { timeout: 10000 });
    await settle(page, 400);
    T.check('added back, at the end', (await texts(page, '#rcCards .nx-cm-rc-cardname')).join(' | ') === 'Pipeline North special | Gulf base 2026 | Odessa yard rates');

    T.section('a rental priced by each schedule');
    await page.click('#rcModeRental');
    await page.waitForSelector('#rcDays', { timeout: 10000 });
    await page.fill('#rcDays', '14');
    await page.dispatchEvent('#rcDays', 'change');
    await settle(page, 600);
    const avid = '#rcGrid .nx-cm-rc-row[data-key*="Avid"]';
    T.eq('…Pipeline North (the base): its weekly tier', await cellText(page, avid, 2), '$9,800 Cheapest Weekly tier · 14 × $700 a day');
    T.eq('…Gulf base', await cellText(page, avid, 1), '$10,080 +2.9% vs base Weekly tier · 14 × $720 a day');
    T.eq('…Odessa: only a daily rate', await cellText(page, avid, 3), '$11,900 Dearest +21.4% vs base Daily tier · 14 × $850 a day');
    T.eq('the column says it', await page.$eval('#rcGrid .nx-cm-rc-row--head [role="columnheader"]:nth-child(2)', (h) => h.textContent.trim()), 'Rental');
    await env.shot('next-rate-compare-rental.png');

    T.section('export');
    await page.click('#rcExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.nx-menu-item[data-format="csv"]')]);
    const file = path.join(os.tmpdir(), 'next-rc-' + dl.suggestedFilename());
    await dl.saveAs(file);
    const csv = fs.readFileSync(file, 'utf8');
    T.check('a CSV of what is shown: a value, against the base and a note per schedule', /^equiprite-rate-comparison-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename())
      && csv.includes('Pipeline North special cost (USD)') && csv.includes('Gulf base 2026 against the base') && csv.includes('9800') && csv.includes('+2.9%'), dl.suggestedFilename());
    await page.click('#rcModeTiers');
    await settle(page, 500);

    T.section('from Rates: Compare schedules, the open schedule the base');
    await env.open('/?open=rates');
    await page.waitForSelector('#ratesCompare', { timeout: 30000 });
    await page.waitForSelector('.nx-cm-rgrid .nx-cm-rrow', { timeout: 30000 });
    const open = (await text(page, '#schedTitle')).replace(/ Active$/, '');
    await page.click('#ratesCompare');
    await page.waitForFunction((n) => ((document.querySelector('#rcCards .nx-cm-rc-card--base .nx-cm-rc-cardname') || {}).innerText || '').trim() === n, open, { timeout: 15000 });
    T.eq('Compare rates, with ' + open + ' the base', await text(page, '#rcCards .nx-cm-rc-card--base .nx-cm-rc-cardname'), open);
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');

    T.section('Redwood: Oracle\'s header, and Oracle\'s table with a column per schedule');
    await env.setLook('redwood');
    await page.waitForSelector('#rcRedwood:not([hidden]) oj-sp-general-overview-page', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#rcRwTable .oj-table-body-row').length > 0, null, { timeout: 20000 });
    await settle(page, 1200);
    T.eq('Oracle\'s templates, upgraded', [await complete(page, '#rcRedwood', ['oj-sp-general-overview-page']), await complete(page, '.nx-cm-rc-rw', ['oj-table'])].join(' '),
      'oj-sp-general-overview-page:true oj-table:true');
    T.check('the header: Compare rates, and the comparison in a line', (await text(page, '#rcRedwood h1')) === 'Compare rates'
      && (await text(page, '#rcRedwood')).includes('rates differ'));
    const heads = await texts(page, '#rcRwTable .oj-table-column-header-text');
    T.check('the table: Equipment, Tier, a column per schedule (the base marked)', heads.join(' | ').startsWith('Equipment | Tier | ' + open + ' · base'), heads.join(' | '));
    const first = (await texts(page, '#rcRwTable .oj-table-body-row'))[0] || '';
    T.check('…a row: each schedule\'s Rate / day, the marks and against the base', first.includes('Avid') && first.includes('/ day') && /Cheapest|Dearest/.test(first)
      && first.includes('vs base'), first);
    T.check('…the marks as Oracle\'s badges', (await page.$$eval('#rcRwTable .oj-badge', (b) => b.length)) > 0);
    T.check('Current\'s grid is not shown', !(await page.isVisible('#rcGrid')));
    await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTop = 0; });
    await env.shot('next-rate-compare-redwood.png');
    T.eq('no browser errors in Redwood', errs().join(' | ').slice(0, 1500), '');
    await env.setLook('current');
    await page.waitForSelector('#rcGrid', { timeout: 20000 });
    T.check('Current again: the grid, the same schedules', (await texts(page, '#rcCards .nx-cm-rc-cardname'))[0] === open);
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
  }
  T.report();
})();
