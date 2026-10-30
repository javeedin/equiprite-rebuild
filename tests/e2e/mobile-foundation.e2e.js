'use strict';
/*
 * EquipRite Mobile, the foundation, in a phone-sized browser (390 x 844): the tabs each role gets (approver, picker,
 * requester, nobody), the tab bar and its count, My requests (cards, chips, search, a request's equipment and history,
 * the step buttons that open the tab taking them), a deep link, Me (role, install, versions), installable (manifest),
 * and with no connection (the strip, the saved copy). The lists open on the last 3 days: older requests are left out
 * (a line under the list says how many), All shows them, a search and a deep link reach them, and the tab counts
 * count what the tabs open on.
 * Needs `npm run build`. Run: node tests/e2e/mobile-foundation.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const REQ = {
  2001: { requestNumber: 'REQ-2001', status: 'SUBMITTED', projectName: 'Pier B', requestorName: 'Priya Raman', requestorUsername: 'priya.raman' },
  2002: { requestNumber: 'REQ-2002', status: 'IN_PROCESS', projectName: 'Plant C', requestorName: 'Dana Cole', requestorUsername: 'dana.cole' },
  2003: { requestNumber: 'REQ-2003', status: 'IN_PROCESS', projectName: 'EPC_MO_Operations', requestorName: 'Priya Raman', requestorUsername: 'priya.raman' },
  2004: { requestNumber: 'REQ-2004', status: 'SUBMITTED', projectName: 'Gas Line', requestorName: 'Dana Cole', requestorUsername: 'dana.cole' },
  2005: { requestNumber: 'REQ-2005', status: 'DRAFT', projectName: 'Pier B', requestorName: 'Priya Raman', requestorUsername: 'priya.raman' },
  // Older than the last 3 days: raised, changed, started and ended before them. Left out of the lists (and the counts)
  // until All, a search or a deep link asks for them.
  2006: { requestNumber: 'REQ-2006', status: 'IN_PROCESS', projectName: 'Old Quarry', requestorName: 'Priya Raman', requestorUsername: 'priya.raman',
    start: -40, end: -10, created: -45, updated: -9 },
  2007: { requestNumber: 'REQ-2007', status: 'SUBMITTED', projectName: 'Old Dock', requestorName: 'Dana Cole', requestorUsername: 'dana.cole', start: -30, end: -8, created: -35 },
};
const START = (r) => (r.start == null ? 5 : r.start);
const END = (r) => (r.end == null ? 30 : r.end);
const LINES = [
  { id: 1, req: 2001, name: 'Komatsu D65EX-18 Dozer', cls: 'Earthmoving', status: 'SUBMITTED', alloc: 'PENDING' },
  { id: 2, req: 2001, name: 'Bobcat S76 Skid Steer Loader', cls: 'Earthmoving', status: 'SUBMITTED', alloc: 'PENDING' },
  { id: 3, req: 2002, name: 'Mack Granite Mixer Truck', cls: 'Transport', status: 'IN_PROCESS', alloc: 'PENDING' },
  { id: 5, req: 2003, name: 'Volvo A30 Dump Truck', cls: 'Trucks', status: 'ALLOCATED', alloc: 'ALLOCATED' },
  { id: 6, req: 2003, name: 'Roller 10t', cls: 'Rollers', status: 'SCHEDULED_FOR_PICKING', alloc: 'ALLOCATED' },
  { id: 7, req: 2003, name: 'Generator 100kVA', cls: 'Power', status: 'DEPLOYED', alloc: 'ALLOCATED' },
  { id: 8, req: 2004, name: 'Light Tower', cls: 'Lighting', status: 'SUBMITTED', alloc: 'PENDING' },
  { id: 9, req: 2005, name: 'Tadano ATF 220G-5 Mobile Crane', cls: 'Lifting', status: 'DRAFT', alloc: 'PENDING' },
  { id: 10, req: 2006, name: 'Jaw Crusher', cls: 'Crushing', status: 'ALLOCATED', alloc: 'ALLOCATED' },
  { id: 11, req: 2007, name: 'Submersible Pump', cls: 'Pumps', status: 'SUBMITTED', alloc: 'PENDING' },
];
const HISTORY = {
  2003: [
    { requestId: 2003, fromStatus: 'DRAFT', toStatus: 'SUBMITTED', changedDate: day(-20) + 'T08:30:00Z', changedBy: 'priya.raman' },
    { requestId: 2003, lineId: 5, fromStatus: 'SUBMITTED', toStatus: 'IN_PROCESS', changedDate: day(-19) + 'T10:05:00Z', changedBy: 'javeed.shaik' },
  ],
};

const lineRow = (l) => ({ requestNumber: REQ[l.req].requestNumber, lineId: l.id, lineNumber: l.id, equipmentName: l.name, className: l.cls, qty: 1, quantity: 1,
  lineStatus: l.status, allocationStatus: l.alloc, requestStatus: REQ[l.req].status, projectName: REQ[l.req].projectName,
  requestedStartDate: day(START(REQ[l.req])), requestedEndDate: day(END(REQ[l.req])), requestorName: REQ[l.req].requestorName });

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  let m;
  if (p === '/views/my-requests') {
    return res.json({ data: Object.keys(REQ).map((id) => {
      const r = REQ[id];
      return Object.assign({ eqrEquipmentRequestId: Number(id), startDate: day(START(r)), endDate: day(END(r)), requestOrigin: 'Internal' },
        r.created != null ? { createdDate: day(r.created) + 'T08:00:00Z' } : {}, r.updated != null ? { lastUpdateDate: day(r.updated) + 'T09:30:00Z' } : {},
        { requestNumber: r.requestNumber, status: r.status, projectName: r.projectName, requestorName: r.requestorName, requestorUsername: r.requestorUsername });
    }) });
  }
  if (p === '/views/my-request-lines') return res.json({ data: LINES.map(lineRow) });
  if (p === '/views/request-detail-lines') return res.json({ data: LINES.filter((l) => l.req === Number(q.get('requestId'))).map(lineRow) });
  if (p === '/request-status-history') return res.json({ data: HISTORY[Number(q.get('requestId'))] || [] });
  if ((m = /^\/equipment-requests\/(\d+)$/.exec(p))) {
    const r = REQ[m[1]];
    return res.json({ id: Number(m[1]), requestNumber: r.requestNumber, status: r.status, requestorName: r.requestorName, createdDate: day(-21) + 'T07:45:00Z' });
  }
  return undefined;
}

const settle = (page, ms) => page.waitForTimeout(ms || 400);
const tabs = (page) => page.$$eval('#mbTabbar .mb-tabbtn', (b) => b.map((x) => x.dataset.tab).join(','));
const current = (page) => page.$eval('#mbTabbar .mb-tabbtn--on', (b) => b.dataset.tab).catch(() => '');
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
// The switcher keeps every tab's page; the one shown is the visible one.
const shown = (sel) => `${sel}:visible`;

async function role(name, access, expectTabs, expectFirst) {
  const env = await E.start({ port: 20460 + Object.keys(ROLES).indexOf(name) * 10, app: 'mobile', handle, access, sessionRole: 'REQUESTOR' });
  try {
    await env.open('/');
    await settle(env.page, 800);
    T.eq(`${name}: the tabs`, await tabs(env.page), expectTabs);
    T.eq(`${name}: opens on`, await current(env.page), expectFirst);
    await env.shot(`mobile-role-${name}.png`);
    T.eq(`${name}: no browser errors`, env.errors.join(' | '), '');
  } finally {
    await env.close();
  }
}
const ROLES = {
  requester: [{ EQR_PROJ_CREATE_REQUEST: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL' }, 'request,track,me', 'request'],
  picker: [{ EQR_INITIATE_PICKING: 'FULL', EQR_EQUIPMENT_REQUESTS: 'READ_ONLY' }, 'pick,track,me', 'pick'],
  readonly: [{ EQR_WORKBENCH: 'READ_ONLY', EQR_PROJ_CREATE_REQUEST: 'READ_ONLY' }, 'me', 'me'],
  nobody: [{}, 'me', 'me'],
};

(async () => {
  const env = await E.start({ port: 20400, app: 'mobile', handle });
  const { page } = env;
  try {
    T.section('the shell, for an Equipment Manager (every page FULL)');
    await env.open('/');
    await settle(page, 800);
    T.eq('every tab, in order', await tabs(page), 'approve,pick,request,track,me');
    T.eq('opens on the first work tab', await current(page), 'approve');
    T.eq('the top bar names the app', await env.text('.mb-top-title'), 'EquipRite');
    await page.waitForFunction(() => { const b = document.querySelector('.mb-tabbtn[data-tab="approve"] .mb-tabbadge'); return b && b.textContent.trim(); }, null, { timeout: 15000 });
    T.eq('Approve counts the requests waiting for a decision (of the last 3 days: not REQ-2007)', await env.text('.mb-tabbtn[data-tab="approve"] .mb-tabbadge'), '2');
    T.eq('Pick counts the pieces ready for the yard (of the last 3 days: not REQ-2006\'s)', await env.text('.mb-tabbtn[data-tab="pick"] .mb-tabbadge'), '2');
    T.eq('Request counts your drafts', await env.text('.mb-tabbtn[data-tab="request"] .mb-tabbadge'), '1');
    T.eq('the tab bar sits at the bottom of the screen', await page.$eval('#mbTabbar', (n) => Math.round(n.getBoundingClientRect().bottom)), 844);
    T.eq('no sideways scroll on a phone', await sideways(page), false);
    const head = await page.evaluate(() => ({
      manifest: (document.querySelector('link[rel="manifest"]') || {}).href || '',
      apple: (document.querySelector('link[rel="apple-touch-icon"]') || {}).href || '',
      theme: (document.querySelector('meta[name="theme-color"]') || {}).content || '',
      title: document.title,
    }));
    T.check('installable: a manifest in the head', /\/resources\/pwa\/manifest\.json$/.test(head.manifest), head.manifest);
    T.check('an iPhone home-screen icon', /apple-touch-icon\.png$/.test(head.apple), head.apple);
    T.eq('the bar colour', head.theme, '#2e5468');
    const manifest = await page.evaluate(async (u) => { const r = await fetch(u); return r.ok ? r.json() : null; }, head.manifest);
    T.eq('the manifest names the app and opens standalone', manifest && [manifest.name, manifest.display].join(), 'EquipRite Mobile,standalone');
    const start = await page.evaluate((u) => new URL(JSON.parse(JSON.stringify(u)).start, u.base).href, { start: manifest.start_url, base: head.manifest });
    T.eq('it starts at the app\'s own address', start, `${env.mobileUrl}/`);
    const icons = await page.evaluate(async (o) => Promise.all(o.icons.map(async (i) => {
      const r = await fetch(new URL(i.src, o.base).href);
      return r.ok && r.headers.get('content-type') === 'image/png' ? i.sizes : 'missing ' + i.src;
    })), { icons: manifest.icons, base: head.manifest });
    T.eq('its icons are there', icons.join(), '192x192,512x512,512x512');
    await env.shot('mobile-shell.png');

    T.section('My requests');
    await page.click('.mb-tabbtn[data-tab="track"]');
    await page.waitForSelector(shown('#trList .mb-item'), { timeout: 20000 });
    await settle(page);
    T.eq('the screen\'s band names the tab', await env.text(shown('#mbTrack .mb-head h2')), 'My requests');
    const cards = () => page.$$eval('#trList .mb-item', (b) => b.filter((x) => x.offsetParent).map((x) => x.dataset.number).join(','));
    T.eq('needs you first: your draft', await env.text('#trChips .mb-chip--on'), 'Needs you 1');
    T.eq('the draft', await cards(), 'REQ-2005');
    await page.click('#trChips .mb-chip[data-key="all"]');
    await settle(page);
    T.eq('all of yours, newest first', await cards(), 'REQ-2005,REQ-2003,REQ-2001');

    T.section('My requests opens on the last 3 days');
    T.eq('the period it opens on', [await env.text('#trRecent'), await page.$eval('#trRecent', (b) => b.getAttribute('aria-pressed'))].join(' '), 'Last 3 days true');
    T.eq('the band says so', await env.text('#trSummary'), '3 requests in the last 3 days');
    T.eq('under the list, the older ones it leaves out', await env.text('#trOlder'), '1 older request · Show all');
    T.eq('the chips count the last 3 days', await env.text('#trChips .mb-chip[data-key="all"]'), 'All 3');
    T.eq('the period control fits the phone', await page.$eval('#trPeriod', (n) => n.getBoundingClientRect().width <= 390 - 24 && n.getBoundingClientRect().height >= 44), true);
    await env.shot('mobile-track-recent.png');
    await page.click('#trOlder');
    await page.waitForFunction(() => document.querySelectorAll('#trList .mb-item').length === 4, null, { timeout: 10000 });
    T.eq('Show all: every date', await cards(), 'REQ-2006,REQ-2005,REQ-2003,REQ-2001');
    T.eq('…All is on, the band counts every date, nothing is left out', [await page.$eval('#trAllDates', (b) => b.getAttribute('aria-pressed')), await env.text('#trSummary'),
      !!(await page.$('#trOlder'))].join(' | '), 'true | 4 requests | false');
    T.eq('…and the chips', await env.text('#trChips .mb-chip[data-key="all"]'), 'All 4');
    await page.click('#trRecent');
    await page.waitForFunction(() => document.querySelectorAll('#trList .mb-item').length === 3, null, { timeout: 10000 });
    T.eq('the last 3 days again', await cards(), 'REQ-2005,REQ-2003,REQ-2001');
    await page.fill('#trSearch', 'quarry');
    await settle(page);
    T.eq('a search looks through every date', await cards(), 'REQ-2006');
    T.eq('…and says so', await env.text('#trSearching'), 'Searching all dates');
    T.eq('…nothing is said to be left out while searching', !!(await page.$('#trOlder')), false);
    await env.shot('mobile-track-search-all-dates.png');
    await page.fill('#trSearch', '');
    await settle(page);
    T.eq('search cleared: the last 3 days', [await cards(), !!(await page.$('#trSearching'))].join(' | '), 'REQ-2005,REQ-2003,REQ-2001 | false');
    T.eq('a card says where it is', await env.text('#trList .mb-item[data-number="REQ-2001"] .mb-pill'), 'Waiting for approval');
    T.check('and what is next', /Next: Equipment Manager to approve it/.test(await env.text('#trList .mb-item[data-number="REQ-2001"]')),
      await env.text('#trList .mb-item[data-number="REQ-2001"]'));
    T.eq('a journey bar, a segment per piece', await page.$$eval('#trList .mb-item[data-number="REQ-2003"] .mb-jbar-seg', (s) => s.length), 3);
    await page.click('#trAll');
    await page.waitForFunction(() => document.querySelectorAll('#trList .mb-item').length === 5, null, { timeout: 10000 });
    T.eq('a manager can see everyone\'s', await cards(), 'REQ-2005,REQ-2004,REQ-2003,REQ-2002,REQ-2001');
    T.eq('…of the last 3 days, the older ones left out', [await env.text('#trSummary'), await env.text('#trOlder')].join(' | '),
      '5 requests in the last 3 days, everyone’s | 2 older requests · Show all');
    await page.fill('#trSearch', 'light tower');
    await settle(page);
    T.eq('search reaches the equipment', await cards(), 'REQ-2004');
    await page.fill('#trSearch', '');
    await settle(page);
    await page.click('#trMine');
    await page.waitForFunction(() => document.querySelectorAll('#trList .mb-item').length === 3, null, { timeout: 10000 });
    await env.shot('mobile-track-list.png');

    T.section('a request');
    await page.click('#trList .mb-item[data-number="REQ-2003"]');
    await page.waitForSelector(shown('#trDetail'), { timeout: 10000 });
    T.eq('it opens on itself', await env.text('#trNumber'), 'REQ-2003');
    T.eq('where it is, from its equipment', await env.text('#trHeadline'), 'Partly on site · 1 of 3');
    T.eq('its equipment', await page.$$eval('#trEquipment > li', (l) => l.length), 3);
    T.check('each piece in words', /Being picked|Waiting to be picked|Unit assigned/.test(await env.text('#trEquipment')), await env.text('#trEquipment'));
    T.eq('ready pieces offer picking', await env.text('#trPick'), 'Pick 2 pieces');
    T.check('no approve on an approved request', !(await page.$('#trApprove')));
    await page.waitForSelector('#trHistory .mb-hist-step', { timeout: 15000 });
    T.eq('its history, start to end', await page.$$eval('#trHistory .mb-hist-step', (s) => s.length), 9);
    T.check('with who approved it', /javeed\.shaik/i.test(await env.text('#trHistory')), await env.text('#trHistory'));
    T.eq('no sideways scroll', await sideways(page), false);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForFunction(() => document.querySelector('.mb-app--scrolled'), null, { timeout: 5000 });
    T.eq('scrolled past the band, the top bar names the tab', await env.text('.mb-top-title'), 'My requests');
    await page.evaluate(() => window.scrollTo(0, 0));
    await env.shot('mobile-track-request.png');
    await page.click('#trPick');
    await page.waitForFunction(() => { const b = document.querySelector('.mb-tabbtn--on'); return b && b.dataset.tab === 'pick'; }, null, { timeout: 10000 });
    T.eq('Pick opens the Pick tab', await current(page), 'pick');
    await page.click('.mb-tabbtn[data-tab="track"]');
    await page.waitForSelector(shown('#trDetail'), { timeout: 10000 });
    T.check('back on My requests, still on the request (each tab keeps its place)', (await env.text('#trNumber')) === 'REQ-2003');
    await page.click('#trBack');
    await page.waitForSelector(shown('#trList'), { timeout: 10000 });
    await page.click('#trList .mb-item[data-number="REQ-2001"]');
    await page.waitForSelector(shown('#trApprove'), { timeout: 10000 });
    T.eq('waiting for a decision: approve', await env.text('#trApprove'), 'Approve or send back');
    await page.click('#trApprove');
    await page.waitForFunction(() => { const b = document.querySelector('.mb-tabbtn--on'); return b && b.dataset.tab === 'approve'; }, null, { timeout: 10000 });
    T.eq('it opens the Approve tab', await current(page), 'approve');
    await page.click('.mb-tabbtn[data-tab="track"]');
    await page.click('#trBack');
    await page.click('#trList .mb-item[data-number="REQ-2005"]');
    await page.waitForSelector(shown('#trContinue'), { timeout: 10000 });
    T.eq('a draft: carry on with it', await env.text('#trContinue'), 'Carry on with this draft');
    await page.click('#trContinue');
    await page.waitForFunction(() => { const b = document.querySelector('.mb-tabbtn--on'); return b && b.dataset.tab === 'request'; }, null, { timeout: 10000 });
    T.eq('in the Request tab', await current(page), 'request');

    T.section('Me');
    await page.click('.mb-tabbtn[data-tab="me"]');
    await page.waitForSelector(shown('#meCan li'), { timeout: 10000 });
    T.eq('what you can do here', await page.$$eval('#meCan li', (l) => l.map((x) => x.textContent.trim()).join(',')), 'Approve,Pick & ship,New request,My requests');
    T.check('how to install it', (await page.$$eval('#meSteps li', (l) => l.length)) >= 2);
    T.eq('Me: no sideways scroll', await sideways(page), false);
    await page.waitForSelector('#meVersions [data-version="next"]', { timeout: 10000 });
    T.eq('the other versions, for a computer', await page.$$eval('#meVersions [data-version]', (a) => a.map((x) => x.dataset.version).join()), 'next,new,old');
    T.eq('Next\'s address', await page.$eval('#meVersions [data-version="next"]', (a) => a.getAttribute('href')), `${env.nextUrl}/`);
    await env.shot('mobile-me.png');

    T.section('no connection');
    await page.click('.mb-tabbtn[data-tab="track"]');
    await page.click('#trBack').catch(() => {});
    const errorsBefore = env.errors.length;
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('#mbOffline', { timeout: 10000 });
    T.check('a strip says so', /No connection/.test(await env.text('#mbOffline')));
    await settle(page, 800);
    await page.click('#trRefresh');
    await page.waitForSelector(shown('#trSaved'), { timeout: 20000 });
    T.check('My requests shows this phone\'s saved copy, saying when', /Saved on this phone at \d\d:\d\d/.test(await env.text('#trSaved')), await env.text('#trSaved'));
    await page.click('#trChips .mb-chip[data-key="all"]');
    await settle(page);
    T.eq('the saved cards, of the last 3 days', await cards(), 'REQ-2005,REQ-2003,REQ-2001');
    T.eq('…the saved copy keeps the older ones: All shows them', await env.text('#trOlder'), '1 older request · Show all');
    await page.click('#trList .mb-item[data-number="REQ-2001"]');
    await page.waitForSelector(shown('#trDetail'), { timeout: 10000 });
    T.check('no steps offline (they need a connection)', !(await page.$('#trApprove')));
    await env.shot('mobile-offline.png');
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('#mbOffline', { state: 'detached', timeout: 10000 });
    T.check('back online: the strip goes', !(await page.$('#mbOffline')));
    // Offline, the calls fail (and say so in the console); nothing the app needs may fail to load.
    const offlineErrors = env.errors.splice(errorsBefore);
    T.eq('offline: no part of the app failed to load', offlineErrors.filter((e) => /Script error|does not exist|pageerror/.test(e)).join(' | '), '');

    T.section('opened from a QR code (the desktop app\'s EquipRite on your phone)');
    await env.open('/?from=qr');
    await page.waitForSelector('#mbInstall', { timeout: 15000 });
    T.check('it offers to put itself on the home screen', /Put EquipRite on your home screen/.test(await env.text('#mbInstall')));
    T.check('with the steps for this phone (no browser prompt here)', (await page.$$eval('#mbInstallSteps li', (l) => l.length)) >= 2 && !(await page.$('#mbInstallNow')));
    await env.shot('mobile-install-offer.png');
    await page.click('#mbInstallLater');
    await page.waitForSelector('#mbInstall', { state: 'detached', timeout: 5000 });
    T.check('Not now closes it', !(await page.$('#mbInstall')));
    await env.open('/');
    await settle(page, 600);
    T.check('opened normally, no offer', !(await page.$('#mbInstall')));

    T.section('a deep link');
    await env.open('/?tab=track&number=REQ-2003');
    await page.waitForSelector(shown('#trDetail'), { timeout: 20000 });
    T.eq('?tab=track&number= opens on the request', [await current(page), await env.text('#trNumber')].join(), 'track,REQ-2003');
    await env.open('/?tab=track&number=REQ-2006');
    await page.waitForSelector(shown('#trDetail'), { timeout: 20000 });
    T.eq('a deep link to an older request still opens it', [await current(page), await env.text('#trNumber')].join(), 'track,REQ-2006');
    await page.click('#trBack');
    await page.waitForSelector(shown('#trList'), { timeout: 10000 });
    await page.click('#trChips .mb-chip[data-key="all"]');
    await settle(page);
    T.eq('…and the list behind it shows every date', [await page.$eval('#trAllDates', (b) => b.getAttribute('aria-pressed')), await cards()].join(' | '),
      'true | REQ-2006,REQ-2005,REQ-2003,REQ-2001');
    T.eq('no sideways scroll', await sideways(page), false);

    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('mobile-foundation-failure.png').catch(() => {});
  } finally {
    await env.close();
  }

  T.section('each role gets its tabs');
  for (const name of Object.keys(ROLES)) {
    try {
      await role(name, ...ROLES[name]);
    } catch (e) {
      T.check(`${name}: run finished`, false, e && e.stack);
    }
  }
  T.report();
})();
