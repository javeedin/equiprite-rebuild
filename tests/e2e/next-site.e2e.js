'use strict';
/*
 * EquipRite Next: getting equipment to site, done in Next, in a real browser. Confirm for picking (Fusion is asked for the
 * transfer order through OIC: plan, reserve, OIC, record) and Accept delivery (on site, the request rolled up), from a
 * row of Requests (its popup), from the request's own tab, and from Picking & shipping's dialog.
 * Needs `npm run build`. Run: node tests/e2e/next-site.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const REQ = {
  3001: { requestNumber: 'REQ-3001', status: 'IN_PROCESS', projectName: 'Pier B', requestorName: 'User Rite' },
  3002: { requestNumber: 'REQ-3002', status: 'IN_PROCESS', projectName: 'Plant C', requestorName: 'Dana Cole' },
  3003: { requestNumber: 'REQ-3003', status: 'IN_PROCESS', projectName: 'Gas Line', requestorName: 'User Rite' },
  3004: { requestNumber: 'REQ-3004', status: 'IN_PROCESS', projectName: 'Dock', requestorName: 'User Rite' },
  3005: { requestNumber: 'REQ-3005', status: 'SUBMITTED', projectName: 'Process Design Package', requestorName: 'Rite.User' },
};
const LINES = [
  { id: 11, req: 3001, name: 'Volvo A30 Dump Truck', status: 'ALLOCATED' },
  { id: 12, req: 3001, name: 'Roller 10t', status: 'SCHEDULED_FOR_PICKING' },
  { id: 21, req: 3002, name: 'CAT 320 Excavator', status: 'SHIP_TO_SITE' },
  { id: 22, req: 3002, name: 'Gravel 20mm', status: 'SHIP_TO_SITE', consumable: true, qty: 30 },
  { id: 23, req: 3002, name: 'Generator 100kVA', status: 'DEPLOYED' },
  { id: 31, req: 3003, name: 'Light Tower', status: 'ALLOCATED' },
  { id: 32, req: 3003, name: 'Water Pump', status: 'SHIP_TO_SITE' },
  { id: 41, req: 3004, name: 'Mobile Crane', status: 'SCHEDULED_FOR_PICKING' },
  { id: 42, req: 3004, name: 'Skid Steer', status: 'ALLOCATED' },
  { id: 51, req: 3005, name: 'Flexifloat Deck Barge', status: 'SUBMITTED' },
];
const QUEUE = [3001, 3004];

const viewRow = (l) => ({ requestNumber: REQ[l.req].requestNumber, requestId: l.req, lineId: l.id, lineNumber: l.id, equipmentName: l.name, className: 'Plant',
  qty: l.qty || 1, quantity: l.qty || 1, allocatedQty: l.status === 'IN_PROCESS' || l.status === 'SUBMITTED' ? 0 : (l.qty || 1), lineStatus: l.status,
  allocationStatus: 'ALLOCATED', consumableFlag: l.consumable ? 'Y' : 'N', fulfilmentClass: 'S_AND_T', requestStatus: REQ[l.req].status,
  projectName: REQ[l.req].projectName, requestedStartDate: day(2), requestedEndDate: day(30), requestorName: REQ[l.req].requestorName, equipmentMasterId: 900 + l.id });

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  let m;
  if (p === '/views/my-requests') {
    return res.json({ data: Object.keys(REQ).map((id) => Object.assign({ eqrEquipmentRequestId: Number(id), startDate: day(2), endDate: day(30), requestOrigin: 'Internal' }, REQ[id])) });
  }
  if (p === '/views/my-request-lines') return res.json({ data: LINES.map(viewRow) });
  if (p === '/views/request-detail-lines') return res.json({ data: LINES.filter((l) => l.req === Number(q.get('requestId'))).map(viewRow) });
  if (p === '/views/workbench-requests') {
    return res.json({ data: q.get('stage') === 'INITIATE' ? QUEUE.map((id) => ({ eqrEquipmentRequestId: id, requestNumber: REQ[id].requestNumber, projectName: REQ[id].projectName,
      requestor: REQ[id].requestorName, requestStatus: REQ[id].status, requestedStartDate: day(2), requestedEndDate: day(30), source: 'Internal' })) : [] });
  }
  if (p === '/bu-org-mappings') return res.json({ data: [{ invOrgId: 11, invOrgCode: 'HOU', invOrgName: 'Houston Yard' }, { invOrgId: 21, invOrgCode: 'VPJ', invOrgName: 'Virtual project', subinventoryCode: 'SITE' }] });
  if ((m = /^\/requests\/(\d+)\/transfer-orders\/plan$/.exec(p))) {
    const ids = req.json().lineIds;
    return res.json({ blocks: [], fAndMLineIds: [], buckets: [{ bucketKey: 'HOU|VPJ', sourceOrgId: 11, sourceOrgCode: 'HOU', sourceOrgName: 'Houston Yard', destOrgId: 21, destOrgCode: 'VPJ',
      destOrgName: 'Virtual project', lines: ids.map((id) => { const l = LINES.find((x) => x.id === id); return { requestLineId: id, lineNumber: id, equipmentName: l.name, itemNumber: 'EQ-' + id, qty: 1 }; }) }] });
  }
  if (/\/transfer-orders\/reserve$/.test(p)) return res.json({ reservedLineIds: req.json().lineIds, rejectedLineIds: [], replayed: false });
  if (p.endsWith('/transferorders/create')) return res.json({ status: 'ACCEPTED' }, 202);
  if (/\/transfer-orders\/record$/.test(p)) {
    req.json().lineIds.forEach((id) => { const l = LINES.find((x) => x.id === id); if (l) l.status = 'SCHEDULED_FOR_PICKING'; });
    return res.json({ recorded: req.json().lineIds.length });
  }
  if ((m = /^\/equipment-requests\/(\d+)$/.exec(p))) {
    const r = REQ[m[1]];
    if (req.method === 'PATCH') { r.status = req.json().status; return res.json({ id: Number(m[1]) }); }
    return res.json({ id: Number(m[1]), requestNumber: r.requestNumber, status: r.status, requestorName: r.requestorName, createdDate: day(-10) + 'T07:45:00Z', requestType: 'INTERNAL' });
  }
  if ((m = /^\/equipment-requests\/(\d+)\/lines$/.exec(p))) {
    return res.json({ data: LINES.filter((l) => l.req === Number(m[1])).map((l) => ({ id: l.id, lineStatus: l.status, allocationStatus: 'ALLOCATED', equipmentName: l.name })) });
  }
  if ((m = /^\/equipment-requests\/(\d+)\/lines\/batch$/.exec(p)) && req.method === 'PATCH') {
    const body = req.json();
    body.lines.forEach((u) => { const l = LINES.find((x) => x.id === Number(u.id)); if (l && u.lineStatus) l.status = u.lineStatus; });
    return res.json({ data: body.lines });
  }
  return undefined;
}

const short = (w) => w.method + ' ' + w.path.replace('/equiprite/v1', '').replace(/^\/ic\/api\/.*\/transferorders\/create$/, 'OIC transferorders/create');
// The failed transfer-order sweep (POST .../transfer-orders/failed, requestDetailLines) is a read: left out.
const WR = (env, from) => env.writes.slice(from || 0).filter((w) => !/\/transfer-orders\/failed$/.test(w.path));
const W = (env, from) => WR(env, from).map(short);
const settle = (page, ms) => page.waitForTimeout(ms || 400);

(async () => {
  const env = await E.start({ port: 19400, handle, app: 'next', sessionRole: 'ADMIN' });
  const { page } = env;
  try {
    await env.open('/?open=requests');
    await page.waitForSelector('.nx-grid--req .nx-row--click', { timeout: 30000 });
    await settle(page, 600);
    const acts = async (n) => page.$$eval(`.nx-row--click[data-number="${n}"] [data-act]`, (b) => b.filter((x) => x.dataset.act !== 'history')
      .map((x) => x.dataset.act + ':' + x.innerText.trim()).join(','));

    T.section('the rows say what is next: Confirm, Pick, Accept');
    T.eq('a unit assigned and one in the yard\'s queue', await acts('REQ-3001'), 'confirm:Confirm 1,pick:Pick 1');
    T.eq('two on their way to site', await acts('REQ-3002'), 'accept:Accept 2');

    T.section('Confirm for picking, in the popup');
    await page.click('.nx-row--click[data-number="REQ-3001"] [data-act="confirm"]');
    await page.waitForSelector('#roadConfirmBtn', { timeout: 10000 });
    T.eq('the step, done here', await env.text('#roadConfirmBtn'), 'Confirm 1 piece for picking');
    T.eq('nothing written yet', W(env).length, 0);
    await page.click('#roadConfirmBtn');
    await page.waitForSelector('#roadResult', { timeout: 20000 });
    await settle(page);
    T.eq('Old\'s Confirm calls, in order: plan, reserve, Fusion (OIC), record', W(env).join(' > '),
      'POST /requests/3001/transfer-orders/plan > POST /requests/3001/transfer-orders/reserve > POST OIC transferorders/create > POST /requests/3001/transfer-orders/record');
    const cw = WR(env);
    T.eq('the plan is asked for the piece with its unit', JSON.stringify(cw[0].body), '{"lineIds":[11],"fallbackYardOrgId":null}');
    const oic = cw[2].body;
    const ol = oic.supplyRequestLines[0];
    T.eq('Fusion gets an outbound transfer order: yards, subinventory, item, need-by, the request line',
      [oic.OrderType, oic.equipmentRequestId, ol.SourceOrganizationCode, ol.DestinationOrganizationCode, ol.DestinationSubinventoryCode, ol.ItemNumber, ol.NeedByDate.slice(0, 10), ol.requestLineId].join(),
      ['OUTBOUND', 3001, 'HOU', 'VPJ', 'SITE', 'EQ-11', day(30), 11].join());
    T.eq('record has the same batch as the transfer order', cw[3].body.batchNumber, oic.InterfaceBatchNumber);
    T.check('it says what happened', (await env.text('#roadResult')).startsWith('Confirmed for picking 1 transfer order requested from Fusion: 1 piece scheduled for picking.'),
      await env.text('#roadResult'));
    const road = await page.$$eval('#reqPop .nx-road-step', (s) => s.map((x) => x.dataset.step + ':' + x.querySelector('.nx-road-dot').innerText.trim()).join(' '));
    T.eq('the steps move on in place: both pieces wait to be picked', road, 'assign: confirm: pick:2 picking: shipped:');
    T.check('Confirm is done; Pick is next', !(await page.$('#roadConfirm')) && (await env.text('#roadPick')).includes('Pick 2 pieces at the yard'));
    await env.shot('next-site-confirmed.png');
    await page.click('#reqPop .nx-dialog-head .nx-iconbtn');
    await settle(page, 300);
    T.eq('the row follows', await acts('REQ-3001'), 'pick:Pick 2');

    T.section('Accept delivery, in the popup');
    const before = env.writes.length;
    const aw = () => WR(env, before);
    await page.click('.nx-row--click[data-number="REQ-3002"] [data-act="accept"]');
    await page.waitForSelector('#roadAcceptBtn', { timeout: 10000 });
    T.eq('who and what', [await env.text('#roadAccept .nx-road-card-head'), await env.text('#roadAcceptBtn')].join(' | '), 'Accept 2 pieces on site Site | Accept the delivery of 2 pieces');
    await env.shot('next-site-accept.png');
    await page.click('#roadAcceptBtn');
    await page.waitForSelector('#roadResult', { timeout: 20000 });
    await settle(page);
    T.eq('New\'s Accept calls: the pieces in one batch, then the request', W(env, before).join(' > '), 'PATCH /equipment-requests/3002/lines/batch > PATCH /equipment-requests/3002');
    T.eq('a rental on site, the consumable delivered with its quantity', JSON.stringify(aw()[0].body.lines),
      '[{"id":21,"lineStatus":"DEPLOYED"},{"id":22,"lineStatus":"DELIVERED","deliveredQuantity":30}]');
    T.eq('everything is on site: the request is Deployed', JSON.stringify(aw()[1].body), '{"status":"DEPLOYED"}');
    T.check('it says so', (await env.text('#roadResult')).includes('2 pieces accepted (1 on site, 1 delivered).') && (await env.text('#roadResult')).includes('marked Deployed'));
    T.check('nothing left on the way', !(await page.$('#roadAccept')) && (await env.text('#roadNothing')).includes('Nothing on this request is on its way'));
    await page.click('#reqPop .nx-dialog-head .nx-iconbtn');
    await settle(page, 300);
    T.eq('the row has nothing to accept now', await acts('REQ-3002'), '');

    T.section('the request\'s own tab: Confirm, then Accept, asked once each');
    await page.click('.nx-row--click[data-number="REQ-3003"] .nx-req-num');
    await page.waitForSelector('#recConfirm', { timeout: 20000 });
    await settle(page);
    T.eq('both steps', [await env.text('#recConfirm'), await env.text('#recAccept')].join(' | '), 'Confirm 1 for picking | Accept 1 on site');
    const b2 = env.writes.length;
    await page.click('#recConfirm');
    await page.waitForSelector('#recAsk');
    T.check('it asks first, saying what it does', (await env.text('#recAsk')).includes('Fusion is asked for the transfer order') && W(env, b2).length === 0);
    await page.click('#recAskNo');
    await settle(page, 200);
    T.check('Cancel: nothing done', !(await page.$('#recAsk')) && W(env, b2).length === 0);
    await page.click('#recConfirm');
    await page.waitForSelector('#recAskYes');
    await page.click('#recAskYes');
    await page.waitForSelector('#recResult', { timeout: 20000 });
    await settle(page, 600);
    T.eq('confirmed from the tab', W(env, b2).join(' > '),
      'POST /requests/3003/transfer-orders/plan > POST /requests/3003/transfer-orders/reserve > POST OIC transferorders/create > POST /requests/3003/transfer-orders/record');
    T.check('the tab is read again: Confirm is done', !(await page.$('#recConfirm')) && (await env.text('#recResult')).startsWith('Confirmed for picking'));
    const b3 = env.writes.length;
    await page.click('#recAccept');
    await page.waitForSelector('#recAskYes');
    await page.click('#recAskYes');
    await page.waitForFunction(() => /Delivery accepted/.test((document.querySelector('#recResult') || {}).textContent || ''), null, { timeout: 20000 });
    await settle(page, 600);
    T.eq('accepted from the tab; a piece still to come, so the request stays as it is', W(env, b3).join(' > '), 'PATCH /equipment-requests/3003/lines/batch');
    T.check('Accept is done', !(await page.$('#recAccept')));
    await env.shot('next-site-record.png');

    T.section('Approve… on a request\'s tab: Approve & allocate shows only that request, with the way back');
    await page.click('.nx-tab[data-tab-id="requests"] .nx-tab-btn');
    await page.waitForSelector('.nx-row--click[data-number="REQ-3005"] .nx-req-num', { timeout: 20000 });
    await page.click('.nx-row--click[data-number="REQ-3005"] .nx-req-num');
    await page.waitForSelector('#recApprove', { timeout: 20000 });
    await page.click('#recApprove');
    await page.waitForSelector('#apFocus', { timeout: 20000 });
    await page.waitForFunction(() => /REQ-3005/.test((document.querySelector('#apRecTitle') || {}).innerText || ''), null, { timeout: 20000 });
    await settle(page);
    T.eq('Approve & allocate', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'approvals');
    T.check('only REQ-3005: no queue beside it, no chips, no bulk', (await env.text('#apFocus')).startsWith('Only REQ-3005')
      && !(await page.isVisible('.nx-ap-queue')) && !(await page.$('.nx-approvals .nx-toolbar')) && !(await page.$('#apBulk')), await env.text('#apFocus'));
    T.check('the request takes the width, ready to decide', !!(await page.$('#apDecide')) && await page.$eval('#apPanel', (p) => p.getBoundingClientRect().width > 900));
    T.eq('the way back is to its tab', await env.text('#apFocusBack'), 'Back to REQ-3005');
    await env.shot('next-site-approve-focus.png');
    await page.click('#apFocusBack');
    await page.waitForFunction(() => (document.querySelector('.nx-tab--on') || {}).dataset.tabId === 'request:3005', null, { timeout: 10000 });
    T.eq('Back: the request\'s tab again', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'request:3005');

    T.section('Picking & shipping: a piece not confirmed yet, confirmed from the dialog');
    await page.click('[data-nav-id="picking"]');
    await page.waitForSelector('#ydPicking .nx-yd-row[data-number="REQ-3004"]', { timeout: 30000 });
    await page.click('#ydPicking .nx-yd-row[data-number="REQ-3004"] .nx-yd-c-pieces');
    await page.waitForSelector('#ydConfirm', { timeout: 20000 });
    await settle(page);
    T.eq('the dialog offers it', await env.text('#ydConfirm'), 'Confirm 1 piece for picking');
    const b4 = env.writes.length;
    await page.click('#ydConfirm');
    await page.waitForFunction(() => /transfer order requested/.test((document.querySelector('#ydBanner') || {}).textContent || ''), null, { timeout: 20000 });
    await settle(page, 600);
    T.eq('the same calls', W(env, b4).join(' > '),
      'POST /requests/3004/transfer-orders/plan > POST /requests/3004/transfer-orders/reserve > POST OIC transferorders/create > POST /requests/3004/transfer-orders/record');
    T.eq('both pieces are in picking now, nothing left to confirm', [await page.$$eval('#ydWork .nx-yd-line[data-line]', (l) => l.map((x) => x.dataset.line).sort().join()), !!(await page.$('#ydConfirm'))].join(' '),
      '41,42 false');
    await env.shot('next-site-picking.png');

    T.eq('no browser errors', env.errors.filter((e) => !/404|Failed to load resource/.test(e)).join(' | '), '');
  } catch (e) {
    T.check('run finished', false, String((e && e.stack) || e).slice(0, 1200));
  } finally {
    await env.close();
  }
  T.report();
})();
