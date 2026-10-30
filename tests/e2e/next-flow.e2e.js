'use strict';
/*
 * EquipRite Next, a request's flow, in a real browser: the Redwood band on every page head; the steps on a request's
 * row in Requests (approve here, send back with a reason, assign units, pick) and the screens they open on that
 * request; its timeline (popup and the request's tab); Help with the live flow diagram.
 * Needs `npm run build`. Run: node tests/e2e/next-flow.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const REQ = {
  2001: { requestNumber: 'REQ-2001', status: 'SUBMITTED', projectName: 'Pier B', requestorName: 'User Rite', requestorUserId: 55 },
  2002: { requestNumber: 'REQ-2002', status: 'IN_PROCESS', projectName: 'Plant C', requestorName: 'Rite.User', requestorUserId: 56 },
  2003: { requestNumber: 'REQ-2003', status: 'IN_PROCESS', projectName: 'EPC_MO_Operations', requestorName: 'User Rite', requestorUserId: 55 },
  2004: { requestNumber: 'REQ-2004', status: 'SUBMITTED', projectName: 'Gas Line', requestorName: 'Dana Cole', requestorUserId: 57 },
};
const LINES = [
  { id: 1, req: 2001, name: 'Komatsu D65EX-18 Dozer', cls: 'Earthmoving', status: 'SUBMITTED', alloc: 'PENDING' },
  { id: 2, req: 2001, name: 'Bobcat S76 Skid Steer Loader', cls: 'Earthmoving', status: 'SUBMITTED', alloc: 'PENDING' },
  { id: 3, req: 2002, name: 'Mack Granite Mixer Truck', cls: 'Transport', status: 'IN_PROCESS', alloc: 'PENDING' },
  { id: 4, req: 2002, name: 'CAT 320 Excavator', cls: 'Excavators', status: 'SHIP_TO_SITE', alloc: 'ALLOCATED' },
  { id: 5, req: 2003, name: 'Volvo A30 Dump Truck', cls: 'Trucks', status: 'ALLOCATED', alloc: 'ALLOCATED' },
  { id: 6, req: 2003, name: 'Roller 10t', cls: 'Rollers', status: 'SCHEDULED_FOR_PICKING', alloc: 'ALLOCATED' },
  { id: 7, req: 2003, name: 'Generator 100kVA', cls: 'Power', status: 'DEPLOYED', alloc: 'ALLOCATED' },
  { id: 8, req: 2004, name: 'Light Tower', cls: 'Lighting', status: 'SUBMITTED', alloc: 'PENDING' },
];
const HISTORY = {
  2003: [
    { requestId: 2003, fromStatus: 'DRAFT', toStatus: 'SUBMITTED', changedDate: day(-20) + 'T08:30:00Z', changedBy: 'user.rite' },
    { requestId: 2003, lineId: 5, fromStatus: 'SUBMITTED', toStatus: 'IN_PROCESS', changedDate: day(-19) + 'T10:05:00Z', changedBy: 'javeed.shaik' },
    { requestId: 2003, lineId: 6, fromStatus: 'SUBMITTED', toStatus: 'IN_PROCESS', changedDate: day(-19) + 'T10:05:20Z', changedBy: 'javeed.shaik' },
    { requestId: 2003, lineId: 7, fromStatus: 'SUBMITTED', toStatus: 'IN_PROCESS', changedDate: day(-19) + 'T10:05:40Z', changedBy: 'javeed.shaik' },
  ],
};
const TOS = { 2003: [{ id: 91, orderNumber: 'TO-91', orderType: 'OUTBOUND', createdDate: day(-15), shippedDate: day(-14), receivedDate: day(-13), carrierName: 'DHL' }] };

const lineRow = (l) => ({ requestNumber: REQ[l.req].requestNumber, lineId: l.id, lineNumber: l.id, equipmentName: l.name, className: l.cls, qty: 1, quantity: 1,
  lineStatus: l.status, allocationStatus: l.alloc, requestStatus: REQ[l.req].status, projectName: REQ[l.req].projectName,
  requestedStartDate: day(5), requestedEndDate: day(30), requestorName: REQ[l.req].requestorName });

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  let m;
  if (p === '/views/my-requests') {
    return res.json({ data: Object.keys(REQ).map((id) => Object.assign({ eqrEquipmentRequestId: Number(id), startDate: day(5), endDate: day(30), requestOrigin: 'Internal' }, REQ[id])) });
  }
  if (p === '/views/my-request-lines') return res.json({ data: LINES.map(lineRow) });
  if (p === '/views/request-detail-lines') return res.json({ data: LINES.filter((l) => l.req === Number(q.get('requestId'))).map(lineRow) });
  if (p === '/request-status-history') return res.json({ data: HISTORY[Number(q.get('requestId'))] || [] });
  if (p === '/transfer-orders') return res.json({ data: TOS[Number(q.get('equipmentRequestId'))] || [] });
  if (p === '/views/workbench-requests') {
    return res.json({ data: q.get('stage') === 'INITIATE' ? [{ eqrEquipmentRequestId: 2003, requestNumber: 'REQ-2003', projectName: 'EPC_MO_Operations',
      requestor: 'User Rite', requestStatus: 'IN_PROCESS', requestedStartDate: day(5), requestedEndDate: day(30), source: 'Internal' }] : [] });
  }
  if ((m = /^\/equipment-requests\/(\d+)$/.exec(p))) {
    const r = REQ[m[1]];
    if (req.method === 'PATCH') { r.status = req.json().status; return res.json({ id: Number(m[1]) }); }
    return res.json({ id: Number(m[1]), requestNumber: r.requestNumber, status: r.status, requestorName: r.requestorName, requestorUserId: r.requestorUserId,
      createdDate: day(-21) + 'T07:45:00Z', requestType: 'INTERNAL' });
  }
  if ((m = /^\/equipment-requests\/(\d+)\/lines$/.exec(p))) {
    return res.json({ data: LINES.filter((l) => l.req === Number(m[1])).map((l) => ({ id: l.id, lineStatus: l.status, allocationStatus: l.alloc })) });
  }
  if ((m = /^\/equipment-requests\/(\d+)\/lines\/batch$/.exec(p)) && req.method === 'PATCH') {
    const body = req.json();
    body.lines.forEach((u) => { const l = LINES.find((x) => x.id === Number(u.id)); if (l) l.status = u.lineStatus; });
    return res.json({ data: body.lines });
  }
  if (p === '/notifications' && req.method === 'POST') return res.json({ id: 1 }, 201);
  return undefined;
}

const W = (env) => env.writes.map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', ''));
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

(async () => {
  const env = await E.start({ port: 19300, handle, app: 'next', sessionRole: 'ADMIN' });
  const { page } = env;
  try {
    T.section('the Redwood band on every page head');
    await env.open('/?open=requests');
    await page.waitForSelector('.nx-grid--req .nx-row--click', { timeout: 30000 });
    await settle(page, 600);
    const band = await page.evaluate(() => {
      const head = document.querySelector('.nx-requests .nx-pagehead');
      const pageEl = document.querySelector('.nx-requests');
      const h = head.getBoundingClientRect();
      const pg = pageEl.getBoundingClientRect();
      return { bg: getComputedStyle(head).backgroundColor, h1: getComputedStyle(head.querySelector('h1')).color, strip: getComputedStyle(head, '::after').backgroundImage,
        edges: [Math.round(h.left - pg.left), Math.round(pg.right - h.right), Math.round(h.top - pg.top)].join(',') };
    });
    T.eq('deep teal, white title', band.bg + ' ' + band.h1, 'rgb(46, 84, 104) rgb(255, 255, 255)');
    T.eq('edge to edge, at the top of the tab', band.edges, '0,0,0');
    T.check('the five-colour strip under it', /linear-gradient/.test(band.strip) && band.strip.includes('199, 70, 52'));
    T.eq('New request stays the one bright button on it', await page.$eval('.nx-requests .nx-pagehead .nx-btn--primary', (b) => getComputedStyle(b).backgroundColor), 'rgb(255, 255, 255)');

    T.section('the steps on each row');
    const acts = async (n) => page.$$eval(`.nx-row--click[data-number="${n}"] [data-act]`, (b) => b.map((x) => x.dataset.act + (x.dataset.act === 'pick' ? ':' + x.innerText.trim() : '')).join(','));
    T.eq('waiting: Approve', await acts('REQ-2001'), 'history,approve');
    T.eq('approved, a unit to assign: Assign units', await acts('REQ-2002'), 'history,assign');
    T.eq('units at the yard: Pick, with how many', await acts('REQ-2003'), 'history,pick:Pick 2');
    T.check('each beside what is next', (await env.text('.nx-row--click[data-number="REQ-2001"] .nx-cell-next')).startsWith('Equipment Manager to approve it'));
    await env.shot('next-flow-rows.png');

    T.section('approve on the row, then the next step');
    await page.click('.nx-row--click[data-number="REQ-2001"] [data-act="approve"]');
    await page.waitForSelector('#reqPop', { timeout: 10000 });
    T.eq('it asks first, with the equipment', await env.text('#popTitle'), 'Approve REQ-2001? Waiting for approval');
    T.eq('white on the band', await page.$eval('#popTitle', (h) => getComputedStyle(h).color), 'rgb(255, 255, 255)');
    T.eq('two pieces waiting', await page.$$eval('.nx-pop-eq li', (l) => l.length), 2);
    T.eq('the button says what it does', await env.text('#popApprove'), 'Approve all 2');
    T.check('it says what approving does and what comes after', (await env.text('.nx-pop-after')).includes('Assign units') && (await env.text('.nx-pop-after')).includes('all or nothing'));
    T.eq('nothing written yet', W(env).length, 0);
    await env.shot('next-flow-approve.png');
    await page.click('#popApprove');
    await page.waitForSelector('#popResult', { timeout: 15000 });
    await settle(page);
    T.eq('Approve & allocate\'s calls: the lines in one batch, then the request', W(env).join(' > '), 'PATCH /equipment-requests/2001/lines/batch > PATCH /equipment-requests/2001');
    T.eq('every waiting line approved', JSON.stringify(env.writes[0].body.lines), '[{"id":1,"lineStatus":"IN_PROCESS"},{"id":2,"lineStatus":"IN_PROCESS"}]');
    T.check('the result in words', (await env.text('#popResult')).startsWith('Approved 2 lines on REQ-2001.'));
    T.check('where it is now and what is next', (await env.text('.nx-pop-now')).includes('Equipment Manager to assign a unit'));
    T.check('the next step is offered: Assign units', !!(await page.$('#popAssign')));
    T.eq('the row moved on', await acts('REQ-2001'), 'history,assign');
    await env.shot('next-flow-approved.png');
    await page.click('#popAssign');
    await page.waitForFunction(() => /REQ-2001/.test((document.querySelector('#apPanel h2, #apPanel #apRecTitle') || {}).innerText || ''), null, { timeout: 20000 }).catch(() => {});
    T.eq('Approve & allocate opens on it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'approvals');
    const panel = await env.text('#apPanel');
    T.check('with the request open in its panel', panel.includes('REQ-2001'), panel.slice(0, 200));

    T.section('send back from the row: a reason first');
    await page.click('.nx-tab[data-tab-id="requests"] .nx-tab-btn');
    await page.waitForSelector('.nx-row--click[data-number="REQ-2004"] [data-act="approve"]');
    const before = env.writes.length;
    await page.click('.nx-row--click[data-number="REQ-2004"] [data-act="approve"]');
    await page.waitForSelector('#popAskReject');
    await page.click('#popAskReject');
    await page.waitForSelector('#popReason');
    await page.click('#popReject');
    await settle(page, 200);
    T.check('no reason, nothing sent: it says why', (await env.text('#reqPop .nx-error')).startsWith('Write the reason first: Dana Cole gets it'));
    T.eq('still nothing written', env.writes.length, before);
    await page.fill('#popReason', 'The dates clash with the shutdown.');
    await page.click('#popReject');
    await page.waitForSelector('#popResult', { timeout: 15000 });
    T.eq('the line, the request, then the reason to the requester', W(env).slice(before).join(' > '),
      'PATCH /equipment-requests/2004/lines/batch > PATCH /equipment-requests/2004 > POST /notifications');
    const note = env.writes.filter((w) => w.path.endsWith('/notifications')).pop().body;
    T.eq('the reason goes to the requester', [note.userId, note.requestNumber, note.message].join(' | '), '57 | REQ-2004 | The dates clash with the shutdown.');
    T.check('said in words', (await env.text('#popResult')).includes('Your reason was sent to Dana Cole'));
    await page.click('#reqPop .nx-dialog-head .nx-iconbtn');
    await settle(page, 200);
    T.check('closed', !(await page.$('#reqPop')));

    T.section('the timeline of a request');
    await page.click('.nx-row--click[data-number="REQ-2003"] [data-act="history"]');
    await page.waitForSelector('#reqPop .nx-hist-step', { timeout: 15000 });
    await settle(page);
    const steps = await page.$$eval('#reqPop .nx-hist-step', (s) => s.map((x) => x.dataset.step + ':' + x.className.match(/nx-hist-step--(\w+)/)[1]).join(' '));
    T.eq('the milestones: approved by all, units and picking in progress, one on site', steps,
      'created:done submitted:done approved:done allocated:done picked:partly shipped:partly onsite:partly back:todo done:todo');
    const stepText = async (k) => page.$eval(`#reqPop .nx-hist-step[data-step="${k}"]`, (e) => e.innerText.replace(/\s+/g, ' ').trim());
    T.check('approved: when and by whom (the approval history)', (await stepText('approved')).includes('javeed.shaik'));
    T.check('shipped: 1 of 3, dated from its transfer order', (await stepText('shipped')).includes('1 of 3'));
    T.check('what is next, where it is held up', (await stepText('picked')).includes('Next: Equipment Manager to confirm it for picking (1 of 3)'), await stepText('picked'));
    await env.shot('next-flow-timeline.png');
    await page.click('#reqPop [data-action="tab"][data-value="activity"]');
    await page.waitForSelector('#reqPop .nx-act-item');
    const acts2 = await page.$$eval('#reqPop .nx-act-title', (t) => t.map((x) => x.innerText.trim()));
    T.eq('everything, newest first', acts2.join(' | '),
      'Received on site | Shipped to site | Transfer order TO-91 raised for picking | Approved | Sent for approval | Request created');
    T.check('the approval of three lines is one entry, with who', (await env.text('#reqPop .nx-act')).includes('3 pieces') && (await env.text('#reqPop .nx-act')).includes('javeed.shaik'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#reqPop [data-action="export"][data-value="csv"]')]);
    const file = path.join(os.tmpdir(), 'next-flow-' + dl.suggestedFilename());
    await dl.saveAs(file);
    const csv = fs.readFileSync(file, 'utf8');
    T.check('the history exports', csv.includes('What happened') && csv.includes('Approved') && csv.includes('Recorded status change'));
    await env.shot('next-flow-activity.png');
    await page.click('#reqPop [data-action="record"]');
    await page.waitForSelector('.nx-record-history .nx-hist-step', { timeout: 20000 });
    await settle(page);

    T.section('the request\'s tab: History, and its step');
    T.eq('it opened in its own tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:2003');
    T.eq('the same milestones', await page.$$eval('.nx-record-history .nx-hist-step', (s) => s.length), 9);
    T.check('everything that happened beside them', /everything that happened \(6\)/i.test(await env.text('.nx-record-history')));
    T.eq('its step for this user: Pick', await env.text('#recPick'), 'Pick 2 at the yard');
    await env.shot('next-flow-record.png');
    await page.click('#recPick');
    await page.waitForSelector('#ydWork', { timeout: 20000 });
    await settle(page);
    T.eq('Picking & shipping opens on it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'picking');
    T.check('with the request open beside the list', (await env.text('#ydWork')).includes('REQ-2003'));

    T.section('Help: the flow, live');
    await page.click('#nxHelp');
    await page.waitForSelector('#helpDiagram .hs-node', { timeout: 20000 });
    await settle(page, 600);
    T.eq('the Help tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'help');
    T.eq('ten steps in the diagram', await page.$$eval('#helpDiagram .hs-node', (n) => n.length), 10);
    const badge = async (k) => page.$eval(`#helpDiagram [data-step="${k}"]`, (g) => g.getAttribute('aria-label'));
    T.check('how many pieces are at each step now', (await badge('assign')).endsWith('4 here now') && (await badge('pick')).endsWith('1 here now'));
    T.check('an administrator\'s steps are marked', await page.$eval('#helpDiagram [data-step="approve"]', (g) => g.classList.contains('hs-node--mine')));
    await page.click('#helpDiagram [data-step="pick"] .hs-shape');
    await page.waitForSelector('#helpStep');
    T.eq('the step opens below, marked as yours', (await env.text('#helpStepTitle')).toLowerCase(), 'step 5: pick at the yard yours');
    T.check('its statuses, in the screens\' words', (await env.text('#helpStep .nx-help-codes')).includes('SCHEDULED_FOR_PICKING') && (await env.text('#helpStep .nx-help-codes')).includes('Waiting to be picked'));
    T.eq('right now', await env.text('#helpNow'), '1 piece on 1 request are here now');
    T.eq('and the screen that takes it', await env.text('#helpOpenScreen'), 'Open Picking & shipping');
    T.check('the step is highlighted in the diagram', await page.$eval('#helpDiagram [data-step="pick"]', (g) => g.classList.contains('hs-node--on')));
    T.check('every status listed', (await page.$$eval('.nx-grid--help .nx-row:not(.nx-row--head)', (r) => r.length)) >= 27);
    await env.shot('next-flow-help.png');
    await page.click('#helpSee');
    await page.waitForSelector('.nx-tab--on[data-tab-id="requests"]', { timeout: 10000 });
    await settle(page, 600);
    T.eq('See them in Requests: that stage', await page.$eval('.nx-chip--on', (c) => c.dataset.value), 'ready');

    T.section('narrow screens');
    await page.setViewportSize({ width: 390, height: 800 });
    await page.click('.nx-row--click[data-number="REQ-2003"] [data-act="history"]');
    await page.waitForSelector('#reqPop .nx-hist-step', { timeout: 15000 });
    await settle(page);
    T.eq('the timeline fills a phone screen, no sideways scroll', [await page.$eval('#reqPop', (d) => Math.round(d.getBoundingClientRect().width)), await sideways(page)].join(), '390,false');
    await env.shot('next-flow-timeline-390.png');
    await page.click('#reqPop .nx-dialog-head .nx-iconbtn');
    await page.click('.nx-tab[data-tab-id="help"] .nx-tab-btn').catch(() => {});
    await settle(page, 600);
    T.eq('Help: no sideways scroll (the diagram scrolls in its box)', await sideways(page), false);
    await page.setViewportSize({ width: 1440, height: 900 });

    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('next-flow-failure.png').catch(() => {});
  } finally {
    await env.close();
  }
  T.report();
})();
