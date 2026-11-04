'use strict';
/*
 * EquipRite Next, the Redwood look, in a real browser: chosen in your menu (under your name, with the EquipRite
 * version), Redwood or Current, for every screen; kept for you after a reload. Redwood draws the shell and every
 * screen as Oracle's Redwood (the page header and its colour strip, the call-to-action button, white menu, tabs);
 * Requests is Oracle's own Smart Search page (oj-sp-smart-search-page, Smart Search, oj-table, oj-c buttons,
 * oj-badge) on the same requests, filters and steps; Current is the look as it was.
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

    const look = () => page.getAttribute('html', 'data-nx-look');
    const css = (sel, prop, pseudo) => page.$eval(sel, (el, a) => getComputedStyle(el, a[1] || null).getPropertyValue(a[0]), [prop, pseudo || '']);
    const headBg = () => css('.nx-requests .nx-pagehead', 'background-color');

    T.section('Current, to start: the look as it was, no switch on the page');
    T.eq('Current on every screen', await look(), 'current');
    T.check('the current Requests list, its head in Next\'s teal', !!(await page.$('.nx-requests .nx-pagehead')) && !(await page.$('#reqRedwood'))
      && (await headBg()) === 'rgb(46, 84, 104)', await headBg());
    T.check('no look switch on the page any more: it is in your menu', !(await page.$('.nx-uiswitch')) && !(await page.$('#reqUiSet')));

    T.section('your menu: the look, beside the version');
    await page.click('#nxUser');
    await page.waitForSelector('#nxLooks');
    T.eq('Look: Redwood and Current, Current chosen', await page.$$eval('#nxLooks .nx-look', (b) => b.map((x) => x.querySelector('.nx-look-name').innerText.trim()
      + ':' + x.getAttribute('aria-checked')).join(' ')), 'Redwood:false Current:true');
    T.check('…after the EquipRite version, before Colours', await page.evaluate(() => {
      const secs = Array.from(document.querySelectorAll('#nxProfilePanel .nx-profile-sec'));
      const at = (sel) => secs.findIndex((x) => !!x.querySelector(sel));
      return at('.nx-versions') < at('#nxLooks') && at('#nxLooks') < at('#nxThemes');
    }));
    await env.shot('next-look-menu.png');
    await page.click('#nxLook-redwood');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-nx-look') === 'redwood', null, { timeout: 10000 });
    T.eq('Redwood: chosen, marked', [await look(), await page.getAttribute('#nxLook-redwood', 'aria-checked'), await page.getAttribute('#nxLook-current', 'aria-checked')].join(),
      'redwood,true,false');
    T.check('Colours step aside: Redwood is Oracle\'s colours', !(await page.$('#nxThemes')) && (await env.text('#nxColoursRedwood')).includes('Oracle'));
    await env.shot('next-look-menu-redwood.png');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#nxProfilePanel', { state: 'detached', timeout: 5000 });

    T.section('Requests: Oracle\'s page template and components');
    await page.waitForSelector('#reqRedwood oj-sp-smart-search-page', { timeout: 20000 });
    await page.waitForFunction(() => /REQ-4001/.test((document.querySelector('#reqRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    T.check('Oracle\'s components, upgraded: smart search page, Smart Search, collection container, oj-table, oj-c buttons',
      await page.evaluate(() => ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button']
        .every((t) => { const el = document.querySelector('#reqRedwood ' + t); return el && el.classList.contains('oj-complete'); })),
      await page.evaluate(() => ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button']
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
    T.eq('the popup is Oracle\'s dialog: a white head, its title dark', [await css('#reqPop .nx-dialog-head', 'background-color'), await css('#reqPop .nx-dialog-title', 'color')].join(' | '),
      'rgb(255, 255, 255) | rgb(22, 21, 19)');
    await env.shot('next-redwood-dialog.png');
    await page.click('#reqPop .nx-dialog-head .nx-iconbtn');
    await settle(page, 300);
    T.check('the step did not also open the request', (await page.$eval('.nx-tab--on', (t) => t.dataset.tabId)) === 'requests');
    await page.click('#reqRwTable .nx-rw-num');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'request:4003', null, { timeout: 15000 });
    T.eq('a row opens the request in its tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:4003');

    T.section('every screen: the shell and My work in Redwood');
    T.eq('the call to action in the toolbar: Oracle\'s dark button, 4px corners', [await css('#nxNewRequest', 'background-color'), await css('#nxNewRequest', 'border-radius')].join(),
      'rgb(49, 45, 42),4px');
    T.eq('the menu: white, the open screen in Redwood\'s selection', [await css('#nxNav', 'background-color'), await css('.nx-nav-item--on', 'background-color')].join(' | '),
      'rgb(255, 255, 255) | rgb(228, 241, 247)');
    T.check('Oracle Sans', /Oracle Sans/.test(await css('.nx-app', 'font-family')) && await page.evaluate(() => document.fonts.check('16px "Oracle Sans"')));
    await page.click('.nx-tab[data-tab-id="home"] .nx-tab-btn');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'home', null, { timeout: 10000 });
    await settle(page, 800);
    const homeHead = await page.$$eval('.nx-pagehead', (hs) => {
      const h = hs.filter((x) => x.offsetParent !== null)[0];
      if (!h) return null;
      const st = getComputedStyle(h);
      return { bg: st.backgroundColor, strip: getComputedStyle(h, '::after').backgroundImage, h1: getComputedStyle(h.querySelector('h1')).fontSize };
    });
    T.check('My work\'s head: Oracle\'s Redwood header, its colour strip, a 28px title', !!homeHead && homeHead.bg === 'rgb(44, 82, 102)'
      && /colorstrip_redwood/.test(homeHead.strip) && homeHead.h1 === '28px', JSON.stringify(homeHead));
    await env.shot('next-redwood-mywork.png');

    const errs = () => env.errors.filter((e) => !/404|Failed to load resource/.test(e));
    T.eq('no browser errors while working in it', errs().join(' | ').slice(0, 1500), '');

    T.section('kept for you; Current brings the current look back everywhere');
    // A reload tears the whole page down mid-flight (Smart Search's own timers can fire on the gone page): errors are
    // counted again from the reloaded page on.
    await env.open('/?open=requests');
    const from = errs().length;
    await page.waitForSelector('#reqRedwood oj-sp-smart-search-page', { timeout: 30000 });
    T.eq('reopened: Redwood, as left', await look(), 'redwood');

    T.section('a filter per column, as Redwood (and Old) show them');
    await page.waitForFunction(() => /REQ-4001/.test((document.querySelector('#reqRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    // Smart Search lays its chips out after it has measured them (they show one by one): wait for all eight.
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#reqRedwood oj-sp-smart-search .oj-sp-filter-chip-container'))
      .filter((x) => x.innerText.trim()).length === 8, null, { timeout: 15000 }).catch(() => {});
    await settle(page, 800);
    T.eq('the filters are the columns, then Type and Requester', (await page.$$eval('#reqRedwood oj-sp-smart-search .oj-sp-filter-chip-container',
      (b) => b.map((x) => x.innerText.trim()))).join(','), 'Request,Project or customer,Status,Equipment,Dates,Next step,Type,Requester');
    await page.click('#reqRedwood oj-sp-smart-search .oj-sp-filter-chip-container:has-text("Equipment")');
    await page.waitForSelector('text=CAT 320 Excavator (1)', { timeout: 10000 });
    T.eq('Equipment offers what the requests hold, with how many', await page.$$eval('[role=option], li', (o) => o.filter((x) => x.offsetParent !== null)
      .map((x) => x.innerText.trim()).filter((t) => /^(CAT|Komatsu|Roller).*\(\d+\)$/.test(t)).join(',')), 'CAT 320 Excavator (1),Komatsu D65EX-18 Dozer (1),Roller 10t (1)');
    await page.click('text=CAT 320 Excavator (1)');
    await settle(page, 600);
    await page.click('#reqRedwood oj-sp-smart-search-page h1');
    await page.waitForFunction(() => !/REQ-4001/.test((document.querySelector('#reqRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 600);
    T.eq('picked (Smart Search applies it as its list closes): the requests with that equipment', (await rwRows(page)).map((r) => r.match(/REQ-\d+/)[0]).join(), 'REQ-4002');
    T.check('the header\'s colour runs on behind the top of the table, as in Old', /linear-gradient\(rgb\(44, 82, 102\)/.test(await css('.nx-requests', 'background-image')),
      await css('.nx-requests', 'background-image'));
    await env.shot('next-redwood-filters.png');

    await page.click('#nxUser');
    await page.waitForSelector('#nxLook-current');
    await page.click('#nxLook-current');
    await page.waitForSelector('.nx-grid--req .nx-row--click', { timeout: 15000 });
    T.check('Current: the current Requests again (the Redwood look kept, hidden)', (await look()) === 'current' && !(await page.isVisible('#reqRedwood'))
      && await page.isVisible('.nx-requests .nx-pagehead'));
    T.eq('…and Next\'s own colours everywhere', [await headBg(), await css('#nxNewRequest', 'background-color'), await css('#nxNav', 'background-color')].join(' | '),
      'rgb(46, 84, 104) | rgb(10, 102, 201) | rgb(29, 56, 70)');
    T.check('your colours are back in the menu', !!(await page.$('#nxThemes')));
    await page.click('#nxLook-redwood');
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
