'use strict';
/*
 * EquipRite Mobile, the Pick tab, in a phone-sized browser (390 x 844, touch) against a stateful fake backend (the
 * answers Next's yard reads): today's work (sections by the day it must ship, late first; the yard, remembered on the
 * phone; search; chips), scanning first from the list (a fake camera: a canvas stream and a stand-in tag reader fed by
 * the test), a request's pick list (by step, in walking order, the next piece), ticking by tap, scan and typed unit,
 * Release and Ship with what they say before and exactly what they write, the pick slip, focus from My requests and a
 * deep link, read-only (no writes offered), no connection (the saved copy, ticks kept, nothing sent; back online,
 * sent only when confirmed), no sideways scroll, no browser errors. The list opens on the last 3 days: an older request
 * is left out (a line under the list says so, the tab's count leaves it out too), All shows it, a search and a deep
 * link reach it.
 * Needs `npm run build`. Run: node tests/e2e/mobile-pick.e2e.js   (screenshots go to the OS temp folder)
 */
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const V1 = '/equiprite/v1';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const flags = E.ALL_FLAGS.concat(['SHIPPING_DOCUMENTS_ENABLED']);

// ── The yard's work ──────────────────────────────────────────────────────────────────────────────────────────────────
const QUEUE = [ // one row per line for 2003, as the view may answer
  { eqrEquipmentRequestId: 2003, requestNumber: 'REQ-2003', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'EPC_MO_Operations', taskName: '4.1 Civil works',
    requestor: 'Priya Raman', location: 'Moss Landing site', requestedStartDate: day(-2) + 'T00:00:00Z', requestedEndDate: day(40) + 'T00:00:00Z' },
  { eqrEquipmentRequestId: 2003, requestNumber: 'REQ-2003', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'EPC_MO_Operations' },
  { eqrEquipmentRequestId: 2007, requestNumber: 'REQ-2007', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Pipeline North', taskName: '2.1 Trenching',
    requestor: 'Dana Cole', location: 'Odessa camp', requestedStartDate: day(0) + 'T00:00:00Z', requestedEndDate: day(30) + 'T00:00:00Z' },
  { eqrEquipmentRequestId: 2011, requestNumber: 'REQ-2011', requestStatus: 'IN_PROCESS', source: 'EXTERNAL', customerName: 'Gulf Coast Builders', contactName: 'Ann Lee',
    location: 'Galveston', requestedStartDate: day(5) + 'T00:00:00Z', requestedEndDate: day(60) + 'T00:00:00Z' },
  // Older than the last 3 days (it started and ended before them): left out until All, a search or a deep link asks.
  { eqrEquipmentRequestId: 1990, requestNumber: 'REQ-1990', requestStatus: 'IN_PROCESS', source: 'INTERNAL', projectName: 'Old Quarry', taskName: '9.1 Crushing',
    requestor: 'Lee Chan', location: 'Quarry gate', requestedStartDate: day(-40) + 'T00:00:00Z', requestedEndDate: day(-10) + 'T00:00:00Z' },
];
const START = { 5001: 'SCHEDULED_FOR_PICKING', 5002: 'SCHEDULED_FOR_PICKING', 5003: 'PICK_INITIATED', 5004: 'PICK_INITIATED', 5005: 'SHIP_TO_SITE', 5006: 'DRAFT',
  7101: 'PICK_INITIATED', 7102: 'SCHEDULED_FOR_PICKING', 7201: 'EQP_INSPECTION_COMPLETE', 7202: 'SHIP_TO_SITE', 1901: 'PICK_INITIATED' };
const status = {};
const reset = () => Object.assign(status, START);
const L = (id, name, cls, master, o) => Object.assign({ id, name, cls, master, tx: 'N', mt: 'N', fc: 'F_AND_M', yard: 'Houston Yard', sub: 'Available' }, o);
const LINES = {
  2003: [
    L(5001, 'Volvo A30 Dump Truck', 'Trucks', 11, { to: 'TO-880101', tx: 'Y', fc: 'S_AND_T', unit: 'DT-3001', loc: 'A-03-01' }),
    L(5002, 'Roller 10t', 'Rollers', 12, { unit: 'RL-1002', loc: 'B-10-02' }),
    L(5003, 'Generator 100 kVA', 'Power', 13, { unit: 'GN-0412', loc: 'B-2-01' }),
    L(5004, 'Light tower', 'Lighting', 14, { unit: 'LT-0042', loc: 'A-12-04' }),
    L(5005, 'Site office cabin', 'Cabins', 15, { unit: 'CB-0003', loc: 'C-02-01' }),
    L(5006, 'Fuel bowser', 'Fuel', 16, { tx: 'Y', fc: 'S_AND_T' }),
  ],
  2007: [
    L(7101, 'Trencher T-450', 'Trenchers', 21, { to: 'TO-880500', tx: 'Y', fc: 'S_AND_T', unit: 'TR-0450', yard: 'Atlanta Yard', loc: 'T-01-01' }),
    L(7102, 'Komatsu PC210 Excavator', 'Excavators', 22, { to: 'TO-880501', tx: 'Y', fc: 'S_AND_T', unit: 'EX-2207', unitStatus: 'DAMAGED', yard: 'Atlanta Yard',
      sub: 'Maintenance', loc: 'M-01' }),
  ],
  2011: [
    L(7201, 'Crawler crane 80t', 'Cranes', 31, { to: 'TO-880600', tx: 'Y', fc: 'S_AND_T', unit: 'CR-0080' }),
    L(7202, 'Generator 60 kVA', 'Power', 32, { to: 'TO-880600', tx: 'Y', fc: 'S_AND_T', unit: 'GN-0060' }),
  ],
  1990: [L(1901, 'Jaw Crusher', 'Crushing', 41, { unit: 'JC-0001', loc: 'Q-01-01' })],
};
const TOS = { 2003: [{ id: 9101, orderNumber: 'TO-880101', orderStatus: 'OPEN', createdDate: '2026-10-28T10:00:00Z' }],
  2007: [{ id: 9201, orderNumber: 'TO-880500', orderStatus: 'OPEN', createdDate: '2026-10-27T10:00:00Z' }, { id: 9202, orderNumber: 'TO-880501', orderStatus: 'OPEN', createdDate: '2026-10-29T10:00:00Z' }],
  2011: [{ id: 9301, orderNumber: 'TO-880600', orderStatus: 'OPEN', createdDate: '2026-10-20T10:00:00Z' }] };
const TO_LINES = { 9101: [5001], 9201: [7101], 9202: [7102], 9301: [7201, 7202] };
const ALL = [].concat(...Object.values(LINES));
const lineById = (id) => ALL.filter((l) => l.id === id)[0];
const reqOf = (rid) => QUEUE.filter((r) => r.eqrEquipmentRequestId === rid && r.requestedStartDate)[0];

function detailRows(rid) {
  const r = reqOf(rid);
  return (LINES[rid] || []).map((l) => ({ requestId: rid, requestNumber: r.requestNumber, requestStatus: r.requestStatus, lineId: l.id, equipmentName: l.name,
    className: l.cls, quantity: 1, lineStatus: status[l.id], startDate: r.requestedStartDate.slice(0, 10), endDate: r.requestedEndDate.slice(0, 10),
    toNumber: l.to || '', isTransactable: l.tx, isMaintenanceTracked: l.mt, fulfilmentClass: l.fc, deploymentLocation: r.location }));
}

function handle(req, res) {
  const p = req.path;
  const q = req.query;
  let m;
  if (p.endsWith('/conf-global-settings')) {
    return res.json({ data: flags.map((k) => ({ settingKey: k, settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' })) });
  }
  if (p.endsWith('/views/workbench-requests')) return res.json({ data: q.get('stage') === 'INITIATE' ? QUEUE : [] });
  if (p.endsWith('/views/request-detail-lines')) return res.json({ data: detailRows(Number(q.get('requestId'))) });
  // My requests (the picker's own request, REQ-2003): its "Pick" button hands it to this tab.
  if (p.endsWith('/views/my-requests')) {
    return res.json({ data: [{ eqrEquipmentRequestId: 2003, requestNumber: 'REQ-2003', status: 'IN_PROCESS', projectName: 'EPC_MO_Operations', requestorName: 'Priya Raman',
      requestorUsername: 'priya.raman', startDate: day(-2), endDate: day(40), requestOrigin: 'Internal' }] });
  }
  if (p.endsWith('/views/my-request-lines')) return res.json({ data: detailRows(2003).map((r) => Object.assign(r, { allocationStatus: 'ALLOCATED' })) });
  if (p.endsWith('/transfer-orders')) return res.json({ data: TOS[Number(q.get('equipmentRequestId'))] || [] });
  if (p.endsWith('/transfer-order-lines')) return res.json({ data: (TO_LINES[Number(q.get('transferOrderId'))] || []).map((id) => ({ requestLineId: id })) });
  if (req.method === 'GET' && (m = /\/equipment-requests\/(\d+)\/lines$/.exec(p))) {
    return res.json({ data: (LINES[Number(m[1])] || []).map((l) => ({ id: l.id, eqrEquipmentMasterId: l.master, quantity: 1, lineStatus: status[l.id],
      fulfilmentClass: l.fc, isTransactable: l.tx, isMaintenanceTracked: l.mt })) });
  }
  if (p.endsWith('/views/line-detail-units')) {
    const l = lineById(Number(q.get('lineId')));
    if (!l || !l.unit) return res.json({ data: [] });
    return res.json({ data: [{ equipmentName: l.name, className: l.cls, allocationId: 100 + l.id, unitNumber: l.unit, unitStatus: l.unitStatus || 'RENTED',
      unitRefId: l.id, unitType: 'SERIAL', allocationMethod: 'MANUAL', sourceInvOrgName: l.yard }] });
  }
  if (req.method === 'GET' && p.endsWith('/serial-refs')) {
    const l = ALL.filter((x) => x.master === Number(q.get('equipmentId')))[0];
    return res.json({ data: l && l.loc ? [{ id: l.id, currentSubinventory: l.sub, currentLocator: l.loc }] : [] });
  }
  if (req.method === 'PATCH' && /\/equipment-requests\/\d+\/lines\/batch$/.test(p)) {
    req.json().lines.forEach((l) => { status[l.id] = l.lineStatus; });
    return res.json({ data: [] });
  }
  if (req.method === 'GET' && (m = /\/equipment-requests\/(\d+)$/.exec(p))) {
    return res.json({ id: Number(m[1]), requestNumber: (reqOf(Number(m[1])) || {}).requestNumber, deliveryLocationType: 'SITE' });
  }
  return undefined;
}

// A stand-in for jsPDF (the CDN is not reachable here): records the slip's text so the test can read it.
const FAKE_JSPDF = 'define([], function () {'
  + ' function D() { this.t = []; window.__slipText = this.t; }'
  + " ['setFont', 'setFontSize', 'setTextColor', 'setDrawColor', 'setLineWidth', 'line', 'addPage'].forEach(function (m) { D.prototype[m] = function () { return this; }; });"
  + ' D.prototype.text = function (s) { this.t.push([].concat(s).join(" ")); return this; };'
  + ' D.prototype.splitTextToSize = function (s) { return [String(s)]; };'
  + " D.prototype.output = function () { return 'data:application/pdf;base64,' + btoa('%PDF-1.4 fake'); };"
  + ' return { jsPDF: D }; });';

// A phone's camera and buzzer, for the test: the camera is a canvas stream; whichever tag reader unitScanner picks (the
// browser's BarcodeDetector, or ZXing) reads the next value the test puts in window.__scanQueue. Buzzes are recorded.
function fakePhone() {
  window.__scanQueue = [];
  window.__vibes = [];
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__vibes.push(p); return true; } });
  const next = () => window.__scanQueue.shift();
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ['code_128', 'qr_code']; }
    async detect() { const v = next(); return v ? [{ rawValue: v }] : []; }
  };
  window.ZXing = { BrowserMultiFormatReader: class {
    decodeFromVideoElementContinuously(video, cb) { this.t = setInterval(() => { const v = next(); if (v) cb({ getText: () => v }); }, 150); }
    reset() { clearInterval(this.t); }
  } };
  if (navigator.mediaDevices) {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      const g = c.getContext('2d');
      let i = 0;
      setInterval(() => { g.fillStyle = (i++ % 2) ? '#334155' : '#475569'; g.fillRect(0, 0, 320, 240); }, 80);
      return c.captureStream(12);
    } });
  }
}

const settle = (page, ms) => page.waitForTimeout(ms || 350);
const shown = (sel) => `${sel}:visible`;
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const short = (w) => `${w.method} ${w.path.replace(V1, '')}`;
const current = (page) => page.$eval('#mbTabbar .mb-tabbtn--on', (b) => b.dataset.tab).catch(() => '');
const sections = (page) => page.$$eval('#mbPick .mb-pick-sec', (s) => s.filter((x) => x.offsetParent)
  .map((x) => x.dataset.section + ':' + [...x.querySelectorAll('.mb-pick-card')].map((c) => c.dataset.number).join('+')).join(' '));
const cards = (page) => page.$$eval('#mbPick .mb-pick-card', (b) => b.filter((x) => x.offsetParent).map((x) => x.dataset.number).join(','));
const groups = (page) => page.$$eval('#mbPick .mb-pick-group[data-group]', (g) => g.map((x) => x.dataset.group + ':' + x.querySelectorAll('.mb-pick-piece').length).join(','));
const ticked = (page) => page.$$eval('#mbPick .mb-pick-piece--on', (b) => b.map((x) => x.dataset.lineId).sort().join(','));
const toastSays = (page, re) => page.waitForFunction((src) => new RegExp(src).test((document.querySelector('#mbToast .mb-toast-text') || {}).textContent || ''),
  re.source, { timeout: 20000 });
const scanSays = (page, re) => page.waitForFunction((src) => new RegExp(src).test((document.querySelector('#pkScanResult') || {}).textContent || ''),
  re.source, { timeout: 15000 });
// A sheet as a person sees it: the phone's screen, once the sheet has slid up (a full-page shot smears fixed layers).
async function view(page, name) {
  await settle(page, 400);
  const f = path.join(os.tmpdir(), 'equiprite-e2e', name);
  await page.screenshot({ path: f });
  return f;
}

async function openList(env) {
  await env.page.waitForSelector(shown('#mbPick .mb-pick-card'), { timeout: 30000 });
  // The yards come in after the list: the yard button shows once two are known.
  await env.page.waitForSelector(shown('#pkYard'), { timeout: 20000 });
  await settle(env.page, 400);
}

async function openRequest(page, number) {
  await page.click(`#mbPick .mb-pick-card[data-number="${number}"]`);
  await page.waitForFunction((n) => { const h = document.querySelector('#pkNumber'); return h && h.offsetParent && h.textContent.trim() === n; }, number, { timeout: 15000 });
  await page.waitForSelector(shown('#mbPick .mb-pick-group'), { timeout: 20000 });
  await settle(page, 300);
}

async function readOnlyRun() {
  T.section('read-only (Initiate picking READ_ONLY): everything visible, nothing that writes');
  reset();
  const env = await E.start({ port: 20610, app: 'mobile', handle, access: { EQR_INITIATE_PICKING: 'READ_ONLY' }, flags, sessionRole: 'REQUESTOR' });
  const { page } = env;
  try {
    await page.addInitScript(fakePhone);
    await env.open('/');
    await openList(env);
    T.eq('the tabs: Pick and Me', await page.$$eval('#mbTabbar .mb-tabbtn', (b) => b.map((x) => x.dataset.tab).join()), 'pick,me');
    T.eq('today\'s work is all there', await sections(page), 'late:REQ-2003 today:REQ-2007 week:REQ-2011');
    T.eq('scanning finds, it does not tick', await env.text('#pkScanList'), 'Find a unit');
    await openRequest(page, 'REQ-2003');
    T.check('it says so', /can see the yard’s work here but not change it/.test(await env.text('#pkReadOnly')));
    T.check('no step offered: no dock, no Release or Ship, no next-piece button, no Tick all',
      !(await page.$('#pkDock')) && !(await page.$('#pkRelease')) && !(await page.$('#pkShip')) && !(await page.$('#pkNextPicked')) && !(await page.$('#mbPick .mb-pick-link[data-group]')));
    T.eq('the pieces cannot be ticked', await page.$$eval('#mbPick .mb-pick-piece', (b) => b.every((x) => x.disabled)), true);
    T.eq('their steps and where they are, still', await groups(page), 'release:1,pick:2,fusion:1,shipped:1');
    T.check('no hint to tick anything', !/tick/i.test(await page.$$eval('#mbPick .mb-pick-group-hint', (h) => h.map((x) => x.textContent).join(' '))));
    await page.click('#pkFind');
    await page.waitForSelector(shown('#pkScanSheet'), { timeout: 10000 });
    await page.fill('#pkUnit', 'dt-3001');
    await page.click('#pkUnitGo');
    await scanSays(page, /Volvo A30 Dump Truck · DT-3001/);
    T.check('a unit is found on the request, in words', /On this request: Waiting to be picked\. Houston Yard · Available · A-03-01/.test(await env.text('#pkScanResult')),
      await env.text('#pkScanResult'));
    T.eq('the scan sheet says Find (and how far the request is)', await env.text('#pkScanTitle'), 'Find a unit 1 of 5 picked');
    T.eq('no sideways scroll', await sideways(page), false);
    await view(page, 'mobile-pick-readonly-find.png');
    await page.click('#pkScanDone');
    await settle(page);
    await env.shot('mobile-pick-readonly.png');
    T.eq('nothing written', env.writes.map(short).join(), '');
    T.eq('read-only: no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('read-only run finished', false, e && e.stack);
    await env.shot('mobile-pick-readonly-failure.png').catch(() => {});
  } finally {
    await env.close();
  }
}

(async () => {
  await readOnlyRun();
  reset();
  const env = await E.start({ port: 20600, app: 'mobile', handle, access: { EQR_INITIATE_PICKING: 'FULL', EQR_EQUIPMENT_REQUESTS: 'READ_ONLY' }, flags });
  const { page } = env;
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/jspdf/**', (route) => route.fulfill({ contentType: 'application/javascript', body: FAKE_JSPDF }));
  await page.addInitScript(fakePhone);
  try {
    T.section('today\'s work, for a picker');
    await env.open('/');
    await openList(env);
    T.eq('the picker\'s tabs, opening on Pick', [await page.$$eval('#mbTabbar .mb-tabbtn', (b) => b.map((x) => x.dataset.tab).join()), await current(page)].join(' '),
      'pick,track,me pick');
    T.check('Next\'s queue: the INITIATE stage', env.calls.some((c) => c.includes('/views/workbench-requests?') && c.includes('stage=INITIATE') && c.includes('size=1000')));
    T.eq('in sections by the day it must ship, late first', await sections(page), 'late:REQ-2003 today:REQ-2007 week:REQ-2011');
    T.eq('the band says what is left (in the last 3 days)', await env.text('#pkSummary'), '7 pieces to get out on 3 requests in the last 3 days · 4 late · 2 needed today');
    const late = await env.text('#mbPick .mb-pick-card[data-number="REQ-2003"]');
    T.check('a card: request, how late, project and site, how many picked, the next step, the yard',
      late.includes('REQ-2003') && late.includes('2 days late') && late.includes('EPC_MO_Operations') && late.includes('to Moss Landing site')
      && late.includes('1 of 5 pieces picked') && late.includes('2 to pick · 2 being picked · 1 shipped') && late.includes('Release 2 pieces for picking') && late.includes('In New EquipRite') && late.includes('From Houston Yard'), late);
    T.eq('a ring per request: picked of all', await env.text('#mbPick .mb-pick-card[data-number="REQ-2003"] .mb-pick-ring'), '1/5');
    T.check('the ring is drawn', /conic-gradient/.test(await page.$eval('#mbPick .mb-pick-card[data-number="REQ-2003"] .mb-pick-ring', (e) => e.style.backgroundImage)));
    T.eq('no sideways scroll', await sideways(page), false);
    await env.shot('mobile-pick-list.png');

    T.section('the yard: chosen once, remembered on this phone');
    await page.click('#pkYard');
    await page.waitForSelector(shown('#pkYardSheet'), { timeout: 10000 });
    T.eq('the yards the work ships from', await page.$$eval('#pkYardSheet .mb-pick-option', (o) => o.map((x) => x.dataset.value).join()), 'all,Atlanta Yard,Houston Yard');
    await view(page, 'mobile-pick-yard.png');
    await page.click('#pkYardSheet .mb-pick-option[data-value="Houston Yard"]');
    await page.waitForSelector('#pkYardSheet', { state: 'detached', timeout: 10000 });
    await settle(page);
    T.eq('Houston\'s work only', await sections(page), 'late:REQ-2003 week:REQ-2011');
    await env.open('/');
    await openList(env);
    T.eq('opened again: still Houston Yard', [await env.text('#pkYardName'), await sections(page)].join(' | '), 'Houston Yard | late:REQ-2003 week:REQ-2011');
    await page.click('#pkYard');
    await page.click('#pkYardSheet .mb-pick-option[data-value="all"]');
    await settle(page);
    await page.fill('#pkSearch', 'trencher');
    await settle(page);
    T.eq('search reaches the equipment', await cards(page), 'REQ-2007');
    await page.fill('#pkSearch', '');
    await page.click('#pkChips .mb-chip[data-value="late"]');
    await settle(page);
    T.eq('a chip: late pieces only', await cards(page), 'REQ-2003');
    await page.click('#pkChips .mb-chip[data-value="late"]');
    await settle(page);
    T.eq('again: everything', await cards(page), 'REQ-2003,REQ-2007,REQ-2011');

    T.section('the list opens on the last 3 days');
    T.eq('the period it opens on', [await env.text('#pkRecent'), await page.$eval('#pkRecent', (b) => b.getAttribute('aria-pressed'))].join(' '), 'Last 3 days true');
    T.eq('under the list, the older request it leaves out', await env.text('#pkOlder'), '1 older request · Show all');
    T.eq('the chips count the last 3 days', await env.text('#pkChips .mb-chip[data-value="all"]'), 'All 3');
    await env.shot('mobile-pick-recent.png');
    await page.click('#pkOlder');
    await settle(page);
    T.eq('Show all: every date, late first', await sections(page), 'late:REQ-1990+REQ-2003 today:REQ-2007 week:REQ-2011');
    T.eq('…the chips and the band follow', [await env.text('#pkChips .mb-chip[data-value="all"]'), await env.text('#pkSummary')].join(' | '),
      'All 4 | 8 pieces to get out on 4 requests · 5 late · 2 needed today');
    T.eq('…nothing left out, All is on', [!!(await page.$('#pkOlder')), await page.$eval('#pkAllDates', (b) => b.getAttribute('aria-pressed'))].join(), 'false,true');
    await page.click('#pkRecent');
    await settle(page);
    T.eq('the last 3 days again', await cards(page), 'REQ-2003,REQ-2007,REQ-2011');
    await page.fill('#pkSearch', 'crusher');
    await settle(page);
    T.eq('a search looks through every date, saying so', [await cards(page), await env.text('#pkSearching')].join(' | '), 'REQ-1990 | Searching all dates');
    await page.fill('#pkSearch', '');
    await settle(page);
    T.eq('search cleared: the last 3 days', [await cards(page), !!(await page.$('#pkSearching'))].join(' | '), 'REQ-2003,REQ-2007,REQ-2011 | false');
    T.eq('no sideways scroll', await sideways(page), false);

    T.section('scan first: a tag scanned on the list opens its request, ticked');
    env.writes.length = 0;
    await page.click('#pkScanList');
    await page.waitForSelector('#pkScanSheet .mb-pick-view--on', { timeout: 15000 });
    await page.evaluate(() => window.__scanQueue.push('LT-0042'));
    await scanSays(page, /Picked: Light tower · LT-0042/);
    T.eq('the request it is on opened', await env.text('#pkNumber'), 'REQ-2003');
    T.eq('a buzz on the match', JSON.stringify(await page.evaluate(() => window.__vibes)), '[45]');
    T.check('the sheet counts the picking', /2 of 5 picked/.test(await env.text('#pkScanCount')), await env.text('#pkScanCount'));
    await page.evaluate(() => window.__scanQueue.push('TR-0450'));
    await scanSays(page, /TR-0450 is not on REQ-2003/);
    T.check('a unit of another request: says which, ticks nothing, buzzes twice', /It is on REQ-2007 \(Pipeline North\)\. Nothing was ticked\./.test(await env.text('#pkScanResult'))
      && JSON.stringify(await page.evaluate(() => window.__vibes)) === '[45,[90,60,90]]', await env.text('#pkScanResult'));
    await view(page, 'mobile-pick-scan.png');
    await page.fill('#pkUnit', 'gn-0412');
    await page.press('#pkUnit', 'Enter');
    await scanSays(page, /Picked: Generator 100 kVA · GN-0412/);
    T.eq('typed (a tag reader types too): ticked', await page.inputValue('#pkUnit'), '');
    await page.fill('#pkUnit', 'CB-0003');
    await page.click('#pkUnitGo');
    await scanSays(page, /already shipped/);
    T.check('a shipped unit: said, nothing ticked', true);
    await page.click('#pkScanDone');
    await page.waitForSelector('#pkScanSheet', { state: 'detached', timeout: 10000 });
    T.eq('the camera is off once the sheet closes', await page.evaluate(() => !window.__mbPickScanStream), true);
    T.eq('nothing written while ticking', env.writes.length, 0);

    T.section('a request\'s pick list');
    T.eq('by step: release here, being picked, waiting for Fusion, shipped', await groups(page), 'release:1,pick:2,fusion:1,shipped:1');
    T.eq('being picked in walking order (A-12-04 before B-2-01)', await page.$$eval('#mbPick .mb-pick-group[data-group="pick"] .mb-pick-unit', (u) => u.map((x) => x.textContent.trim()).join()),
      'LT-0042,GN-0412');
    T.eq('what was scanned is ticked', await ticked(page), '5003,5004');
    T.check('where to pick it: yard, subinventory, locator', (await env.text('#mbPick .mb-pick-piece[data-line-id="5004"]')).includes('Houston Yard · Available · A-12-04'));
    T.eq('how far it is', await env.text('#pkProgress'), '3 of 5 picked');
    T.check('the stock piece waits for its transfer order in Fusion: shown, done in New', (await env.text('#pkFusion')).includes('1 piece on transfer order TO-880101 waits for release.')
      && (await page.getAttribute('#pkReleaseInNew', 'href')) === env.newUrl + '/vp/shell/logistics/picking');
    T.check('also on the request: the line not in picking', /Fuel bowser[\s\S]*Not sent yet/.test(await env.text('#pkOther')));
    T.eq('every piece being picked is ticked: Ship, in green', [await env.text('#pkShip'), await page.$eval('#pkShip', (b) => b.classList.contains('mb-btn--ok'))].join(' '),
      'Ship 2 pieces true');
    T.eq('no sideways scroll', await sideways(page), false);
    await env.shot('mobile-pick-work.png');

    T.section('Release a fixed asset (EquipRite only): the sheet first, then Next\'s call');
    await page.click('#mbPick .mb-pick-piece[data-line-id="5002"]');
    await settle(page, 250);
    T.eq('ticked to release: Release is the step', await env.text('#pkRelease'), 'Release 1 piece');
    await page.click('#pkRelease');
    await page.waitForSelector(shown('#pkSheet'), { timeout: 10000 });
    T.eq('it says what will happen', await env.text('#pkSheetTitle'), 'Release 1 fixed-asset piece of REQ-2003 for picking');
    T.eq('nothing sent yet', env.writes.length, 0);
    await page.click('#pkReleaseGo');
    await toastSays(page, /1 piece of REQ-2003 released for picking\./);
    await settle(page, 400);
    T.eq('calls: the line batch only (no Fusion release)', env.writes.map(short).join(' > '), 'PATCH /equipment-requests/2003/lines/batch');
    T.eq('only the ticked fixed asset moves to Pick initiated', JSON.stringify(env.writes[0].body), JSON.stringify({ lines: [{ id: 5002, lineStatus: 'PICK_INITIATED' }] }));
    T.eq('the stock piece still waits', status[5001], 'SCHEDULED_FOR_PICKING');
    T.eq('the released piece is being picked, ready to be ticked when picked', await groups(page), 'pick:3,fusion:1,shipped:1');
    T.eq('the next piece to fetch', [await env.text('#pkNext .mb-pick-unit'), await env.text('#pkNext .mb-pick-spot')].join(' @ '), 'RL-1002 @ Houston Yard · Available · B-10-02');
    await page.click('#pkNextPicked');
    await settle(page, 250);
    T.eq('Picked: ticked', [await ticked(page), await env.text('#pkProgress')].join(' | '), '5002,5003,5004 | 4 of 5 picked');

    T.section('Ship: the sheet says what will happen, then Next\'s calls');
    await page.click('#pkShip');
    await page.waitForSelector(shown('#pkSheet'), { timeout: 10000 });
    T.eq('Ship 3 pieces of REQ-2003 to EPC_MO_Operations', await env.text('#pkSheetTitle'), 'Ship 3 pieces of REQ-2003 to EPC_MO_Operations');
    T.check('where to, and every piece ticked', (await env.text('#pkSheet')).includes('Deliver to Moss Landing site') && !(await page.$('#pkUnticked'))
      && (await page.$$eval('#pkSheetList li', (l) => l.length)) === 3);
    await view(page, 'mobile-pick-ship.png');
    env.writes.length = 0;
    const before = env.calls.length;
    await page.click('#pkShipGo');
    await toastSays(page, /3 pieces of REQ-2003 shipped to EPC_MO_Operations\./);
    await page.waitForSelector(shown('#pkSummary'), { timeout: 15000 });
    await settle(page, 500);
    T.eq('calls: the ship batch only', env.writes.map(short).join(' > '), 'PATCH /equipment-requests/2003/lines/batch');
    T.eq('the picked pieces ship to site', JSON.stringify(env.writes[0].body), JSON.stringify({ lines: [5002, 5003, 5004].map((id) => ({ id, lineStatus: 'SHIP_TO_SITE' })) }));
    const after = env.calls.slice(before);
    T.check('it read the live statuses first', after.findIndex((c) => c.startsWith('GET ' + V1 + '/equipment-requests/2003/lines')) < after.findIndex((c) => c.startsWith('PATCH')));
    T.check('back on the list, the card follows', (await env.text('#mbPick .mb-pick-card[data-number="REQ-2003"]')).includes('4 of 5 pieces picked'),
      await env.text('#mbPick .mb-pick-card[data-number="REQ-2003"]'));
    T.eq('the Pick tab counts what is left (of the last 3 days: not REQ-1990\'s)', await env.text('.mb-tabbtn[data-tab="pick"] .mb-tabbadge'), '4');

    T.section('the pick slip (Next\'s): share or download');
    await openRequest(page, 'REQ-2003');
    await page.click('#pkSlipMake');
    await page.waitForSelector(shown('#pkSlip'), { timeout: 15000 });
    T.check('made: its number, the released pieces in walking order', (await env.text('#pkSlipDoc')).startsWith('PS-REQ-2003-') && (await env.text('#pkSlipRows')) === '4 lines, in walking order');
    const slipText = await page.evaluate(() => (window.__slipText || []).join(' | '));
    T.check('the released pieces with their locators, not the unreleased one', slipText.includes('Light tower') && slipText.includes('A-12-04') && !slipText.includes('Volvo A30'),
      slipText.slice(0, 200));
    await view(page, 'mobile-pick-slip.png');
    const file = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#pkSlipDownload')]).then(([d]) => d.suggestedFilename());
    T.eq('it downloads as a PDF', file, 'pick-slip-REQ-2003.pdf');
    await page.click('#pkSlip .mb-iconbtn');
    await page.click('#pkBack');
    await page.waitForSelector(shown('#pkSummary'), { timeout: 10000 });

    T.section('a transfer order\'s pieces: one ticked order ships whole');
    await openRequest(page, 'REQ-2007');
    T.check('a damaged unit is an exception, with where to re-allocate it', (await env.text('#pkExc')).includes('Serial EX-2207 is DAMAGED'));
    T.eq('nothing ticked: no step, a hint', await env.text('#pkHint'), 'Tick the pieces as you pick them');
    await page.click('#mbPick .mb-pick-piece[data-line-id="7101"]');
    await settle(page, 250);
    T.eq('the trencher ticked: its released order ships', await env.text('#pkShip'), 'Ship 1 piece');
    await page.click('#mbPick .mb-pick-piece[data-line-id="7101"]');
    await settle(page, 250);

    T.section('no connection: ticks kept on the phone, nothing sent');
    const errorsBefore = env.errors.length;
    env.writes.length = 0;
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('#mbOffline', { timeout: 10000 });
    await page.waitForSelector(shown('#pkOffline'), { timeout: 10000 });
    await page.click('#mbPick .mb-pick-piece[data-line-id="7101"]');
    await settle(page, 250);
    T.eq('ticked with no connection', await ticked(page), '7101');
    await page.click('#pkShip');
    await page.waitForSelector(shown('#pkSheetOffline'), { timeout: 10000 });
    await page.click('#pkShipGo');
    await toastSays(page, /No connection: nothing was sent\./);
    T.eq('nothing sent', env.writes.length, 0);
    await page.click('#pkSheet .mb-iconbtn');
    await page.click('#pkBack');
    await page.waitForSelector(shown('#pkSummary'), { timeout: 10000 });
    await page.click('#pkRefresh');
    await page.waitForSelector(shown('#pkSaved'), { timeout: 20000 });
    T.check('the list this phone saved, saying when', /Saved on this phone at \d\d:\d\d/.test(await env.text('#pkSaved')), await env.text('#pkSaved'));
    T.eq('what waits to be sent', await env.text('#mbPick .mb-pick-pending .mb-pick-pending-text'), 'REQ-2007: 1 piece ticked with no connection, kept on this phone');
    T.check('the card says so', (await env.text('#mbPick .mb-pick-card[data-number="REQ-2007"]')).includes('1 piece ticked on this phone, not yet sent'));
    T.eq('no sideways scroll', await sideways(page), false);
    await env.shot('mobile-pick-offline.png');
    await page.click('#mbPick .mb-pick-pending');
    await page.waitForSelector(shown('#pkWorkSaved'), { timeout: 15000 });
    T.check('its pick list from the phone, saying when', /No connection\. Saved on this phone at \d\d:\d\d/.test(await env.text('#pkWorkSaved')));
    T.eq('the tick kept', await ticked(page), '7101');

    T.section('back online: sent only when confirmed');
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => /Back online\. 1 piece ticked with no connection is kept on this phone: nothing was sent/.test((document.querySelector('#pkBanner') || {}).textContent || ''),
      null, { timeout: 20000 });
    T.check('read again from the server (no saved copy shown)', !(await page.$('#pkWorkSaved')));
    T.eq('nothing sent on its own', env.writes.length, 0);
    await env.shot('mobile-pick-back-online.png');
    await page.click('#pkShip');
    await page.waitForSelector(shown('#pkSheet'), { timeout: 10000 });
    T.eq('the sheet says what will happen', await env.text('#pkSheetTitle'), 'Ship 1 piece of REQ-2007 to Pipeline North');
    await page.click('#pkShipGo');
    await toastSays(page, /1 piece of REQ-2007 shipped to Pipeline North\./);
    T.eq('then sent: the ticked order\'s piece', [env.writes.map(short).join(), JSON.stringify(env.writes[0] && env.writes[0].body)].join(' '),
      'PATCH /equipment-requests/2007/lines/batch ' + JSON.stringify({ lines: [{ id: 7101, lineStatus: 'SHIP_TO_SITE' }] }));
    await page.waitForSelector(shown('#pkSummary'), { timeout: 10000 });
    await settle(page, 400);
    T.check('nothing waits any more', !(await page.$('#mbPick .mb-pick-pending')));
    // Offline, the calls fail (and say so in the console); nothing the app needs may fail to load.
    const offlineErrors = env.errors.splice(errorsBefore);
    T.eq('offline: no part of the app failed to load', offlineErrors.filter((e) => /Script error|does not exist|pageerror|Failed to load chain/i.test(e)).join(' | '), '');

    T.section('focus: from My requests, and a deep link');
    await page.click('.mb-tabbtn[data-tab="track"]');
    await page.waitForSelector(shown('#trList .mb-item[data-number="REQ-2003"]'), { timeout: 20000 });
    await page.click('#trList .mb-item[data-number="REQ-2003"]');
    await page.waitForSelector(shown('#trPick'), { timeout: 15000 });
    await page.click('#trPick');
    await page.waitForFunction(() => { const h = document.querySelector('#pkNumber'); return h && h.offsetParent && h.textContent.trim() === 'REQ-2003'; }, null, { timeout: 15000 });
    T.eq('My requests\' Pick opens this tab on the request', await current(page), 'pick');
    await env.open('/?tab=pick&number=REQ-2011');
    await page.waitForFunction(() => { const h = document.querySelector('#pkNumber'); return h && h.offsetParent && h.textContent.trim() === 'REQ-2011'; }, null, { timeout: 30000 });
    await settle(page, 400);
    T.check('?tab=pick&number= opens the request', /Gulf Coast Builders/.test(await env.text('#pkWork')));
    T.check('the inspected crane is shipped from Fusion: on the request, not a step here', /Crawler crane 80t[\s\S]*Inspected, ready to ship/.test(await env.text('#pkOther')));
    await env.open('/?tab=pick&number=REQ-1990');
    await page.waitForFunction(() => { const h = document.querySelector('#pkNumber'); return h && h.offsetParent && h.textContent.trim() === 'REQ-1990'; }, null, { timeout: 30000 });
    await page.waitForSelector(shown('#mbPick .mb-pick-group'), { timeout: 20000 });
    T.check('a deep link to an older request still opens it', /Old Quarry/.test(await env.text('#pkWork')), await env.text('#pkWork'));
    await page.click('#pkBack');
    await page.waitForSelector(shown('#pkSummary'), { timeout: 10000 });
    await settle(page);
    T.eq('…and the list behind it shows every date', [await page.$eval('#pkAllDates', (b) => b.getAttribute('aria-pressed')), /REQ-1990/.test(await cards(page))].join(), 'true,true');
    await env.open('/?tab=pick&number=REQ-9999');
    await toastSays(page, /REQ-9999 has nothing waiting at the yard to pick or ship\./);
    T.check('a request not waiting at the yard: said', true);
    T.eq('no sideways scroll', await sideways(page), false);

    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    console.log('browser errors:\n' + env.errors.join('\n'));
    console.log('last calls:\n' + env.calls.slice(-12).join('\n'));
    await env.shot('mobile-pick-failure.png').catch(() => {});
  } finally {
    console.log('\nscreenshots: ' + path.join(os.tmpdir(), 'equiprite-e2e'));
    await env.close();
    T.report();
  }
})();
