'use strict';
/*
 * EquipRite Next's toolbar in a real browser: the global search (screens, requests, equipment items, units,
 * transfers, grouped and best first; the scopes; ↑ ↓ Enter across the groups opening the right tab) and Check
 * availability (equipment, the window presets, the counts and yards, Open in Availability), the panels closing each
 * other, nothing read before first use, nothing written, no browser errors. Needs `npm run build`.
 * Run: node tests/e2e/next-search.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();

// Dates relative to today (the browser's calendar day).
const pad = (n) => (n < 10 ? '0' : '') + n;
const dayOf = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return dayOf(x); };
const iso = (n) => d(n) + 'T00:00:00Z';

const SERIALS = [
  { id: 1, serialNumber: 'EX-2201', equipmentId: 11, currentLocationId: 501, faAssetRefId: '100482' },
  { id: 2, serialNumber: 'EX-2203', equipmentId: 11, currentLocationId: 501 },
  { id: 3, serialNumber: 'EX-2210', equipmentId: 12, currentLocationId: 502, maintenanceAssetNumber: 'MA-2210' },
  { id: 4, serialNumber: 'EX-2211', equipmentId: 12, currentLocationId: 502 },
  { id: 5, serialNumber: 'EX-2212', equipmentId: 12, currentLocationId: 501 },
  { id: 6, serialNumber: 'MC-07', equipmentId: 21, currentLocationId: 502 },
];
for (let i = 1; i <= 20; i++) SERIALS.push({ id: 100 + i, serialNumber: 'GEN-' + (1000 + i), equipmentId: 31, currentLocationId: 501 });
const MASTERS = [
  { id: 11, equipmentName: 'CAT 320 Excavator', equipmentNumber: 'EQ-0011', equipmentClassId: 1, manufacturer: 'Caterpillar' },
  { id: 12, equipmentName: 'PC210 Excavator', equipmentNumber: 'EQ-0012', equipmentClassId: 1, manufacturer: 'Komatsu' },
  { id: 21, equipmentName: 'Mobile Crane 50t', equipmentNumber: 'EQ-0021', equipmentClassId: 2 },
  { id: 31, equipmentName: 'Generator 100kVA', equipmentNumber: 'EQ-0031', equipmentClassId: 3 },
];
const CLASSES = [{ id: 1, className: 'Excavators' }, { id: 2, className: 'Cranes' }, { id: 3, className: 'Generators' }];
const LOCATIONS = { 501: { id: 501, locationName: 'Houston Yard', locationCode: 'HOU-Y1' }, 502: { id: 502, locationName: 'Odessa', locationCode: 'ODS-Y2' } };
const bk = (id, serial, req, reqId, project, alloc, from, to) => ({ eqrRequestLineId: id, eqrEquipmentRequestId: reqId, requestNumber: req, lineNumber: 1,
  projectName: project, allocatedSerial: serial, allocStatus: alloc, requestedStartDate: iso(from), requestedEndDate: iso(to) });
const LINES = [
  bk(9001, 'EX-2201', 'REQ-10511', 511, 'Pipeline North', 'ALLOCATED', -5, 3),
  bk(9002, 'EX-2203', 'REQ-10530', 530, 'Plant Expansion B', 'ALLOCATED', 2, 20),
  bk(9003, 'EX-2211', 'REQ-10540', 540, 'Pipeline North', 'PENDING', 9, 12),
  bk(9004, 'MC-07', 'REQ-10498', 498, 'Harbour Wall', 'ALLOCATED', -20, 30),
];
const REQS = [
  { eqrEquipmentRequestId: 1765, requestNumber: 'REQ-1765', status: 'SUBMITTED', startDate: d(6), endDate: d(30), projectName: 'Plant B', requestOrigin: 'Internal' },
  { eqrEquipmentRequestId: 1764, requestNumber: 'REQ-1764', status: 'IN_PROCESS', startDate: d(-22), endDate: d(0), projectName: 'EPC_MO_Operations',
    requestOrigin: 'Internal', requestorName: 'Pat Lee', taskName: 'Earthworks' },
  { eqrEquipmentRequestId: 511, requestNumber: 'REQ-10511', status: 'IN_PROCESS', startDate: d(-5), endDate: d(3), projectName: 'Pipeline North', requestOrigin: 'Internal' },
];
const MY_LINES = [
  { requestNumber: 'REQ-1764', lineNumber: 1, equipmentName: 'Komatsu D65EX-18 Dozer', lineStatus: 'CLOSED' },
  { requestNumber: 'REQ-1764', lineNumber: 2, equipmentName: 'Bobcat S76', lineStatus: 'IN_PROCESS', allocationStatus: 'PENDING' },
  { requestNumber: 'REQ-10511', lineNumber: 1, equipmentName: 'CAT 320 Excavator', className: 'Excavators', lineStatus: 'DEPLOYED', allocatedSerial: 'EX-2201' },
];
const ORDERS = [
  { id: 310, orderNumber: 'TO-310', orderType: 'OUTBOUND', orderStatus: 'PENDING', equipmentRequestId: 511, sourceOrgId: 300, destinationOrgId: 400, needByDate: d(1), createdDate: d(-6) },
  { id: 311, orderNumber: 'TO-311', orderType: 'INBOUND', orderStatus: 'PENDING', equipmentRequestId: 1764, sourceOrgId: 400, destinationOrgId: 300, createdDate: d(-1) },
];
const WORK_ORDERS = { 'MA-2210': [{ WorkOrderNumber: 'WO-55821', WorkOrderType: 'Preventive', PlannedStartDate: iso(9), PlannedCompletionDate: iso(11) }] };

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/serial-refs')) return res.json({ data: SERIALS, hasMore: false });
  if (p.endsWith('/equipment-classes')) return res.json({ data: CLASSES, hasMore: false });
  if (p.endsWith('/views/workbench-lines')) return res.json({ data: LINES, hasMore: false });
  if (p.endsWith('/equipment-master')) return res.json({ data: MASTERS, recordCount: MASTERS.length, hasMore: false });
  if (p.endsWith('/views/my-requests')) return res.json({ data: REQS });
  if (p.endsWith('/views/my-request-lines')) return res.json({ data: MY_LINES });
  if (p.endsWith('/transfer-orders')) return res.json({ data: ORDERS });
  if (p.endsWith('/transfer-history')) return res.json({ data: [] });
  if (p.endsWith('/inv-orgs')) return res.json({ data: [{ organizationId: 300, organizationCode: 'HOU', organizationName: 'Houston Yard' }, { organizationId: 400, organizationCode: 'TXS', organizationName: 'Texas sites' }] });
  const loc = /\/locations\/(\d+)$/.exec(p);
  if (loc) return LOCATIONS[loc[1]] ? res.json(LOCATIONS[loc[1]]) : res.json({ message: 'not found' }, 404);
  const q = req.query.get('q') || '';
  if (p.endsWith('/installedBaseAssets')) return res.json({ items: /MA-2210/.test(q) ? [{ AssetId: 300100, OperatingOrganizationCode: 'HOU' }] : [] });
  if (p.endsWith('/maintenanceWorkOrders')) {
    const asset = (/AssetNumber='([^']+)'/.exec(q) || [])[1];
    return res.json({ items: (asset && WORK_ORDERS[asset]) || [] });
  }
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19460, handle, app: 'next' });
  const { page } = env;
  const settle = (ms) => page.waitForTimeout(ms || 250);
  const heads = () => page.$$eval('#nxResults .nx-gs-head-label', (h) => h.map((x) => x.textContent.trim()).join(','));
  const labels = () => page.$$eval('#nxResults .nx-gs-row--row .nx-result-label', (l) => l.map((x) => x.innerText.trim()).join(','));
  const chosen = () => page.$eval('#nxResults .nx-result--on .nx-result-label', (e) => e.innerText.trim());
  const currentTab = () => page.$eval('.nx-tab--on', (t) => t.dataset.tabId);
  /** Types into the search box and waits until the list is for these words, and nothing is still being read. */
  async function search(text) {
    await page.fill('#nxCommand', '');
    await page.fill('#nxCommand', text);
    await page.waitForFunction(() => {
      const f = document.getElementById('nxResultsFoot');
      return f && !/Reading/.test(f.textContent) && document.querySelector('#nxResults .nx-gs-row, #nxResultsEmpty');
    }, null, { timeout: 15000 });
    await settle(150);
  }
  try {
    T.section('nothing is read before the search is used');
    await env.open('/');
    await page.waitForSelector('#page-home', { timeout: 30000 });
    await settle(800);
    T.check('the units and the transfers are not read on opening (My work reads what it reads)', !env.calls.some((c) => /serial-refs|transfer-orders|inv-orgs/.test(c)),
      env.calls.filter((c) => /serial-refs|transfer-orders|inv-orgs/.test(c)).join());
    T.eq('the placeholder', await page.getAttribute('#nxCommand', 'placeholder'), 'Search screens, requests, equipment, units…');
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'nxCommand');
    await settle(1200);
    T.check('Ctrl+K: the search reads what it looks in, in the background', env.calls.some((c) => c.includes('/serial-refs')) && env.calls.some((c) => c.includes('/transfer-orders')));
    T.check('... but no planned maintenance from Fusion (Check availability asks for that)', !env.calls.some((c) => /maintenanceWorkOrders|installedBaseAssets/.test(c)));

    T.section('typing finds a screen, a request, an equipment item, a unit, a transfer, grouped');
    await page.keyboard.type('excavator');
    await page.waitForSelector('#nxResults .nx-gs-head');
    await settle(300);
    T.eq('"excavator": Equipment, then Units, then Requests', await heads(), 'Equipment,Units,Requests');
    T.eq('... the class, the items, four of the units, the request with one on it', await labels(),
      'Excavators,CAT 320 Excavator,PC210 Excavator,EX-2201,EX-2203,EX-2210,EX-2211,REQ-10511');
    T.check('... "1 more unit"', /1 more unit/.test(await env.text('#nxResults')));
    T.eq('the scopes and their counts', await page.$$eval('.nx-gs-scope', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ').trim() + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' | ')),
      'Everything 9* | Screens 0 | Requests 1 | Equipment 8');
    T.check('the foot says what is searched', /Searching screens, 3 requests, 4 equipment items, 26 units and 2 transfers/.test(await env.text('#nxResultsFoot')), await env.text('#nxResultsFoot'));
    await env.shot('next-search-results.png');
    await search('rates');
    T.eq('"rates": the screen', await heads() + ' ' + await chosen(), 'Screens Rates');
    await search('1764');
    T.eq('"1764": Open request REQ-1764 first', await chosen(), 'Open request REQ-1764');
    await search('EX-2201');
    T.eq('"EX-2201": the unit first, then the request it is on', await heads() + ' | ' + await labels(), 'Units,Requests | EX-2201,REQ-10511');
    await search('TO-310');
    T.eq('"TO-310": the transfer', await heads() + ' | ' + await chosen(), 'Transfers | TO-310');

    T.section('Enter and the arrow keys open the right tab, across the groups');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'transfer:310'; }, null, { timeout: 15000 });
    T.check('Enter on a transfer: its tab', true);
    T.eq('... the box is cleared and the list closed', [await page.inputValue('#nxCommand'), !!(await page.$('#nxResults'))].join(), ',false');
    await search('EX-2201');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'equipment-360:unit-EX-2201'; }, null, { timeout: 15000 });
    T.eq('Enter on a unit: everything about it (equipment-360)', await page.$eval('.nx-tab--on', (t) => t.innerText.trim()), 'EX-2201');
    await page.waitForFunction(() => /EX-2201/.test((document.querySelector('.nx-switcher') || {}).innerText || ''), null, { timeout: 15000 });
    await search('excavator');
    await page.keyboard.press('ArrowDown');
    await settle(120);
    T.eq('↓: the next row', await chosen(), 'CAT 320 Excavator');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'equipment-360:item-11'; }, null, { timeout: 15000 });
    T.eq('Enter on an equipment item: everything about it, all its units', await page.$eval('.nx-tab--on', (t) => t.innerText.trim()), 'CAT 320 Excavator');
    await search('1764');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'request:1764'; }, null, { timeout: 15000 });
    T.eq('Enter on a request: its tab, by its id', await page.$eval('.nx-tab--on', (t) => t.innerText.trim()), 'REQ-1764');
    await search('excavators');
    T.eq('"excavators": the class first', await chosen(), 'Excavators');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'availability'; }, null, { timeout: 15000 });
    T.check('Enter on a class: Availability, handed the class', true);
    await search('pipeline north');
    T.eq('"pipeline north": Requests, then Transfers', await heads(), 'Requests,Transfers');
    await page.keyboard.press('ArrowDown');
    await settle(120);
    T.eq('↓ moves from the Requests group into Transfers', await chosen(), 'TO-310');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await settle(120);
    T.eq('↑ past the top wraps to the last', await chosen(), 'TO-310');
    await page.keyboard.press('Escape');
    await settle(200);
    T.eq('Escape clears and closes', [await page.inputValue('#nxCommand'), !!(await page.$('#nxResults'))].join(), ',false');

    T.section('scopes, and "N more"');
    await search('gen');
    T.eq('"gen" under Everything: four units and "16 more units"', (await page.$$('#nxResults .nx-gs-row--row[data-key^="u:"]')).length + ' | '
      + await page.$eval('#nxResults .nx-gs-row--more .nx-result-label', (e) => e.innerText.trim()), '4 | 16 more units');
    await page.click('#nxResults .nx-gs-scope[data-scope="equipment"]');
    await settle(250);
    T.eq('Equipment: twelve units, and the box keeps the focus', (await page.$$('#nxResults .nx-gs-row--row[data-key^="u:"]')).length + ' | '
      + await page.evaluate(() => document.activeElement.id), '12 | nxCommand');
    await page.click('#nxResults .nx-gs-row--more');
    await settle(250);
    T.eq('"8 more units": all twenty', (await page.$$('#nxResults .nx-gs-row--row[data-key^="u:"]')).length, 20);
    await page.click('#nxResults .nx-gs-scope[data-scope="requests"]');
    await settle(250);
    T.eq('Requests: nothing called "gen", and it says so', await env.text('#nxResultsEmpty'), 'Nothing matches “gen” here: try Everything.');
    await page.click('#nxResults .nx-gs-scope[data-scope="all"]');
    await settle(250);
    T.eq('back to Everything', await heads(), 'Equipment,Units');
    await page.mouse.click(700, 600);
    await settle(250);
    T.check('a click outside closes the list', !(await page.$('#nxResults')));
    await page.click('#nxCommand');
    await settle(300);
    T.check('back in the box: the matches again', !!(await page.$('#nxResults .nx-gs-row')));
    await page.keyboard.press('Escape');

    T.section('Check availability');
    T.check('the button sits next to the QR code button', await page.evaluate(() => document.getElementById('nxQa').nextElementSibling.id === 'nxPhone'));
    await page.click('#nxQa');
    await page.waitForSelector('#nxQaPanel');
    await page.waitForSelector('#nxQaPanel .nx-qa-row', { timeout: 15000 });
    T.eq('it opens on today and the six days after', await page.inputValue('#nxQaFrom') + '..' + await page.inputValue('#nxQaTo'), d(0) + '..' + d(6));
    T.check('... seven days', /7 days$/.test(await env.text('#nxQaWin')), await env.text('#nxQaWin'));
    T.check('... the input has the focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'nxQaText'));
    T.check('every class, with its free count', /^All equipment: \d+ of 26 units free/.test(await env.text('#nxQaAnswer')), await env.text('#nxQaAnswer'));
    await page.waitForFunction(() => !/still loading/.test(document.getElementById('nxQaNote').textContent), null, { timeout: 15000 });
    T.check('planned maintenance is read from Fusion, for the units with a maintenance asset', env.calls.some((c) => c.includes('maintenanceWorkOrders') && decodeURIComponent(c).includes('MA-2210')));
    await page.keyboard.type('excav');
    await page.waitForSelector('#nxQaOptions .nx-qa-opt');
    T.eq('suggestions: the class, then the items', await page.$$eval('#nxQaOptions .nx-qa-opt-label', (o) => o.map((x) => x.textContent.trim()).join(',')), 'Excavators,CAT 320 Excavator,PC210 Excavator');
    T.eq('the answer at once: per item, how many are free', await page.$$eval('#nxQaPanel .nx-qa-row', (r) => r.map((x) => x.querySelector('.nx-qa-row-name').textContent.trim() + ' '
      + x.querySelector('.nx-qa-count').textContent.trim()).join(' | ')), 'PC210 Excavator 3 of 3 free | CAT 320 Excavator 0 of 2 free');
    T.eq('... per yard', await page.$eval('#nxQaPanel .nx-qa-row .nx-qa-yards', (e) => e.textContent.trim()), 'Odessa 2 · Houston Yard 1');
    T.check('... none free says so', /None free in your window/.test(await env.text('#nxQaPanel .nx-qa-row--none')));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('nxQaOptions'), null, { timeout: 5000 });
    T.eq('↓ ↓ Enter picks PC210', await page.inputValue('#nxQaText'), 'PC210 Excavator');
    T.eq('... its units one by one', await page.$$eval('.nx-qa-unit', (u) => u.map((x) => x.querySelector('.nx-qa-unit-serial').textContent.trim() + ' '
      + x.querySelector('.nx-qa-state').textContent.trim()).join(', ')), 'EX-2212 Free, EX-2210 Free, EX-2211 Free');
    await page.click('#nxQaPanel .nx-qa-presets button[data-key="two"]');
    await settle(250);
    T.eq('Two weeks: the window', await page.$eval('#nxQaPanel .nx-qa-presets button[aria-pressed="true"]', (b) => b.textContent.trim()) + ' | ' + await page.inputValue('#nxQaFrom') + '..' + await page.inputValue('#nxQaTo'),
      'Two weeks | ' + d(0) + '..' + d(13));
    T.eq('... the counts follow: one booked, one in maintenance', await env.text('#nxQaPanel .nx-qa-row .nx-qa-count') + ' | ' + await env.text('#nxQaPanel .nx-qa-row .nx-qa-notes'),
      '1 of 3 free | 1 booked · 1 in maintenance');
    T.check('... the maintenance, in words', /EX-2210: Maintenance WO-55821/.test(await env.text('#nxQaPanel .nx-qa-why--maint')));
    await page.click('#nxQaPanel .nx-qa-presets button[data-key="today"]');
    await settle(250);
    T.eq('Today', await page.inputValue('#nxQaFrom') + '..' + await page.inputValue('#nxQaTo') + ' | ' + await env.text('#nxQaPanel .nx-qa-row .nx-qa-count'), d(0) + '..' + d(0) + ' | 3 of 3 free');
    await page.fill('#nxQaTo', d(10));
    await page.dispatchEvent('#nxQaTo', 'change');
    await settle(250);
    T.eq('a date typed: no preset, the window follows', await page.$$eval('#nxQaPanel .nx-qa-presets button[aria-pressed="true"]', (b) => b.length), 0);
    T.check('... eleven days', /11 days$/.test(await env.text('#nxQaWin')), await env.text('#nxQaWin'));
    await env.shot('next-search-availability.png');
    T.eq('nothing written', env.writes.length, 0);
    await page.click('#nxQaPanel .nx-qa-row button[data-action="availability"]');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'availability'; }, null, { timeout: 15000 });
    T.check('Open in Availability: its tab, the panel closed', !(await page.$('#nxQaPanel')));
    await page.waitForSelector('.nx-av-row--unit', { timeout: 30000 });

    T.section('everything about it, from an answer');
    await page.click('#nxQa');
    await page.waitForSelector('#nxQaPanel .nx-qa-row');
    T.eq('opened again: what was asked is still there', await page.inputValue('#nxQaText'), 'PC210 Excavator');
    await page.click('#nxQaPanel .nx-qa-row button[data-action="open"]');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'equipment-360:item-12'; }, null, { timeout: 15000 });
    T.check('Everything about it: the equipment-360 tab', true);

    T.section('the panels close each other, Escape, a click outside');
    const press = (sel) => page.$eval(sel, (b) => b.click());
    await page.click('#nxQa');
    await page.waitForSelector('#nxQaPanel');
    await press('#nxPhone');
    await page.waitForSelector('#nxPhonePanel');
    T.check('the QR code closes it', !(await page.$('#nxQaPanel')));
    await press('#nxQa');
    await page.waitForSelector('#nxQaPanel');
    T.check('... and it closes the QR code', !(await page.$('#nxPhonePanel')));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#nxQaPanel', { state: 'detached', timeout: 5000 });
    T.check('Escape closes it', true);
    await page.click('#nxQa');
    await page.waitForSelector('#nxQaPanel');
    await page.mouse.click(300, 700);
    await page.waitForSelector('#nxQaPanel', { state: 'detached', timeout: 5000 });
    T.check('a click outside closes it', true);
    await page.click('#nxQa');
    await page.waitForSelector('#nxQaPanel');
    await press('#nxBell');
    await page.waitForSelector('#nxBellPanel');
    T.check('the bell closes it', !(await page.$('#nxQaPanel')));
    await page.keyboard.press('Escape');
    await page.click('#nxQa');
    await page.waitForSelector('#nxQaPanel');
    await press('#nxCart');
    await page.waitForSelector('#nxCartPanel');
    T.check('the cart closes it', !(await page.$('#nxQaPanel')));
    await page.keyboard.press('Escape');
    await page.click('#nxUser');
    await page.waitForSelector('#nxProfilePanel');
    await press('#nxQa');
    await page.waitForSelector('#nxQaPanel');
    T.check('it closes your menu', !(await page.$('#nxProfilePanel')));
    await page.keyboard.press('Escape');
    await page.click('#nxQa');
    await page.waitForSelector('#nxQaPanel');
    await page.click('#nxCommand', { force: true });
    await settle(250);
    T.check('a click on the search box (the backdrop) closes it', !(await page.$('#nxQaPanel')));

    T.section('narrow windows');
    for (const w of [1024, 390]) {
      await page.setViewportSize({ width: w, height: 844 });
      await settle(250);
      T.check(w + 'px: the toolbar fits, the button is there', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        && document.querySelector('.nx-top').scrollWidth <= document.querySelector('.nx-top').clientWidth + 1 && !!document.getElementById('nxQa').offsetWidth));
      await search('excavator');
      T.check(w + 'px: the list fits the window', await page.evaluate(() => { const r = document.getElementById('nxResults').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }));
      if (w === 390) {
        T.check('390px: in use, the search box spans the toolbar', await page.evaluate(() => document.querySelector('.nx-command').getBoundingClientRect().width > 330));
        await env.shot('next-search-phone-results.png');
      }
      await page.keyboard.press('Escape');
      await page.click('#nxQa');
      await page.waitForSelector('#nxQaPanel .nx-qa-row');
      T.check(w + 'px: the panel fits the window', await page.evaluate(() => { const r = document.getElementById('nxQaPanel').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }));
      if (w === 390) await env.shot('next-search-phone.png');
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('next-search-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
