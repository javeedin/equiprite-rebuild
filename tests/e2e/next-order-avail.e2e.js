'use strict';
/*
 * EquipRite Next, New request: "where is it, and when can I have it?" on a catalog card (the location icon), in a
 * real browser. An item with a unit free: how many, where (inventory org and yard), Add to cart. An item with none
 * free: where each unit is now and when it is back, other dates that work (Use these dates sets the request's dates
 * and the catalog follows), a shorter stretch, a free alternative in its class (Add instead); its full history and
 * Availability open in their tabs. Nothing is written. Needs `npm run build`. Run: node tests/e2e/next-order-avail.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const d = (n) => { const x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (n) => { const x = new Date(d(n) + 'T00:00:00'); return x.getDate() + ' ' + MON[x.getMonth()]; };

const ROWS = [
  { eqrEquipmentMasterId: 11, equipmentName: 'CAT 320 Excavator', className: 'Excavators', isRentable: true, rate: 1400, rateUom: 'DAY' },
  { eqrEquipmentMasterId: 12, equipmentName: 'Mini Excavator 3.5t', className: 'Excavators', isRentable: true, rate: 300, rateUom: 'DAY' },
];
const AVAIL = { 11: ['AVAILABLE', 1], 12: ['NOT AVAILABLE', 0] };
const SERIALS = {
  11: [{ id: 1, serialNumber: 'EX-1', equipmentId: 11, equipmentName: 'CAT 320 Excavator', currentLocationId: 10 }],
  12: [{ id: 2, serialNumber: 'MX-1', equipmentId: 12, equipmentName: 'Mini Excavator 3.5t', currentLocationId: 10 },
    { id: 3, serialNumber: 'MX-2', equipmentId: 12, equipmentName: 'Mini Excavator 3.5t', currentLocationId: 20 }],
};
const LINES = [
  { eqrRequestLineId: 1, requestNumber: 'REQ-3001', lineNumber: 1, allocatedSerial: 'MX-1', requestedStartDate: d(-5), requestedEndDate: d(10),
    allocationStatus: 'ALLOCATED', lineStatus: 'DEPLOYED', projectName: 'Pier B', equipmentName: 'Mini Excavator 3.5t', className: 'Excavators' },
  { eqrRequestLineId: 2, requestNumber: 'REQ-3002', lineNumber: 1, allocatedSerial: 'MX-2', requestedStartDate: d(4), requestedEndDate: d(20),
    allocationStatus: 'ALLOCATED', lineStatus: 'ALLOCATED', projectName: 'Gas Line', equipmentName: 'Mini Excavator 3.5t', className: 'Excavators' },
];
const LOCATIONS = { 10: { id: 10, locationCode: 'HOU', locationName: 'Houston Yard' }, 20: { id: 20, locationCode: 'ODE', locationName: 'Odessa Yard', orgId: 300 } };
const ORGS = [
  { invOrgId: 1, organizationId: 100, locationId: 10, locationCode: 'HOU', organizationCode: 'HOU1', organizationName: 'Houston Inventory' },
  { invOrgId: 3, organizationId: 300, locationId: 99, locationCode: 'X', organizationCode: 'ODE1', organizationName: 'Odessa Inventory' },
];

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  let m;
  if (p.endsWith('/views/equipment-catalog')) {
    const dated = q.get('startDate');
    return res.json({ data: ROWS.map((r) => Object.assign({}, r, dated ? { availabilityStatus: AVAIL[r.eqrEquipmentMasterId][0], availableQty: AVAIL[r.eqrEquipmentMasterId][1] } : {})) });
  }
  if (p === '/serial-refs') return res.json({ data: SERIALS[q.get('equipmentId')] || [], hasMore: false });
  if (p === '/views/workbench-lines') return res.json({ data: LINES, hasMore: false });
  if (p === '/inv-orgs') return res.json({ data: ORGS, hasMore: false });
  if ((m = /^\/locations\/(\d+)$/.exec(p))) return LOCATIONS[m[1]] ? res.json(LOCATIONS[m[1]]) : res.json({}, 404);
  if (p === '/views/my-requests' || p === '/views/my-request-lines') return res.json({ data: [] });
  return undefined;
}

const vis = (s) => s + ' >> visible=true';
async function setDate(page, sel, value) {
  await page.$eval(vis(sel), (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  await page.waitForTimeout(500);
}

(async () => {
  const env = await E.start({ port: 19480, handle, app: 'next', settings: { ENABLE_QUOTES: 'NONE' } });
  const { page } = env;
  try {
    await env.open('/?open=new-request');
    await page.waitForSelector(vis('.nx-or-card[data-id="12"]'), { timeout: 30000 });
    await setDate(page, '#orStart', d(2));
    await setDate(page, '#orEnd', d(13));
    await page.waitForFunction(() => /Not free/.test(document.querySelector('.nx-or-card[data-id="12"]').innerText), null, { timeout: 15000 });

    T.section('a card\'s location icon: none free');
    T.check('every card has it', (await page.$$(vis('.nx-or-card .nx-or-where'))).length === 2);
    await page.click(vis('.nx-or-card[data-id="12"] .nx-or-where'));
    await page.waitForSelector('#orAvailAnswer', { timeout: 15000 });
    T.eq('its name and the request\'s dates', [await env.text('#orAvailTitle'), (await env.text('#orAvail .nx-dialog-head .nx-sub')).startsWith('For ')].join(' | '), 'Mini Excavator 3.5t | true');
    T.check('the answer: none free', /0 of 2 units free/.test(await env.text('#orAvailAnswer')) && /None free for these dates/.test(await env.text('#orAvailAnswer')));
    T.eq('where its units are: inventory org and yard', await page.$$eval('#orAvailPlaces li', (l) => l.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'HOU1 · Houston Yard 0 of 1 free | ODE1 · Odessa Yard 0 of 1 free');
    const unit = (s) => env.text(`#orAvailUnits li[data-serial="${s}"]`);
    T.check('a unit out: on site, where, and when it is back', /On site · Pier B \(REQ-3001\)/.test(await unit('MX-1')) && (await unit('MX-1')).includes('Free again from ' + day(11)), await unit('MX-1'));
    T.check('a unit booked in the dates: at its yard now, back after', /now: At ODE · Odessa Yard/.test(await unit('MX-2')) && (await unit('MX-2')).includes('Free again from ' + day(21)), await unit('MX-2'));
    const slots = await page.$$eval('#orAvailSlots li', (l) => l.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    T.check('dates that work: after MX-1 is back, with its turnaround clear', slots.some((s) => /11 days later · 1 unit · HOU1 · Houston Yard/.test(s)), slots.join(' || '));
    T.check('a shorter stretch inside the dates', slots.some((s) => /^Shorter: .*3 of 12 days/.test(s)), slots.join(' || '));
    T.eq('free instead, in its class', await page.$$eval('#orAvailAlts li', (l) => l.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')), 'CAT 320 Excavator 1 free Add instead');
    T.check('nothing free: no Add to cart', !(await page.$('#orAvailAdd')));
    await env.shot('next-order-avail-none.png');

    T.section('Use these dates');
    const before = env.calls.length;
    await page.click('#orAvailSlots li:first-child [data-action="dates"]');
    await page.waitForSelector('#orAvail', { state: 'detached', timeout: 5000 });
    await page.waitForTimeout(800);
    const startNow = await page.$eval(vis('#orStart'), (i) => i.value);
    T.check('the request\'s dates are the slot\'s', startNow > d(2), startNow);
    T.check('the catalog follows them', env.calls.slice(before).some((c) => c.includes('equipment-catalog') && c.includes('startDate=' + startNow)));

    T.section('Add instead');
    await setDate(page, '#orStart', d(2));
    await setDate(page, '#orEnd', d(13));
    await page.click(vis('.nx-or-card[data-id="12"] .nx-or-where'));
    await page.waitForSelector('#orAvailAlts', { timeout: 15000 });
    await page.click('#orAvailAlts [data-action="add"]');
    await page.waitForSelector('#orAvail', { state: 'detached', timeout: 5000 });
    await page.waitForTimeout(500);
    T.check('the alternative is in the cart', /1 in cart/.test(await env.text(vis('.nx-or-card[data-id="11"]'))), await env.text(vis('.nx-or-card[data-id="11"]')));

    T.section('free: where, and to the cart');
    await page.click(vis('.nx-or-card[data-id="11"] .nx-or-where'));
    await page.waitForSelector('#orAvailAnswer', { timeout: 15000 });
    T.check('1 of 1 free, at Houston', /1 of 1 unit free/.test(await env.text('#orAvailAnswer')) && /Free at HOU1 · Houston Yard/.test(await env.text('#orAvailAnswer')));
    T.check('free now: no other dates offered', !(await page.$('#orAvailSlots')));
    T.check('already in the cart: no second Add', !(await page.$('#orAvailAdd')));
    await env.shot('next-order-avail-free.png');

    T.section('its history and Availability');
    await page.click('#orAvailHistory');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && /^equipment-360:/.test(t.dataset.tabId); }, null, { timeout: 15000 });
    T.check('Its full history: the equipment\'s own tab', true);
    await page.click('.nx-tab[data-tab-id="new-request"] .nx-tab-btn');
    await page.waitForSelector(vis('.nx-or-card[data-id="12"] .nx-or-where'), { timeout: 10000 });
    await page.click(vis('.nx-or-card[data-id="12"] .nx-or-where'));
    await page.waitForSelector('#orAvailAnswer', { timeout: 15000 });
    await page.click('#orAvailOpen');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'availability'; }, null, { timeout: 15000 });
    T.check('Open in Availability: its tab', true);

    T.eq('nothing written', env.writes.length, 0);
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('next-order-avail-failure.png').catch(() => {});
  } finally {
    await env.close();
  }
  T.report();
})();
