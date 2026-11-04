'use strict';
/*
 * EquipRite Next, the Redwood look of Requests and work, in a real browser (docs/next-redwood-screens.md). With Redwood
 * chosen in your menu, each screen is built from Oracle's own Redwood page templates and components, as Old EquipRite's:
 *   - Approve & allocate (master-detail): the queue is Oracle's Smart Search page (a filter per column, oj-table, oj-badge,
 *     oj-c buttons, ticks and the bulk decision); a request chosen, or handed over by another screen (focus), shows
 *     Oracle's general overview header with the way back over the screen's own decision and allocation panel;
 *   - a request's tab: Oracle's header (its next step the primary action, the rest as on Current) and its equipment as an
 *     oj-table; My work: Oracle's header (the greeting; the role and today; Refresh; open a request); New request and a
 *     screen still being built: Oracle's header over their own body.
 * Current brings every screen back as it was. Needs `npm run build`. Run: node tests/e2e/next-redwood-work.e2e.js
 * (screenshots: the OS temp folder, equiprite-e2e/rw-work-*.png).
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const iso = (n) => day(n) + 'T00:00:00Z';

// ── A small stateful backend: requests, their lines and units, that the writes change (as next-approvals.e2e.js) ──────
function world() {
  const REQ = {
    509: { requestNumber: 'REQ-509', status: 'SUBMITTED', origin: 'Internal', projectName: 'Plant Expansion B', taskName: '1.3 Foundations', requestorName: 'Sam Ortiz',
      requestorUserId: 77, start: -3, end: 20 },
    501: { requestNumber: 'REQ-501', status: 'SUBMITTED', origin: 'Internal', projectName: 'Pipeline North', taskName: '2.1 Trenching', requestorName: 'Priya Nair',
      requestorUserId: 71, start: 4, end: 30 },
    502: { requestNumber: 'REQ-502', status: 'SUBMITTED', origin: 'External', customerName: 'Gulf Coast Builders', requestorName: 'Dana Ruiz', requestorUserId: 72,
      start: 6, end: 60 },
    503: { requestNumber: 'REQ-503', status: 'IN_PROCESS', origin: 'Internal', projectName: 'Plant Expansion B', taskName: '4.2 Steel', requestorName: 'Sam Ortiz',
      requestorUserId: 77, start: 8, end: 22 },
    504: { requestNumber: 'REQ-504', status: 'IN_PROCESS', origin: 'Internal', projectName: 'Pipeline North', requestorName: 'Priya Nair', start: 2, end: 20 },
    506: { requestNumber: 'REQ-506', status: 'DRAFT', origin: 'Internal', projectName: 'Pipeline North', requestorName: 'Priya Nair', start: 12, end: 40 },
  };
  const serial = { isSerialControlled: 'Y', isLotControlled: 'N', isInventoryTracked: 'Y' };
  const L = (req, id, name, extra) => Object.assign({ req, lineId: id, equipmentName: name, className: 'Excavators', quantity: 1, lineStatus: 'SUBMITTED',
    availabilityStatus: 'AVAILABLE', billRate: 1400, priceUom: 'DAY', estimatedCost: 20000, equipmentMasterId: 11 }, serial, extra || {});
  const LINES = [
    L(509, 9091, 'Vibratory Roller', { className: 'Compaction', equipmentMasterId: 51, estimatedCost: 9800 }),
    L(509, 9092, 'Plate Compactor', { className: 'Compaction', equipmentMasterId: 52, estimatedCost: 1200, availabilityStatus: 'NOT AVAILABLE' }),
    L(501, 9011, 'CAT 320 Excavator', { estimatedCost: 38400 }),
    L(501, 9012, 'Dump Truck 30t', { className: 'Trucks', equipmentMasterId: 31, availabilityStatus: 'PARTIAL QUANTITY', estimatedCost: 41600 }),
    L(502, 9021, 'Generator 100 kVA', { className: 'Power', equipmentMasterId: 41, estimatedCost: 37200 }),
    L(503, 9031, 'CAT 320 Excavator', { lineStatus: 'IN_PROCESS', estimatedCost: 38400 }),
    L(503, 9032, 'Trench safety kit', { className: 'Safety', lineStatus: 'IN_PROCESS', quantity: 10, billRate: 75, estimatedCost: 1950, equipmentMasterId: 61,
      isSerialControlled: 'N', isLotControlled: 'N', isInventoryTracked: 'N' }),
    L(504, 9041, 'Roller 10t', { lineStatus: 'ALLOCATED', allocated: 1 }),
    L(506, 9061, 'Skid steer', { lineStatus: 'DRAFT' }),
  ];
  const SERIALS = [
    { unitRefId: 701, unitNumber: 'EX-2201', invOrgId: 300, invOrgName: 'Houston Yard', busy: true },
    { unitRefId: 702, unitNumber: 'EX-2203', invOrgId: 300, invOrgName: 'Houston Yard' },
  ];
  return { REQ, LINES, SERIALS };
}

function backend(W) {
  const reqRow = (id) => {
    const r = W.REQ[id];
    return { eqrEquipmentRequestId: Number(id), requestNumber: r.requestNumber, status: r.status, startDate: day(r.start), endDate: day(r.end), projectName: r.projectName,
      taskName: r.taskName, customerName: r.customerName, requestorName: r.requestorName, requestOrigin: r.origin };
  };
  const allocStatus = (l) => (l.allocated ? 'ALLOCATED' : 'PENDING');
  const detail = (l) => {
    const r = W.REQ[l.req];
    return { lineId: l.lineId, lineNumber: W.LINES.filter((x) => x.req === l.req).indexOf(l) + 1, equipmentName: l.equipmentName, className: l.className,
      quantity: l.quantity, lineStatus: l.lineStatus, availabilityStatus: l.availabilityStatus, allocatedQty: l.allocated || 0, allocationStatus: allocStatus(l),
      billRate: l.billRate, priceUom: l.priceUom, estimatedCost: l.estimatedCost, startDate: iso(r.start), endDate: iso(r.end), requestedStartDate: day(r.start),
      requestedEndDate: day(r.end), isSerialControlled: l.isSerialControlled, isLotControlled: l.isLotControlled, isInventoryTracked: l.isInventoryTracked,
      equipmentMasterId: l.equipmentMasterId, requestNumber: r.requestNumber, requestStatus: r.status, projectName: r.projectName, taskName: r.taskName,
      requestorName: r.requestorName, deploymentLocation: 'Gate 2', source: r.origin === 'External' ? 'EXTERNAL' : 'INTERNAL' };
  };
  return function handle(req, res) {
    const p = req.path.replace('/equiprite/v1', '');
    const q = req.query;
    let m;
    if (p === '/views/my-requests') return res.json({ data: Object.keys(W.REQ).map(reqRow) });
    if (p === '/views/my-request-lines') {
      return res.json({ data: W.LINES.map((l) => ({ requestNumber: W.REQ[l.req].requestNumber, lineNumber: W.LINES.filter((x) => x.req === l.req).indexOf(l) + 1,
        equipmentName: l.equipmentName, className: l.className, qty: l.quantity, lineStatus: l.lineStatus, allocationStatus: allocStatus(l) })) });
    }
    if (p === '/views/request-detail-lines') return res.json({ data: W.LINES.filter((l) => l.req === Number(q.get('requestId'))).map(detail) });
    if ((m = /^\/equipment-requests\/(\d+)$/.exec(p))) {
      const r = W.REQ[m[1]];
      if (!r) return res.json({}, 404);
      if (req.method === 'PATCH') { r.status = req.json().status; return res.json({ id: Number(m[1]) }); }
      return res.json({ id: Number(m[1]), requestNumber: r.requestNumber, status: r.status, requestorName: r.requestorName, requestorUserId: r.requestorUserId,
        customerName: r.customerName, projectName: r.projectName, taskName: r.taskName, requestType: r.origin === 'External' ? 'EXTERNAL' : 'INTERNAL',
        requestedStartDate: day(r.start), requestedEndDate: day(r.end), attribute1: 'Gate 2' });
    }
    if ((m = /^\/equipment-requests\/(\d+)\/lines$/.exec(p))) {
      return res.json({ data: W.LINES.filter((l) => l.req === Number(m[1])).map((l) => Object.assign(detail(l), { id: l.lineId, eqrEquipmentRequestId: l.req })) });
    }
    if ((m = /^\/equipment-requests\/(\d+)\/lines\/batch$/.exec(p)) && req.method === 'PATCH') {
      const body = req.json();
      body.lines.forEach((u) => { const l = W.LINES.find((x) => x.lineId === Number(u.id)); if (l) l.lineStatus = u.lineStatus; });
      return res.json({ data: body.lines });
    }
    if (p === '/views/line-detail-units') {
      const l = W.LINES.find((x) => x.lineId === Number(q.get('lineId')));
      if (!l || l.equipmentMasterId !== 11) return res.json({ data: [] });
      const r = W.REQ[l.req];
      return res.json({ data: W.SERIALS.map((u) => ({ lineId: l.lineId, requestNumber: r.requestNumber, requestStatus: r.status, source: 'INTERNAL', lineStatus: l.lineStatus,
        equipmentMasterId: 11, equipmentName: l.equipmentName, className: l.className, quantity: 1, isSerialControlled: 'Y', isLotControlled: 'N', isInventoryTracked: 'Y',
        lineStartDate: day(r.start), lineEndDate: day(r.end), allocStatus: 'PENDING', unitType: 'SERIAL', unitRefId: u.unitRefId, serialRefId: u.unitRefId,
        unitNumber: u.unitNumber, invOrgId: u.invOrgId, invOrgName: u.invOrgName, availabilityStatus: u.busy ? 'NOT AVAILABLE' : 'AVAILABLE' })) });
    }
    if (p === '/views/line-detail-bookings') return res.json({ data: [] });
    if (p === '/transfer-orders' || p === '/allocations') return res.json({ data: [] });
    return undefined;
  };
}

const settle = (page, ms) => page.waitForTimeout(ms || 400);
/** The rows an oj-table shows, as text (whitespace collapsed), those naming a request. */
const tableRows = (page, sel) => page.$$eval(sel + ' tbody tr, ' + sel + ' .oj-table-body-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /REQ-\d+|\w/.test(t)));
const numbers = (rows) => rows.map((r) => (r.match(/REQ-\d+/) || [''])[0]).filter(Boolean).join(',');
/** Each Oracle component under root: 'tag:ok' once upgraded (oj-complete). */
const upgraded = (page, root, tags) => page.evaluate(([r, ts]) => ts.map((t) => {
  const el = document.querySelector(r + ' ' + t);
  return t + ':' + (!el ? 'missing' : (el.classList.contains('oj-complete') ? 'ok' : 'pending'));
}).join(' '), [root, tags]);
const allOk = (tags) => tags.map((t) => t + ':ok').join(' ');
/** A selector's visible match: each tab is its own flow under oj-vb-switcher, and the tabs not shown stay on the page. */
const vis = (sel) => sel + ' >> visible=true';
/**
 * Oracle's header in a Redwood view (root: the view, e.g. #recRedwood): its title, subtitle, badge, way back, primary action
 * and the others (actions: Oracle shows the first beside the primary, or none when there is a primary and more than one,
 * and the rest in its "More actions" menu; all of them here, in the order given).
 */
const header = (page, root) => page.$eval(vis(root), (r) => {
  const g = r.querySelector('oj-sp-general-overview-page');
  const txt = (sel) => { const e = g.querySelector(sel); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; };
  const shown = (e) => !!e && e.getClientRects().length > 0;
  const name = (b) => String(b.label || b.innerText || '').replace(/\s+/g, ' ').trim() + (b.disabled ? ' (off)' : '');
  const group = g.querySelector('.oj-sp-header-general-overview-button-group');
  const buttons = group ? Array.from(group.querySelectorAll('oj-c-button')).filter(shown) : [];
  const menu = group ? Array.from(group.querySelectorAll('oj-c-menu-button')).filter(shown)[0] : null;
  const primary = buttons.filter((b) => /_primaryAction$/.test(b.id))[0];
  return {
    title: txt('h1'),
    sub: txt('[id$="_pageSubtitle"]'),
    badge: txt('.oj-sp-header-general-overview-badge-text'),
    back: shown(g.querySelector('.oj-sp-header-general-overview-inflow-back-btn')),
    primary: primary ? name(primary) : '',
    actions: buttons.filter((b) => b !== primary).map(name)
      .concat(menu && Array.isArray(menu.items) ? menu.items.map((i) => String(i.label || '') + (i.disabled ? ' (off)' : '')) : []).filter(Boolean),
  };
});
/** Clicks an action of Oracle's header in a Redwood view, by its label: its button, or the item in its "More actions" menu. */
async function headerAction(page, root, label) {
  const how = await page.$eval(vis(root), (r, l) => {
    const shown = (e) => !!e && e.getClientRects().length > 0;
    const group = r.querySelector('oj-sp-general-overview-page .oj-sp-header-general-overview-button-group');
    const b = Array.from(group.querySelectorAll('oj-c-button')).filter((x) => shown(x) && String(x.label || x.innerText || '').replace(/\s+/g, ' ').trim() === l)[0];
    if (b) { (b.querySelector('button') || b).click(); return 'button'; }
    const menu = Array.from(group.querySelectorAll('oj-c-menu-button')).filter(shown)[0];
    if (menu && (menu.items || []).some((i) => i.label === l)) { (menu.querySelector('button') || menu).click(); return 'menu'; }
    return '';
  }, label);
  if (!how) throw new Error('no header action "' + label + '" in ' + root);
  if (how === 'menu') {
    const item = page.locator('[role="menuitem"]', { hasText: label }).filter({ visible: true }).first();
    await item.waitFor({ timeout: 10000 });
    await item.click();
  }
}
const headerBack = (page, root) => page.click(vis(root + ' .oj-sp-header-general-overview-inflow-back-btn button'));
const activeTab = (page) => page.$eval('.nx-tab--on', (t) => t.dataset.tabId);
const waitTab = (page, id) => page.waitForFunction((x) => !!document.querySelector('.nx-tab--on') && document.querySelector('.nx-tab--on').dataset.tabId === x, id, { timeout: 20000 });
/** Waits until the visible match of sel reads re (a regular expression's source). */
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, x]) => {
  const e = Array.from(document.querySelectorAll(s)).filter((el) => el.getClientRects().length > 0)[0];
  return !!e && new RegExp(x).test(e.innerText || '');
}, [sel, re], { timeout: timeout || 20000 });

(async () => {
  const W = world();
  const env = await E.start({ port: 19640, handle: backend(W), app: 'next' });
  const { page } = env;
  const errs = () => env.errors.filter((e) => !/404|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('Current, to start: Approve & allocate as it is');
    await env.open('/?open=approvals');
    await page.waitForSelector('.nx-ap-q', { timeout: 30000 });
    await settle(page, 500);
    T.check('the current queue and its head; no Redwood view on the page yet', (await page.isVisible('.nx-approvals .nx-pagehead')) && !(await page.$('#apRedwood')));

    T.section('Redwood, chosen in your menu');
    await env.setLook('redwood');
    T.eq('Redwood on every screen', await page.getAttribute('html', 'data-nx-look'), 'redwood');

    // ── Approve & allocate: the list (L) ──────────────────────────────────────────────────────────────────────
    T.section('Approve & allocate: the queue is Oracle\'s Smart Search page');
    await page.waitForSelector('#apRedwood oj-sp-smart-search-page.oj-complete', { timeout: 30000 });
    await page.waitForFunction(() => /REQ-509/.test((document.querySelector('#apRwTable') || {}).innerText || ''), null, { timeout: 30000 });
    await settle(page, 800);
    const LIST = ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button'];
    T.eq('Oracle\'s components, upgraded', await upgraded(page, '#apRedwood', LIST), allOk(LIST));
    const apHead = await env.text('#apRedwood oj-sp-smart-search-page h1');
    T.eq('the template\'s own title', apHead, 'Approve & allocate');
    T.check('…and the queue\'s summary under it', (await env.text('#apRedwood oj-sp-smart-search-page')).includes('3 requests to decide · 1 request with units to assign · 1 late'));
    T.check('the current look\'s head, chips, queue and empty panel step aside', !(await page.$('.nx-approvals .nx-pagehead')) && !(await page.$('.nx-ap-queue'))
      && !(await page.isVisible('#apPanel')) && !(await page.$('.nx-approvals .nx-toolbar')));
    let rows = await tableRows(page, '#apRwTable');
    T.eq('a table row per request waiting, most urgent first (as the current queue)', numbers(rows), 'REQ-509,REQ-501,REQ-502,REQ-503');
    const r509 = rows.find((r) => r.includes('REQ-509')) || '';
    T.check('a row: number, type and requester; project and task; what it waits for; its equipment; dates, how late', r509.includes('Project · Sam Ortiz')
      && r509.includes('Plant Expansion B') && r509.includes('1.3 Foundations') && r509.includes('To decide') && r509.includes('2 lines waiting for your decision')
      && r509.includes('Vibratory Roller and Plate Compactor') && r509.includes('3 days late'), r509);
    T.eq('what each waits for, as Oracle\'s oj-badge', await page.$$eval('#apRwTable .oj-badge', (b) => b.map((x) => x.innerText.trim() + ':' + (x.classList.contains('oj-badge-info') ? 'info'
      : (x.classList.contains('oj-badge-warning') ? 'warning' : 'neutral'))).join(' ')), 'To decide:info To decide:info To decide:info Units to assign:warning');
    T.eq('a tick box on each request to decide, as on the current queue', await page.$$eval('#apRwTable .nx-ap-rw-tick input', (b) => b.length), 3);
    T.check('every column fits: nothing scrolls sideways', await page.$eval('#apRwTable .oj-table-scroller', (s) => s.scrollWidth <= s.clientWidth + 1)
      && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await env.shot('rw-work-approvals.png');

    T.section('ticked requests decided together, from Oracle\'s bar over the table (bulkChain)');
    await page.check('#apRwTable .nx-ap-rw-tick input[data-id="501"]');
    await page.waitForSelector('#apRwBulk', { timeout: 10000 });
    await page.check('#apRwTable .nx-ap-rw-tick input[data-id="502"]');
    await page.waitForFunction(() => /2 requests ticked/.test((document.querySelector('#apRwBulk') || {}).innerText || ''), null, { timeout: 10000 });
    T.check('the bar says what the ticked requests add up to', (await env.text('#apRwBulk')).includes('2 requests ticked · 1 project, 1 customer · 3 lines'), await env.text('#apRwBulk'));
    T.eq('its buttons are Oracle\'s, saying what they do', await page.$$eval('#apRwBulk .nx-ap-bulk-row oj-c-button', (b) => b.map((x) => x.label).join(' | ')),
      'Clear | Send back 2 requests… | Approve 2 requests');
    T.eq('ticking opens nothing', await page.isVisible('#apRwRecord'), false);
    const wb = env.writes.length;
    await page.click('#apRwBulkApprove');
    await page.waitForSelector('#apRwBulkResult', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.nx-approvals .nx-ap-spin'), null, { timeout: 30000 });
    await settle(page, 600);
    T.eq('the same writes as the current look\'s Approve: the lines then the header, request by request', env.writes.slice(wb).map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', '')).join(' > '),
      'PATCH /equipment-requests/501/lines/batch > PATCH /equipment-requests/501 > PATCH /equipment-requests/502/lines/batch > PATCH /equipment-requests/502');
    T.check('the result, in words', (await env.text('#apRwBulkResult')).includes('2 of 2 requests approved'), await env.text('#apRwBulkResult'));
    rows = await tableRows(page, '#apRwTable');
    T.check('read back: both now wait for units', ['REQ-501', 'REQ-502'].every((n) => (rows.find((r) => r.includes(n)) || '').includes('Units to assign')), rows.join(' || '));

    T.section('a filter per column, as the table shows them');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#apRedwood oj-sp-smart-search .oj-sp-filter-chip-container'))
      .filter((x) => x.innerText.trim()).length === 7, null, { timeout: 15000 }).catch(() => {});
    await settle(page, 600);
    const chips = await page.$$eval('#apRedwood oj-sp-smart-search .oj-sp-filter-chip-container', (b) => b.map((x) => x.innerText.trim()));
    const heads = await page.$$eval('#apRwTable .oj-table-column-header-cell', (h) => h.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
    T.eq('the table\'s columns', heads.join(','), 'Request,Project or customer,Waiting for,Equipment,Dates');
    T.eq('the filters are the columns, in their order, then Type and Requester', chips.join(','), heads.concat(['Type', 'Requester']).join(','));
    await page.click('#apRedwood oj-sp-smart-search .oj-sp-filter-chip-container:has-text("Equipment")');
    await page.waitForSelector('text=CAT 320 Excavator (2)', { timeout: 10000 });
    T.eq('Equipment offers what the waiting lines hold, with how many requests', await page.$$eval('[role=option], li', (o) => o.filter((x) => x.offsetParent !== null)
      .map((x) => x.innerText.trim()).filter((t) => /^(CAT|Dump|Generator|Plate|Trench|Vibratory).*\(\d+\)$/.test(t)).join(',')),
      'CAT 320 Excavator (2),Dump Truck 30t (1),Generator 100 kVA (1),Plate Compactor (1),Trench safety kit (1),Vibratory Roller (1)');
    await page.click('text=CAT 320 Excavator (2)');
    await settle(page, 600);
    await page.click('#apRedwood oj-sp-smart-search-page h1');
    await page.waitForFunction(() => !/REQ-509/.test((document.querySelector('#apRwTable') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    await settle(page, 600);
    T.eq('picked (applied as its list closes): the requests waiting with that equipment', numbers(await tableRows(page, '#apRwTable')), 'REQ-501,REQ-503');
    await env.shot('rw-work-approvals-filter.png');

    // ── Approve & allocate: a request (R), as the current look's row opens it ─────────────────────────────────────
    T.section('a row opens the request\'s panel, under Oracle\'s header');
    await page.click('#apRwTable .nx-rw-num:has-text("REQ-503")');
    await page.waitForSelector('#apRwRecord:not([hidden]) oj-sp-general-overview-page.oj-complete', { timeout: 20000 });
    await page.waitForSelector('#apAuto', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.nx-approvals .nx-ap-spin'), null, { timeout: 30000 });
    await settle(page, 600);
    let h = await header(page, '#apRwRecord');
    T.eq('the header: the request, what kind and for whom, where it is as Oracle\'s badge', [h.title, h.sub, h.badge].join(' | '),
      'REQ-503 | Project request · Plant Expansion B · 4.2 Steel | Getting ready');
    T.eq('…the way back, and the current look\'s buttons as its actions', [h.back, h.primary, h.actions.join(', ')].join(' | '), 'true |  | Open in a tab, In New, Refresh');
    T.check('the queue steps aside; the panel is the current look\'s (its suggestions, its lines)', !(await page.isVisible('#apRedwood')) && await page.isVisible('#apPanel')
      && (await env.text('.nx-ap-line[data-line="9031"]')).includes('Suggested: EX-2203 (Houston Yard)') && !(await page.$('.nx-ap-rec-head')) && !(await page.$('.nx-ap-back')));
    T.check('the panel takes the width', await page.$eval('#apPanel', (p) => p.getBoundingClientRect().width > 900));
    await env.shot('rw-work-approvals-record.png');

    T.section('a header action: Open in a tab (openRecordChain): the request\'s own tab, in Redwood');
    await headerAction(page, '#apRwRecord', 'Open in a tab');
    await waitTab(page, 'request:503');
    await page.waitForSelector(vis('#recRedwood oj-sp-general-overview-page.oj-complete'), { timeout: 20000 });
    await waitText(page, '#recRedwood h1', 'REQ-503');
    await page.waitForSelector(vis('#recRwLines .oj-table-body-row'), { timeout: 20000 });
    await settle(page, 600);
    h = await header(page, '#recRedwood');
    T.eq('Oracle\'s header: the request, the kicker and the project, where it is', [h.title, h.sub, h.badge].join(' | '),
      'REQ-503 | Project request · Plant Expansion B · 4.2 Steel | Getting ready');
    T.eq('its next step the primary action, the current head\'s other buttons its actions; the way back to Requests', [h.back, h.primary, h.actions.join(', ')].join(' | '),
      'true | Assign units | Refresh, Export to Excel, Act on it in New');
    T.check('the current head steps aside; the body is the tab\'s own', !(await page.$(vis('.nx-record .nx-pagehead'))) && !!(await page.$(vis('.nx-journey')))
      && !!(await page.$(vis('.nx-facts'))));
    T.eq('the equipment as Oracle\'s table, where each piece is as an oj-badge', await page.$$eval(vis('#recRwLines .oj-table-body-row'), (r) => r.map((x) => {
      const b = x.querySelector('.oj-badge');
      return x.querySelector('td').innerText.split('\n')[0].trim() + ':' + (b ? b.innerText.trim() : '');
    }).join(' | ')), 'CAT 320 Excavator:Approved, no unit assigned yet | Trench safety kit:Approved, no unit assigned yet');
    T.check('…the Current grid steps aside', !(await page.$(vis('.nx-grid--lines'))));
    await env.shot('rw-work-request.png');

    T.section('its primary action, Assign units: Approve & allocate opened on it (focus), in Redwood');
    await page.click(vis('#recRedwood [id$="_primaryAction"]'));
    await waitTab(page, 'approvals');
    await page.waitForSelector('#apFocus', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.nx-approvals .nx-ap-spin'), null, { timeout: 30000 });
    await settle(page, 600);
    h = await header(page, '#apRwRecord');
    T.check('shown directly: the request\'s header and panel, not the queue', h.title === 'REQ-503' && (await page.isVisible('#apRwRecord')) && !(await page.isVisible('#apRedwood'))
      && await page.isVisible('#apAuto'), JSON.stringify(h));
    T.check('the bar says only it is shown, and why; its buttons are the header\'s', (await env.text('#apFocus')).includes('Only REQ-503') && (await env.text('#apFocus')).includes('Opened from its tab')
      && !(await page.$('#apFocusAll')) && h.actions.join(', ') === 'Show the whole queue (4), Open in a tab, In New, Refresh', (await env.text('#apFocus')) + ' | ' + h.actions.join(', '));
    await env.shot('rw-work-approvals-focus.png');
    await headerBack(page, '#apRwRecord');
    await waitTab(page, 'request:503');
    T.eq('its way back: the request\'s tab, as Back to REQ-503 does', await activeTab(page), 'request:503');

    T.section('back on Approve & allocate: the request still open; its way back is the queue');
    await page.click('.nx-tab-btn[data-id="approvals"]');
    await waitTab(page, 'approvals');
    await settle(page, 500);
    T.check('the request, as it was left (focus over)', (await page.isVisible('#apRwRecord')) && !(await page.$('#apFocus')));
    await headerBack(page, '#apRwRecord');
    await page.waitForSelector('#apRedwood:not([hidden])', { timeout: 10000 });
    await settle(page, 500);
    T.eq('the queue again, its filter kept', numbers(await tableRows(page, '#apRwTable')), 'REQ-501,REQ-503');

    // ── My work ───────────────────────────────────────────────────────────────────────────────────────────────
    T.section('My work: Oracle\'s header over its own body');
    await page.click('.nx-tab-btn[data-id="home"]');
    await waitTab(page, 'home');
    await page.waitForSelector('#workRedwood oj-sp-general-overview-page.oj-complete', { timeout: 20000 });
    await page.waitForSelector('.nx-work .nx-kpi[data-tile]', { timeout: 20000 });
    await settle(page, 600);
    h = await header(page, '#workRedwood');
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    T.check('the greeting is the title', /^Good (morning|afternoon|evening), Priya$/.test(h.title), h.title);
    T.eq('the role and today are the subtitle', h.sub, 'Your work as Equipment Manager · ' + today);
    T.eq('Refresh is its action', h.actions.join(', '), 'Refresh');
    T.check('the current head steps aside; the body is its own (counts, what needs you, latest requests)', !(await page.$('.nx-work .nx-pagehead'))
      && await page.isVisible('.nx-work .nx-kpis') && await page.isVisible('#needsTitle') && await page.isVisible('.nx-grid--recent'));
    T.eq('open a request: Oracle\'s field in the header', await upgraded(page, '#workRedwood', ['oj-sp-general-overview-page', 'oj-c-input-text']),
      allOk(['oj-sp-general-overview-page', 'oj-c-input-text']));
    await env.shot('rw-work-mywork.png');
    const before = env.calls.filter((c) => c.includes('/views/my-requests')).length;
    await headerAction(page, '#workRedwood', 'Refresh');
    await settle(page, 1500);
    T.check('Refresh reads your work again', env.calls.filter((c) => c.includes('/views/my-requests')).length > before);
    await page.fill('#workRwFind input', '509');
    await page.press('#workRwFind input', 'Enter');
    await waitTab(page, 'request:REQ-509');
    T.eq('a typed number opens that request, in its tab', await activeTab(page), 'request:REQ-509');
    await waitText(page, '#recRedwood h1', 'REQ-509');
    await waitText(page, '#recRedwood', 'Approve');
    await settle(page, 500);
    h = await header(page, '#recRedwood');
    T.eq('a request to decide: Approve… is its primary action', [h.badge, h.primary].join(' | '), 'Waiting for approval | Approve…');
    await page.click(vis('#recRedwood [id$="_primaryAction"]'));
    await waitTab(page, 'approvals');
    await page.waitForSelector('#apDecide', { timeout: 30000 });
    await settle(page, 500);
    T.check('Approve…: the decision, under Oracle\'s header', (await header(page, '#apRwRecord')).title === 'REQ-509' && (await env.text('#apApprove')) === 'Approve all 2 lines');
    await env.shot('rw-work-approvals-decide.png');
    // Back to REQ-509 opens it by its id, as the current look's "Back to REQ-509" does.
    await headerBack(page, '#apRwRecord');
    await waitTab(page, 'request:509');

    // ── New request ───────────────────────────────────────────────────────────────────────────────────────────
    T.section('New request: Oracle\'s header over its three steps');
    await page.click('#nxNewRequest');
    await waitTab(page, 'new-request');
    await page.waitForSelector('#orRedwood oj-sp-general-overview-page.oj-complete', { timeout: 20000 });
    await page.waitForSelector('#orSteps', { timeout: 20000 });
    await settle(page, 600);
    h = await header(page, '#orRedwood');
    T.eq('the title, and who it is for with what to do first', [h.title, h.sub].join(' | '), 'New request | Project request · Pick the dates, then the equipment; then the project, and review.');
    T.eq('no head buttons on Current, none on the header', h.actions.length + (h.primary ? 1 : 0), 0);
    T.check('the current head steps aside; the three steps are its own', !(await page.$('.nx-order .nx-pagehead')) && await page.isVisible('#orSteps'));
    await env.shot('rw-work-new-request.png');

    T.section('a draft: Finish this draft from its tab; Start another request on the header');
    await page.click('.nx-tab-btn[data-id="home"]');
    await waitTab(page, 'home');
    await page.fill('#workRwFind input', '506');
    await page.press('#workRwFind input', 'Enter');
    await waitTab(page, 'request:REQ-506');
    await waitText(page, '#recRedwood', 'Finish this draft');
    h = await header(page, '#recRedwood');
    T.eq('a draft: Finish this draft is its primary action; no Act on it in New', [h.primary, h.actions.join(', ')].join(' | '), 'Finish this draft | Refresh, Export to Excel');
    await page.click(vis('#recRedwood [id$="_primaryAction"]'));
    await waitTab(page, 'draft:506');
    await waitText(page, '#orRedwood', 'Start another request');
    await settle(page, 600);
    h = await header(page, '#orRedwood');
    T.check('the draft\'s tab: its title, and Start another request as the header\'s action', h.title === 'Draft REQ-506' && h.actions.join() === 'Start another request', JSON.stringify(h));
    await headerAction(page, '#orRedwood', 'Start another request');
    await waitText(page, '#orRedwood h1', '^\\s*New request\\s*$');
    h = await header(page, '#orRedwood');
    T.check('Start another request (resetChain): an empty request, the action gone', h.title === 'New request' && !h.actions.length, JSON.stringify(h));

    // ── A screen still being built ────────────────────────────────────────────────────────────────────────────────
    T.section('a screen still being built: Oracle\'s header, its two links the header\'s actions');
    // Every menu item is built today: one is marked as not, in this browser only, to open the "being built" tab.
    await page.evaluate(() => new Promise((r) => window.require(['resources/js/nav', 'resources/js/shellBus'], (nav, bus) => {
      nav.item('integrations').built = false;
      bus.open({ navId: 'integrations' });
      r();
    })));
    await waitTab(page, 'integrations');
    await page.waitForSelector(vis('#soonRedwood oj-sp-general-overview-page.oj-complete'), { timeout: 20000 });
    await settle(page, 600);
    h = await header(page, '#soonRedwood');
    T.eq('the screen, what it is, and its links', [h.title, h.sub, h.primary, h.actions.join(', ')].join(' | '),
      'Integrations | Being built for EquipRite Next | Open it in New EquipRite | Open Old EquipRite');
    T.check('the card says why, without its own title and links', (await env.text(vis('.nx-soon-card'))).includes('being designed and built') && !(await page.$(vis('.nx-soon-card h1')))
      && !(await page.$(vis('#soonOpenNew'))));
    await env.shot('rw-work-soon.png');

    T.eq('no browser errors while working in Redwood', errs().join(' | ').slice(0, 1500), '');

    // ── Back to Current ───────────────────────────────────────────────────────────────────────────────────────
    T.section('Current: every screen as it was');
    await page.click('.nx-tab-btn[data-id="approvals"]');
    await waitTab(page, 'approvals');
    await env.setLook('current');
    await page.waitForSelector('.nx-ap-q', { timeout: 15000 });
    await settle(page, 500);
    T.check('Approve & allocate: the current queue and head; the Redwood views kept, hidden', (await page.isVisible('.nx-approvals .nx-pagehead'))
      && !(await page.isVisible('#apRedwood')) && !(await page.isVisible('#apRwRecord')) && await page.isVisible('.nx-ap-queue'));
    T.eq('…its queue not filtered by Redwood\'s column filter (Current does not show it)', await page.$$eval('.nx-ap-q', (r) => r.map((x) => x.dataset.number).join(',')),
      'REQ-509,REQ-501,REQ-502,REQ-503');
    T.check('…the request left open in Redwood is open here, under the current look\'s own head', (await page.isVisible('#apRecTitle'))
      && (await env.text('#apRecTitle')).startsWith('REQ-509') && await page.isVisible('#apDecide'));
    await page.click('.nx-tab-btn[data-id="home"]');
    await waitTab(page, 'home');
    await settle(page, 400);
    T.check('My work: the current head, the find box in it', (await page.isVisible('.nx-work .nx-pagehead')) && (await page.isVisible('#workFind')) && !(await page.isVisible('#workRedwood')));
    await page.click('.nx-tab-btn[data-id="request:503"]');
    await waitTab(page, 'request:503');
    await settle(page, 400);
    T.check('a request\'s tab: the current head and grid; its Redwood views kept, hidden', !!(await page.$(vis('.nx-record-title'))) && !!(await page.$(vis('.nx-grid--lines')))
      && !(await page.$(vis('#recRedwood'))) && !(await page.$(vis('#recRwLines'))));
    await page.click('.nx-tab-btn[data-id="new-request"]');
    await waitTab(page, 'new-request');
    await settle(page, 400);
    T.check('New request: the current head', (await page.isVisible('.nx-order .nx-pagehead')) && !(await page.isVisible('#orRedwood')));
    await env.shot('rw-work-current.png');
    T.eq('no browser errors, switching back included', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('run finished', false, String((e && e.stack) || e).slice(0, 1500));
    await env.shot('rw-work-failed.png').catch(() => {});
  } finally {
    await env.close();
  }
  T.report();
})();
