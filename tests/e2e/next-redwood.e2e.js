'use strict';
/*
 * EquipRite Next, the Redwood look of Requests, in a real browser: the Redwood | Current switch; the Redwood look is
 * Oracle's own page template (oj-sp-smart-search-page) with Smart Search, an oj-table, oj-c buttons and oj-badge, on the
 * same requests, filters and steps as the current look; a row opens its request; a step button takes its step; the
 * choice is kept for the next visit; the current look is unchanged.
 * Needs `npm run build`. Run: node tests/e2e/next-redwood.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const REQ = {
  4001: { requestNumber: 'REQ-4001', status: 'SUBMITTED', projectName: 'Pier B', requestorName: 'User Rite' },
  4002: { requestNumber: 'REQ-4002', status: 'IN_PROCESS', projectName: 'Plant C', requestorName: 'Dana Cole' },
  4003: { requestNumber: 'REQ-4003', status: 'IN_PROCESS', projectName: 'Gas Line', requestorName: 'User Rite' },
};
const LINES = [
  { id: 1, req: 4001, name: 'Komatsu D65EX-18 Dozer', status: 'SUBMITTED' },
  { id: 2, req: 4002, name: 'CAT 320 Excavator', status: 'SHIP_TO_SITE' },
  { id: 3, req: 4003, name: 'Roller 10t', status: 'SCHEDULED_FOR_PICKING' },
];
const lineRow = (l) => ({ requestNumber: REQ[l.req].requestNumber, lineId: l.id, lineNumber: l.id, equipmentName: l.name, qty: 1, quantity: 1, lineStatus: l.status,
  allocationStatus: l.status === 'SUBMITTED' ? 'PENDING' : 'ALLOCATED', requestStatus: REQ[l.req].status, projectName: REQ[l.req].projectName,
  requestedStartDate: day(3), requestedEndDate: day(20), requestorName: REQ[l.req].requestorName });

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  let m;
  if (p === '/views/my-requests') {
    return res.json({ data: Object.keys(REQ).map((id) => Object.assign({ eqrEquipmentRequestId: Number(id), startDate: day(3), endDate: day(20), requestOrigin: 'Internal' }, REQ[id])) });
  }
  if (p === '/views/my-request-lines') return res.json({ data: LINES.map(lineRow) });
  if (p === '/views/request-detail-lines') return res.json({ data: LINES.filter((l) => l.req === Number(q.get('requestId'))).map(lineRow) });
  if ((m = /^\/equipment-requests\/(\d+)$/.exec(p))) {
    const r = REQ[m[1]];
    return res.json({ id: Number(m[1]), requestNumber: r.requestNumber, status: r.status, requestorName: r.requestorName, requestType: 'INTERNAL' });
  }
  return undefined;
}

const settle = (page, ms) => page.waitForTimeout(ms || 400);
const rwRows = (page) => page.$$eval('#reqRwTable tbody tr, #reqRwTable .oj-table-body-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /REQ-/.test(t)));

(async () => {
  const env = await E.start({ port: 19530, handle, app: 'next', sessionRole: 'ADMIN' });
  const { page } = env;
  try {
    await env.open('/?open=requests');
    await page.waitForSelector('.nx-grid--req .nx-row--click', { timeout: 30000 });
    await settle(page, 500);

    T.section('the switch, on the current look');
    T.eq('Redwood | Current, Current on', await page.$$eval('.nx-uiswitch .nx-seg-btn', (b) => b.map((x) => x.innerText.trim() + ':' + x.getAttribute('aria-pressed')).join(' ')),
      'Redwood:false Current:true');
    T.check('the current look as it was', !!(await page.$('.nx-requests .nx-pagehead')) && !(await page.$('#reqRedwood')));

    T.section('the Redwood look: Oracle\'s page template and components');
    await page.click('#reqUiRedwood');
    await page.waitForSelector('#reqRedwood oj-sp-smart-search-page', { timeout: 20000 });
    await page.waitForFunction(() => /REQ-4001/.test((document.querySelector('#reqRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    T.check('Oracle\'s components, upgraded: smart search page, Smart Search, collection container, oj-table, oj-c buttons',
      await page.evaluate(() => ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button', 'oj-c-buttonset-single']
        .every((t) => { const el = document.querySelector('#reqRedwood ' + t); return el && el.classList.contains('oj-complete'); })),
      await page.evaluate(() => ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button', 'oj-c-buttonset-single']
        .map((t) => { const el = document.querySelector('#reqRedwood ' + t); return t + ':' + (el ? el.className : 'missing'); }).join(' | ')));
    T.check('the template\'s own header: the title and the summary', (await env.text('#reqRedwood oj-sp-smart-search-page')).includes('Requests')
      && (await env.text('#reqRedwood oj-sp-smart-search-page')).includes('3 requests'));
    T.check('Next\'s own head and chips step aside', !(await page.isVisible('.nx-requests .nx-pagehead')) && !(await page.$('.nx-requests > .nx-chips')));
    const rows = await rwRows(page);
    T.eq('a table row per request', rows.length, 3);
    T.check('a row: number, type and requester, project, status as a Redwood badge, dates, next step', rows.some((r) => r.includes('REQ-4002') && r.includes('Project · Dana Cole')
      && r.includes('Plant C') && r.includes('On the way') && r.includes('Site to accept the delivery')), rows.join(' || '));
    T.check('every column fits: no table scrolling sideways', await page.$eval('#reqRwTable .oj-table-scroller', (sc) => sc.scrollWidth <= sc.clientWidth + 1));
    T.check('the status is Oracle\'s oj-badge', await page.$$eval('#reqRwTable .oj-badge', (b) => b.length) === 3);
    const steps = await page.$$eval('#reqRwTable oj-c-button[data-act]', (b) => b.map((x) => x.getAttribute('data-number') + ':' + x.getAttribute('data-act')).sort().join(' '));
    T.eq('the row steps, as oj-c buttons (as on the current look)', steps, 'REQ-4001:approve REQ-4002:accept REQ-4003:pick');
    T.check('fits: nothing sideways', await page.evaluate(() => { const c = document.querySelector('.nx-content'); return !c || c.scrollWidth <= c.clientWidth + 1; }));
    await env.shot('next-redwood-requests.png');

    T.section('Smart Search filters the same requests');
    const input = await page.$('#reqRedwood oj-sp-smart-search input');
    T.check('a search field in the Smart Search', !!input);
    if (input) {
      await input.click();
      await input.type('Gas', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !/REQ-4001/.test((document.querySelector('#reqRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
      await settle(page, 600);
      T.eq('typed text: one request', (await rwRows(page)).map((r) => r.match(/REQ-\d+/)[0]).join(), 'REQ-4003');
      await env.shot('next-redwood-search.png');
    }

    T.section('a row opens its request; a step button takes its step');
    await page.click('#reqRwTable oj-c-button[data-act="pick"]');
    await page.waitForSelector('#reqPop .nx-road-step', { timeout: 10000 });
    T.check('Pick: the "Getting it to site" popup, as from the current look', (await env.text('#reqPop')).includes('REQ-4003'));
    await page.click('#reqPop .nx-dialog-head .nx-iconbtn');
    await settle(page, 300);
    T.check('the step did not also open the request', (await page.$eval('.nx-tab--on', (t) => t.dataset.tabId)) === 'requests');
    await page.click('#reqRwTable .nx-rw-num');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'request:4003', null, { timeout: 15000 });
    T.eq('a row opens the request in its tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:4003');

    const errs = () => env.errors.filter((e) => !/404|Failed to load resource/.test(e));
    T.eq('no browser errors while working in it', errs().join(' | ').slice(0, 1500), '');

    T.section('the choice is kept; Current brings the current look back');
    // A reload tears the whole page down mid-flight (Smart Search's own timers can fire on the gone page): errors are
    // counted again from the reloaded page on.
    await env.open('/?open=requests');
    const from = errs().length;
    await page.waitForSelector('#reqRedwood oj-sp-smart-search-page', { timeout: 30000 });
    T.check('reopened: Redwood, as left', !!(await page.$('#reqRedwood')));
    await page.waitForSelector('#reqUiSet.oj-complete', { timeout: 15000 });
    await page.click('#reqUiSet >> text=Current');
    await page.waitForSelector('.nx-grid--req .nx-row--click', { timeout: 15000 });
    T.check('Current: the current look again (the Redwood look kept, hidden)', !(await page.isVisible('#reqRedwood')) && await page.isVisible('.nx-requests .nx-pagehead'));
    await page.click('#reqUiRedwood');
    await page.waitForFunction(() => { const r = document.querySelector('#reqRedwood'); return r && !r.hidden; }, null, { timeout: 10000 });
    T.check('and back to Redwood at once, as it was', await page.isVisible('#reqRwTable') && !(await page.isVisible('.nx-requests .nx-pagehead')));
    T.eq('no browser errors after the reload, switching back included', errs().slice(from).join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('run finished', false, String((e && e.stack) || e).slice(0, 1500));
  } finally {
    await env.close();
  }
  T.report();
})();
