'use strict';
/*
 * EquipRite Future · the owner and the site in a real browser: Approve & allocate (the sourcing BU decides), the Yard
 * (ship, collect, inspect, repair, the fleet) and Receive, hours, moves (hours by day with the site country's weekend,
 * approval, breakdown, another project). The story is played in Node to a point (tests/e2e/future-fixture.js), then
 * driven as people would: every action opens its confirmation (what EquipRite does, what Fusion would do), Confirm
 * changes the state (read back from localStorage), a failure stays in words. No sideways scroll at 1440 and 1024 px,
 * no browser errors, no backend call. Needs `npm run build`.
 * Run: node tests/e2e/future-ops.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');
const F = require('./future-fixture');

const T = H.makeAsserter();
const PORT = 19620;
const NAMES = { 'p-pm': 'Priya Raman', 'p-site': 'Omar Haddad', 'p-pcfin': 'Mark Lee', 'p-pk': 'Faisal Al-Qahtani', 'p-pf': 'Huda Saleh', 'p-em': 'Ana Costa',
  'p-yard': 'Ravi Kumar', 'p-desk': 'Lena Novak', 'p-fin': 'Sara Ahmed' };

/** Plays the story to `point` (a fixture point, or { name, state } built here), opens the app as `persona` on `navId`, and runs fn with helpers. */
async function story(at, persona, navId, fn) {
  const point = typeof at === 'string' ? at : at.name;
  const s0 = typeof at === 'string' ? F.state(at) : at.state;
  const ids = F.ids(s0);
  const env = await E.start({ port: PORT, app: 'future', init: F.init(s0, persona) });
  const { page } = env;
  const h = {
    env, page, ids,
    state: () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), F.KEY),
    line: (s, rid) => s.requests.find((r) => r.id === rid).lines[0],
    text: async (sel) => ((await page.$(sel)) ? env.text(sel) : ''),
    toast: async () => ((await page.$('#nxToast')) ? env.text('#nxToast') : ''),
    menu: () => page.$$eval('.nx-nav-item', (b) => b.map((x) => x.dataset.navId).join(' ')),
    async playAs(id) {
      await page.click('#fxPersona');
      await page.waitForSelector('#fxPersonaPanel');
      await page.click(`#fxPersonaPanel .fx-person[data-id="${id}"]`);
      await page.waitForFunction((n) => { const e = document.getElementById('fxPersonaName'); return e && e.innerText.trim() === n; }, NAMES[id], { timeout: 10000 });
      await page.waitForTimeout(500);
    },
    async screen(id) {
      await page.click(`.nx-nav-item[data-nav-id="${id}"]`);
      await page.waitForSelector(`#page-${id}`, { timeout: 15000 });
      await page.waitForTimeout(500);
    },
    /** Opens a confirmation with a click and waits for it. */
    async ask(sel, dialog) {
      await page.click(sel);
      await page.waitForSelector(dialog, { timeout: 10000 });
      await page.waitForTimeout(250);
    },
    /** Confirm, and wait for the dialog to close (it worked). */
    async confirm(dialog) {
      await page.click(dialog + 'Confirm');
      await page.waitForSelector(dialog, { state: 'detached', timeout: 10000 });
      await page.waitForTimeout(400);
    },
    /** The Return dialog: Confirm, and wait for it to close. */
    async confirmReturn() {
      await page.click('#stRetConfirm');
      await page.waitForSelector('#stReturn', { state: 'detached', timeout: 10000 });
      await page.waitForTimeout(400);
    },
    /** No sideways scroll inside an open dialog (nor the window). */
    dialogFits: (sel) => page.evaluate((q) => {
      const d = document.querySelector(q + ' .nx-dialog');
      const body = d.querySelector('.nx-dialog-body');
      const right = d.getBoundingClientRect().right;
      const over = Array.prototype.filter.call(d.querySelectorAll('*'), (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > right + 1; })
        .map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]).slice(0, 4);
      const de = document.documentElement;
      return { ok: de.scrollWidth <= de.clientWidth && body.scrollWidth <= body.clientWidth + 1 && right <= window.innerWidth && !over.length, over: over.join(', ') };
    }, sel),
    /** No sideways scroll: neither the window nor the tab's content, and nothing on the page sticks out on the right. */
    fits: (sel) => page.evaluate((q) => {
      const pg = document.querySelector(q);
      const content = pg.closest('.nx-content') || pg.parentElement;
      const right = pg.getBoundingClientRect().right;
      const over = Array.prototype.filter.call(pg.querySelectorAll('*'), (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > right + 1; })
        .map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]).slice(0, 4);
      const de = document.documentElement;
      return { ok: de.scrollWidth <= de.clientWidth && content.scrollWidth <= content.clientWidth + 1 && !over.length, over: over.join(', ') };
    }, sel),
    /** A screenshot of the whole tab's content (the window made as tall as it). */
    async shotFull(name) {
      const vp = page.viewportSize();
      const tall = await page.evaluate(() => {
        const c = Array.prototype.filter.call(document.querySelectorAll('.nx-content'), (x) => x.offsetParent !== null)[0];
        return c ? Math.ceil(c.scrollHeight + c.getBoundingClientRect().top + 8) : 1000;
      });
      await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(tall, vp.height), 6000) });
      await page.waitForTimeout(400);
      const f = await env.shot(name);
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);
      return f;
    }
  };
  try {
    await env.open('/?open=' + navId);
    await page.waitForSelector(`#page-${navId}`, { timeout: 30000 });
    await page.waitForTimeout(800);
    await fn(h);
    T.eq(point + ': no call to any backend', env.calls.join('\n'), '');
    T.eq(point + ': no browser errors or warnings', env.errors.join('\n'), '');
  } catch (e) {
    T.check(point + ': run finished', false, e.stack || e.message);
    await env.shot('future-ops-failed-' + point + '.png').catch(() => {});
  } finally {
    await env.close();
  }
}

/** The widths: no sideways scroll on a screen at 1440 and 1024 px. */
async function widths(h, sel, label) {
  for (const w of [1440, 1024]) {
    await h.page.setViewportSize({ width: w, height: 1000 });
    await h.page.waitForTimeout(400);
    const f = await h.fits(sel);
    T.check(`${w}px, ${label}: no sideways scroll`, f.ok, f.over);
  }
  await h.page.setViewportSize({ width: 1440, height: 1000 });
  await h.page.waitForTimeout(300);
}

/** FR-1001: Customer Y rents an excavator for 9 Nov – 6 Dec; FleetCo delivers it today, 2 Nov (early): on hire from 9 Nov. */
function earlyState() {
  let s = F.state('fresh');
  const as = (id) => { s = F.Engine.apply(s, 'setPersona', { id }).state; };
  const act = (type, payload) => { const r = F.Engine.apply(s, type, payload); if (!r.ok) throw new Error('early: ' + type + ' failed: ' + r.error); s = r.state; return r.result; };
  as('p-desk');
  const id = act('createRequest', { requestingBu: 'BU-FC', customerId: 'C-Y', from: '2026-11-09', to: '2026-12-06', lines: [{ cls: 'EXC', unitId: 'U-EX2' }] }).id;
  const lid = s.requests.find((r) => r.id === id).lines[0].id;
  act('takeDeposit', { requestId: id });
  as('p-em'); act('approveLine', { requestId: id, lineId: lid, unitId: 'U-EX2' });
  as('p-yard'); act('shipLine', { requestId: id, lineId: lid });
  as('p-desk'); act('receiveLine', { requestId: id, lineId: lid });
  return s;
}

(async () => {
  // ── 'raised': Ana approves and refuses; Priya has no Approve & allocate; Ravi ships ───────────────────────────
  await story('raised', 'p-em', 'approvals', async (h) => {
    const { page, ids } = h;
    const card = (n) => `#page-approvals .fx-ap-card[data-request="${n}"]`;
    T.section('Approve & allocate: the sourcing BU decides (Ana, FleetCo)');
    T.eq('the scope says whose fleet', await h.text('#apScope'),
      'Lines that use the fleet of FleetCo Fleet. The sourcing BU decides: approve with the unit you choose, or refuse with a reason.');
    T.eq('FleetCo\'s lines only, not Facilities\' light tower (FR-1005)', await page.$$eval('#page-approvals .fx-ap-card', (c) => c.map((x) => x.dataset.request).join()),
      'FR-1001,FR-1002,FR-1003,FR-1004');
    T.eq('chips by relationship, with counts', await page.$$eval('#apChips .nx-chip', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'All 4 | Intercompany · domestic 2 | Intercompany · cross-border 1 | Customer rental 1');
    const c1 = await h.text(card('FR-1001'));
    T.check('a card says who asks and for what: company, BU, project', /ProjectCo ProjectCo Projects/.test(c1) && c1.includes('PC-INT-014 · ProjectCo head office fit-out'), c1);
    T.check('…where and when', c1.includes('Business Bay, Dubai United Arab Emirates') && c1.includes('3 Nov – 20 Dec 2026') && c1.includes('48 days'), c1);
    T.check('…the relationship and what it means', c1.includes('Intercompany · domestic: Two legal entities, one country: invoice pair, domestic VAT'), c1);
    T.check('…agreement and price, with the currency', c1.includes('ICA-FC-PC-2026 v1') && c1.includes('AED 3,500.00/week or AED 800.00/day'), c1);
    T.eq('…the requester', await h.text(card('FR-1001') + ' .fx-ap-requester'), 'Priya Raman');
    T.eq('units as a radio list, the preferred first', await page.$$eval(card('FR-1001') + ' .fx-unit', (u) => u.map((x) => x.dataset.unit).join()), 'EX-1001,EX-1002,EX-1003');
    T.check('…the preferred one says so, and it is chosen', (await h.text(card('FR-1001') + ' .fx-unit[data-unit="EX-1001"]')).includes('Preferred by the requester')
      && await page.isChecked(card('FR-1001') + ' .fx-unit[data-unit="EX-1001"] input'));
    T.eq('a unit that cannot go says why: the certificate for the site\'s country', await h.text(card('FR-1003') + ' .fx-unit[data-unit="GN-3002"] .fx-unit-why'), 'No certificate for Saudi Arabia');
    T.check('…and cannot be chosen', await page.isDisabled(card('FR-1003') + ' .fx-unit[data-unit="GN-3002"] input'));
    const after = await h.text(card('FR-1003') + ' .fx-after');
    T.check('what approving sets off: the yard ships, a transfer order inside FleetCo, a temporary import', after.includes('yard (Ravi Kumar) is told to ship GN-3001 to Riyadh')
      && after.includes('transfer order inside FleetCo: FleetCo Jebel Ali Yard → FleetCo deployed · KSA sites (GR-6)') && after.includes('temporary import opens'), after);
    T.check('the customer rental without the deposit says so, and links to Customer billing (as the rental desk)',
      (await h.text(card('FR-1004') + ' .fx-ap-deposit')).includes('deposit (25 % of a month) has not been received') && (await h.text(card('FR-1004') + ' .fx-play')) === 'Play as Lena and open Customer billing');
    T.check('…and cannot be approved yet', await page.isDisabled(card('FR-1004') + ' .fx-ap-approve'));
    await page.click('#page-approvals #apChips .nx-chip[data-key="IC_CROSS_BORDER"]');
    await page.waitForTimeout(300);
    T.eq('a chip shows one relationship', await page.$$eval('#page-approvals .fx-ap-card', (c) => c.map((x) => x.dataset.request).join()), 'FR-1003');
    await page.click('#page-approvals #apChips .nx-chip[data-key="all"]');
    await page.waitForTimeout(300);
    await page.click('#apExport');
    await page.click('#page-approvals .nx-menu-item[data-format="csv"]');
    await page.waitForTimeout(400);
    T.eq('the list exports', await h.toast(), '4 rows exported to CSV.');
    await widths(h, '#page-approvals', 'Approve & allocate');
    T.check('screenshot', !!(await h.shotFull('future-ops-approvals.png')));

    T.section('Approve FR-1001 with EX-1001: it says what it does first');
    await page.click(card('FR-1001') + ' .fx-unit[data-unit="EX-1002"] input');
    await page.waitForTimeout(300);
    T.eq('choosing another unit changes the button', await h.text(card('FR-1001') + ' .fx-ap-approve'), 'Approve and allocate EX-1002');
    await page.click(card('FR-1001') + ' .fx-unit[data-unit="EX-1001"] input');
    await page.waitForTimeout(300);
    T.eq('…and back', await h.text(card('FR-1001') + ' .fx-ap-approve'), 'Approve and allocate EX-1001');
    await h.ask(card('FR-1001') + ' .fx-ap-approve', '#apAsk');
    T.eq('the confirmation names it', await h.text('#apAskTitle'), 'Approve FR-1001 with EX-1001');
    T.check('what EquipRite does', (await h.text('#apAskDoes')).includes('Allocates EX-1001 (CAT 320 Excavator, asset FA-10021) to FR-1001'));
    T.check('what Fusion would do: nothing now; at shipping a location update, no accounting',
      (await h.text('#apAskFusion')).includes('Nothing in Fusion at approval.') && (await h.text('#apAskFusion')).includes('no accounting'));
    T.check('who is told', (await h.text('#apAskTold')).includes('Ana Costa and Ravi Kumar: Ship EX-1001 for FR-1001 to Business Bay, Dubai (AE).'));
    let s = await h.state();
    T.eq('nothing changes before Confirm', h.line(s, ids.r1).status, 'REQUESTED');
    await h.confirm('#apAsk');
    s = await h.state();
    T.eq('approved and allocated: EX-1001 on FR-1001', [h.line(s, ids.r1).status, h.line(s, ids.r1).unitId, h.line(s, ids.r1).approvedBy].join(), 'APPROVED,U-EX1,Ana Costa');
    T.check('the toast says what happened', (await h.toast()).includes('Approved and allocated EX-1001 on FR-1001.'), await h.toast());
    T.check('…and the line leaves the queue', !(await page.$(card('FR-1001'))));

    T.section('Approve FR-1003 (cross-border) with GN-3001');
    await h.ask(card('FR-1003') + ' .fx-ap-approve', '#apAsk');
    T.check('cross-border: the confirmation says the transfer order stays inside FleetCo and a temporary import opens',
      (await h.text('#apAskFusion')).includes('FleetCo deployed · KSA sites (GR-6)') && (await h.text('#apAskFusion')).includes('temporary import'));
    T.check('…and the money: reverse charge and withholding', (await h.text('#apAskMoney')).includes('reverse charge') && (await h.text('#apAskMoney')).includes('withholds 5 %'));
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'equiprite-e2e', 'future-ops-approve-dialog.png') });
    await h.confirm('#apAsk');
    s = await h.state();
    T.eq('approved: GN-3001 on FR-1003', [h.line(s, ids.rk).status, h.line(s, ids.rk).unitId].join(), 'APPROVED,U-GN1');

    T.section('Refuse FR-1002: the reason is required, a failure stays in words');
    await h.ask(card('FR-1002') + ' .fx-ap-refuse', '#apAsk');
    T.eq('it asks why', await h.text('#apAsk .fx-field[data-key="reason"] label > span'), 'Why (the requester sees it) (required)');
    T.eq('…and says it is not ready yet', await h.text('#apAskWarn'), 'Not yet: Say why (the requester sees it).');
    await page.click('#apAskConfirm');
    await page.waitForSelector('#apAskError', { timeout: 5000 });
    T.eq('Confirm without a reason: the engine\'s refusal stays in the dialog', await h.text('#apAskError'), 'It did not go through. Say why (the requester sees it).');
    T.check('…and on the page', (await h.text('#apFailure')).includes('Refuse a line of FR-1002: it did not go through. Say why (the requester sees it).'), await h.text('#apFailure'));
    T.eq('…nothing changed', h.line(await h.state(), ids.r2).status, 'REQUESTED');
    await page.type('#apField-reason', 'The crane is booked for the shutdown; ask again from 1 Dec');
    await page.waitForTimeout(300);
    T.eq('typing keeps its place', await page.inputValue('#apField-reason'), 'The crane is booked for the shutdown; ask again from 1 Dec');
    T.check('…the refusal note goes, the preview follows what is typed', !(await page.$('#apAskError')) && (await h.text('#apAskDoes')).includes('"The crane is booked for the shutdown; ask again from 1 Dec"'));
    await h.confirm('#apAsk');
    s = await h.state();
    T.eq('refused with the reason', [h.line(s, ids.r2).status, h.line(s, ids.r2).reason].join(' | '), 'REJECTED | The crane is booked for the shutdown; ask again from 1 Dec');
    T.check('the failure note on the page goes once an action works', !(await page.$('#apFailure')));
    T.eq('left: the customer rental, waiting for its deposit', await page.$$eval('#page-approvals .fx-ap-card', (c) => c.map((x) => x.dataset.request).join()), 'FR-1004');

    T.section('Huda (ProjectCo Facilities) sees her own fleet\'s line only');
    await h.playAs('p-pf');
    await page.waitForSelector('#page-approvals .fx-ap-card[data-request="FR-1005"]', { timeout: 10000 });
    T.eq('Facilities\' light tower, not FleetCo\'s lines', await page.$$eval('#page-approvals .fx-ap-card', (c) => c.map((x) => x.dataset.request).join()), 'FR-1005');
    T.eq('…"the fleet of ProjectCo Facilities"', (await h.text('#apScope')).split('.')[0], 'Lines that use the fleet of ProjectCo Facilities');

    T.section('Priya (the requesting BU) has no Approve & allocate');
    await h.playAs('p-pm');
    T.check('not in her menu', !(await h.menu()).split(' ').includes('approvals'), await h.menu());
    T.check('…and its tab closed', !(await page.$('.nx-tab[data-tab-id="approvals"]')));

    T.section('Ravi ships: an asset (no accounting) and stock across the border (a transfer order, customs)');
    await h.playAs('p-yard');
    await h.screen('yard');
    const item = (sec, n) => `#page-yard ${sec} .fx-item[data-request="${n}"]`;
    T.eq('to ship: what Ana approved', await page.$$eval('#page-yard #ydShip .fx-item', (i) => i.map((x) => x.dataset.request).join()), 'FR-1001,FR-1003');
    T.eq('…each says what Fusion does', [await h.text(item('#ydShip', 'FR-1001') + ' .fx-cell--wide'), await h.text(item('#ydShip', 'FR-1003') + ' .fx-cell--wide')].join(' | '),
      'WHAT FUSION DOES Asset location update, no accounting | WHAT FUSION DOES Transfer order inside FleetCo: FleetCo Jebel Ali Yard → FleetCo deployed · KSA sites '
      + 'Temporary import into Saudi Arabia: pro-forma invoice, packing list, certificates');
    await h.ask(item('#ydShip', 'FR-1001') + ' .fx-ship', '#ydAsk');
    T.check('shipping an asset: Fusion Assets updates its location, no accounting', (await h.text('#ydAskFusion')).includes('Fusion Assets: the location of asset FA-10021 becomes Business Bay, Dubai. No accounting')
      && (await h.text('#ydAskFusion')).includes('Asset location update FleetCo'));
    await h.confirm('#ydAsk');
    await h.ask(item('#ydShip', 'FR-1003') + ' .fx-ship', '#ydAsk');
    const fus = await h.text('#ydAskFusion');
    T.check('shipping stock: a transfer order inside FleetCo to its KSA deployment org (GR-6), with its accounting shown',
      fus.includes('Transfer order shipped FleetCo') && fus.includes('FleetCo Jebel Ali Yard → FleetCo deployed · KSA sites') && fus.includes('1310 Inventory in transit 95,000.00'), fus);
    T.check('…and the temporary-import papers', fus.includes('Temporary import TI-SA-00001: GN-3001 from United Arab Emirates into Saudi Arabia') && fus.includes('pro-forma invoice, packing list, certificates'), fus);
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'equiprite-e2e', 'future-ops-ship-dialog.png') });
    await h.confirm('#ydAsk');
    s = await h.state();
    const shipped = (rid) => s.tx.filter((t) => t.refs && t.refs.lineId === h.line(s, rid).id);
    T.eq('both shipped', [h.line(s, ids.r1).status, h.line(s, ids.rk).status].join(), 'SHIPPED,SHIPPED');
    T.eq('the asset: a location update without accounting', shipped(ids.r1).map((t) => t.kind + ':' + t.lines.length).join(), 'ASSET_CUSTODY:0');
    T.eq('the stock: a transfer order inside FleetCo to its KSA deployment org', shipped(ids.rk).map((t) => [t.kind, t.le, t.destOrg].join(':')).join(), 'TO_SHIP:LE-FC:FC-DEP-SA');
    T.eq('…customs opened', s.customs.map((c) => [c.permit, c.unitId, c.status].join(':')).join(), 'TI-SA-00001:U-GN1:OPEN');
    T.eq('out now: where each unit is', await page.$$eval('#page-yard #ydOut .fx-out-where', (w) => w.map((x) => x.innerText.trim()).join(' | ')),
      'On the way to Business Bay, Dubai | On the way to Riyadh');
    T.eq('nothing left to ship', await h.text('#page-yard #ydShip .fx-sec-empty'), 'Nothing to ship: what the owner approves comes here.');
    await page.click('#page-yard #ydOut .nx-btn[data-list="out"]');
    await page.click('#page-yard #ydOut .nx-menu-item[data-format="csv"]');
    await page.waitForTimeout(400);
    T.eq('every list exports', await h.toast(), '2 rows exported to CSV.');
  });

  // ── 'onHire': Omar records hours, a breakdown, another project; Priya approves; Faisal's weekend is Fri–Sat ────
  await story('onHire', 'p-site', 'site', async (h) => {
    const { page, ids } = h;
    const hire = (n) => `#page-site .fx-hire[data-request="${n}"]`;
    T.section('Receive, hours, moves (Omar, ProjectCo\'s site)');
    T.eq('on hire: his BU\'s units, not KSA\'s', await page.$$eval('#page-site .fx-hire', (c) => c.map((x) => x.dataset.unit).join()), 'EX-1001,CR-2001,TW-5001');
    await page.click('#fxWeek');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Sat 14 Nov 2026', null, { timeout: 5000 });
    await page.waitForTimeout(500);
    T.eq('a week on: the days on hire up to today, the UAE weekend (Sat–Sun) marked', await page.$$eval(hire('FR-1001') + ' .fx-day', (d) => d.map((x) => x.dataset.date.slice(8) + (x.className.includes('fx-day--we') ? 'w' : '')).join(' ')),
      '07w 08w 09 10 11 12 13 14w');
    T.check('…the legend says whose weekend', (await h.text(hire('FR-1001') + ' .fx-hours-legend')).includes('Weekend in United Arab Emirates: Sat–Sun'));
    await h.ask(hire('FR-1001') + ' .fx-fill', '#stAsk');
    T.check('Record standard hours: it says which days first', (await h.text('#stAskDoes')).includes('Records 5 working days not yet recorded, 7 Nov – 14 Nov')
      && (await h.text('#stAskDoes')).includes('Leaves out the weekend in United Arab Emirates (Sat–Sun)'));
    T.check('…and that Fusion does nothing until the charge run', (await h.text('#stAskFusion')).includes('Nothing in Fusion now'));
    await h.confirm('#stAsk');
    let s = await h.state();
    const hrs = (rid) => s.hours.filter((x) => x.lineId === h.line(s, rid).id).sort((a, b) => a.date.localeCompare(b.date));
    T.eq('five working days recorded, waiting for approval', hrs(ids.r1).map((x) => x.date.slice(8) + ':' + x.usage + '/' + x.standby + (x.approved ? 'A' : '')).join(' '), '09:8/0 10:8/0 11:8/0 12:8/0 13:4/4');
    await h.ask(hire('FR-1001') + ' .fx-day[data-date="2026-11-07"]', '#stAsk');
    T.eq('one day: a weekend day can be worked too', await h.text('#stAskTitle'), 'Hours on Sat 7 Nov 2026');
    await page.fill('#stField-usage', '3');
    await page.waitForTimeout(300);
    T.check('…the preview follows what is typed', (await h.text('#stAskDoes')).includes('Records 3 h of use and 0 h of standby on 7 Nov 2026.'));
    await h.confirm('#stAsk');
    s = await h.state();
    T.eq('the day recorded', hrs(ids.r1).map((x) => x.date.slice(8) + ':' + x.usage).join(' '), '07:3 09:8 10:8 11:8 12:8 13:4');
    T.eq('the grid shows it waiting', await page.$$eval(hire('FR-1001') + ' .fx-day--waiting', (d) => d.length), 6);
    T.check('Omar records but does not approve: who does is named', !(await page.$(hire('FR-1001') + ' .fx-approve-hours'))
      && (await h.text(hire('FR-1001') + ' .fx-hours-wait')) === '6 days wait for the approval of Priya Raman or Mark Lee.');

    T.section('A breakdown: a credit, as the agreement says');
    await h.ask(hire('FR-1001') + ' .fx-mv-breakdown', '#stAsk');
    await page.fill('#stField-days', '2');
    await page.fill('#stField-reason', 'Hydraulic leak, waiting for the fitter');
    await page.waitForTimeout(300);
    T.eq('the money', await h.text('#stAskMoney'), 'THE MONEY A credit of 2 × AED 800.00 = AED −1,600.00 on this month\'s charges (ICA-FC-PC-2026 gives a breakdown credit).');
    await h.confirm('#stAsk');
    s = await h.state();
    T.eq('recorded', s.breakdowns.map((b) => [b.lineId === h.line(s, ids.r1).id, b.days, b.reason].join()).join(), 'true,2,Hydraulic leak, waiting for the fitter');

    T.section('Move FR-1001\'s excavator to PC-C-2207: charges go there from today');
    T.check('Omar cannot hand a unit over to another company (the requester does)', !(await page.$(hire('FR-1001') + ' .fx-mv-handover')));
    await h.ask(hire('FR-1001') + ' .fx-mv-redeploy', '#stAsk');
    T.check('the project of the same BU is offered', await page.isChecked('#stAsk input[name="stField-projectId"][value="P-EXT"]'));
    const mv = await h.text('#stAskDoes');
    T.check('it says where the charges go', mv.includes('Charges from today go to PC-C-2207; up to 13 Nov 2026 they stay on PC-INT-014.') && mv.includes('billable to Customer X'), mv);
    await h.confirm('#stAsk');
    s = await h.state();
    T.eq('two segments: PC-INT-014, then PC-C-2207 from today', h.line(s, ids.r1).segments.map((g) => g.projectId + '@' + g.from).join(), 'P-INT@2026-11-03,P-EXT@2026-11-14');
    T.eq('the card shows both', await page.$$eval(hire('FR-1001') + ' .fx-seg-name', (g) => g.map((x) => x.innerText.trim()).join(' | ')),
      'PC-INT-014 · ProjectCo head office fit-out | PC-C-2207 · Marina Tower (Customer X)');
    await widths(h, '#page-site', 'Receive, hours, moves');
    T.check('screenshot', !!(await h.shotFull('future-ops-site.png')));

    T.section('Priya approves the hours (the requester)');
    await h.playAs('p-pm');
    await page.waitForSelector(hire('FR-1001') + ' .fx-approve-hours', { timeout: 10000 });
    T.eq('the button says how many days', await h.text(hire('FR-1001') + ' .fx-approve-hours'), 'Approve hours (6 days)…');
    await h.ask(hire('FR-1001') + ' .fx-approve-hours', '#stAsk');
    T.check('it says what it approves, and who is told', (await h.text('#stAskDoes')).includes('Approves 6 days of hours, 7 Nov – 13 Nov: 39 h of use, 4 h of standby.')
      && (await h.text('#stAskTold')).includes('Ana Costa: FR-1001: 6 days of hours approved by ProjectCo Projects.'));
    await h.confirm('#stAsk');
    s = await h.state();
    T.eq('all approved, by Priya', hrs(ids.r1).map((x) => (x.approved ? 'A' : '-') + x.approvedBy).filter((x, i, a) => a.indexOf(x) === i).join(), 'APriya Raman');
    T.eq('the grid shows them approved', await page.$$eval(hire('FR-1001') + ' .fx-day--approved', (d) => d.length), 6);
    T.check('Priya may hand a unit over to another group company (same country)', !!(await page.$(hire('FR-1001') + ' .fx-mv-handover')));
    await h.ask(hire('FR-1001') + ' .fx-mv-handover', '#stAsk');
    T.check('…it says: returned for ProjectCo, the owner approves the new line, no sub-lending', (await h.text('#stAskDoes')).includes('FleetCo Fleet approves the new line')
      && (await h.text('#stAskDoes')).includes('No sub-lending: FleetCo bills ProjectCo Facilities directly under ICA-FC-PF-2026'));
    await page.click('#stAskCancel');
    await page.waitForSelector('#stAsk', { state: 'detached' });
    T.eq('Cancel changes nothing', h.line(await h.state(), ids.r1).status, 'ON_HIRE');

    T.section('KSA: the weekend is Friday and Saturday');
    await h.playAs('p-pk');
    await page.waitForSelector(hire('FR-1003'), { timeout: 10000 });
    T.eq('Faisal sees his own unit only', await page.$$eval('#page-site .fx-hire', (c) => c.map((x) => x.dataset.unit).join()), 'GN-3001');
    T.eq('…its days, Fri–Sat marked', await page.$$eval(hire('FR-1003') + ' .fx-day', (d) => d.map((x) => x.dataset.date.slice(8) + (x.className.includes('fx-day--we') ? 'w' : '')).join(' ')),
      '07w 08 09 10 11 12 13w 14w');
    T.check('…the legend', (await h.text(hire('FR-1003') + ' .fx-hours-legend')).includes('Weekend in Saudi Arabia: Fri–Sat'));
  });

  // ── 'returned': Omar releases the crane; Ravi collects it and inspects it with damage; a repair is done ─────────
  await story('returned', 'p-site', 'site', async (h) => {
    const { page, ids } = h;
    T.section('Return today (Omar)');
    await h.ask('#page-site .fx-hire[data-request="FR-1002"] .fx-mv-return', '#stReturn');
    T.eq('the Return dialog: the request\'s end by default (after today), its dates in the head', [await h.text('#stRetTitle'), await page.inputValue('#stRetDate'), await h.text('#stRetDates'),
      await h.text('#stRetBillTitle')].join(' | '), 'Return CR-2001 | 2026-12-31 | Requested 3 Nov – 31 Dec 2026 · on hire since 7 Nov 2026 | ESTIMATED FINAL BILL');
    await page.fill('#stRetDate', '2026-11-30');
    await page.waitForFunction(() => /Returned today/.test(document.getElementById('stRetWhenText').innerText), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    T.eq('…today picked: the hire stops that day', [await page.inputValue('#stRetDate'), await h.text('#stRetWhenText'), await h.text('#stRetBillTitle')].join(' | '),
      '2026-11-30 | Returned today: the hire stops that day, charged up to 29 Nov 2026. | THE FINAL BILL');
    T.check('it says the hours of today are dropped and the yard is told to collect', (await h.text('#stRetDoes')).includes('Stops the hire of CR-2001 on 30 Nov 2026; 1 day of hours recorded from then on is dropped.')
      && (await h.text('#stRetDoes')).includes('Collect CR-2001 from Dubai Marina: returned on 30 Nov 2026.'), await h.text('#stRetDoes'));
    T.eq('Omar may not agree the hours: who does is named', await h.text('#stRetWait'), 'They wait for the approval of Priya Raman or Mark Lee; the bill counts them once approved.');
    await h.confirmReturn();
    let s = await h.state();
    T.eq('returned on the day', [h.line(s, ids.r2).status, h.line(s, ids.r2).events.offHire].join(), 'OFF_HIRED,2026-11-30');

    T.section('Collect and inspect (Ravi): damage above the threshold');
    await h.playAs('p-yard');
    await h.screen('yard');
    const item = (sec, n) => `#page-yard ${sec} .fx-item[data-request="${n}"]`;
    T.check('to collect: the crane, and what the return does', (await h.text(item('#ydCollect', 'FR-1002'))).includes('Asset location back to FleetCo Jebel Ali Yard, no accounting'));
    await h.ask(item('#ydCollect', 'FR-1002') + ' .fx-collect', '#ydAsk');
    T.check('collecting it: the asset\'s location goes back, no accounting', (await h.text('#ydAskFusion')).includes('goes back to FleetCo Jebel Ali Yard; no accounting'));
    T.check('…and the transport back', (await h.text('#ydAskMoney')).includes('Transport back: AED 1,500.00'));
    await h.confirm('#ydAsk');
    s = await h.state();
    T.eq('back at the yard, to inspect', [h.line(s, ids.r2).status, s.units.find((u) => u.id === 'U-CR1').status].join(), 'RETURNED,INSPECTION');
    await h.ask(item('#ydInspect', 'FR-1002') + ' .fx-inspect', '#ydAsk');
    T.eq('it starts at Passed, without the damage fields', await page.$$eval('#ydAsk .fx-field', (f) => f.map((x) => x.dataset.key).join()), 'result,note');
    await page.click('#ydAsk input[name="ydField-result"][value="damage"]');
    await page.waitForTimeout(300);
    T.eq('Damaged: the amount and the photos', await page.$$eval('#ydAsk .fx-field', (f) => f.map((x) => x.dataset.key).join()), 'result,damage,photos,note');
    await page.fill('#ydField-damage', '6000');
    await page.fill('#ydField-photos', '0');
    await page.fill('#ydField-note', 'Bent boom section');
    await page.waitForTimeout(300);
    T.eq('no photo: it says so before', await h.text('#ydAskWarn'), 'Not yet: A damage charge needs photos (MC-FR-29).');
    await page.click('#ydAskConfirm');
    await page.waitForSelector('#ydAskError', { timeout: 5000 });
    T.eq('Confirm anyway: the refusal stays in words', await h.text('#ydAskError'), 'It did not go through. A damage charge needs photos (MC-FR-29).');
    T.check('…on the page too', (await h.text('#ydFailure')).includes('Inspect CR-2001: it did not go through. A damage charge needs photos (MC-FR-29).'));
    await page.fill('#ydField-photos', '3');
    await page.waitForTimeout(300);
    const does = await h.text('#ydAskDoes');
    T.check('above the threshold, the user must accept it (OD-11)', does.includes('Charges the damage of AED 6,000.00 to ProjectCo Projects: Bent boom section (3 photos).')
      && does.includes('Above AED 5,000.00 (OD-11): ProjectCo Projects must accept it on the statement before it is invoiced.'), does);
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'equiprite-e2e', 'future-ops-inspect-dialog.png') });
    await h.confirm('#ydAsk');
    s = await h.state();
    const insp = h.line(s, ids.r2).inspection;
    T.eq('inspected with damage', [h.line(s, ids.r2).status, insp.result, insp.damage, insp.note, insp.photos, insp.by].join(), 'CLOSED,DAMAGED,6000,Bent boom section,3,Ravi Kumar');
    T.eq('the crane goes to repair', s.units.find((u) => u.id === 'U-CR1').status, 'IN_REPAIR');
    T.check('the failure note goes once it worked', !(await page.$('#ydFailure')));
    T.eq('in repair: both damaged units', await page.$$eval('#page-yard #ydRepair .fx-item', (i) => i.map((x) => x.dataset.unit).join()), 'CR-2001,GN-3002');
    await h.ask('#page-yard #ydRepair .fx-item[data-unit="GN-3002"] .fx-repaired', '#ydAsk');
    await h.confirm('#ydAsk');
    s = await h.state();
    T.eq('repaired: back in the fleet', s.units.find((u) => u.id === 'U-GN2').status, 'AVAILABLE');

    T.section('The fleet: where each unit is, certificates by country, customs');
    const row = (u) => `#page-yard #ydFleetGrid .nx-row[data-unit="${u}"]`;
    T.eq('every unit of FleetCo Fleet', await page.$$eval('#page-yard #ydFleetGrid .nx-row[data-unit]', (r) => r.length), 8);
    T.eq('an expired certificate in red', await page.$$eval(row('EX-1003') + ' .fx-cert--expired', (c) => c.map((x) => x.innerText.trim()).join()), 'SA · SASO conformity · expired 20 Nov 2026');
    T.check('open customs', (await h.text(row('GN-3001'))).includes('TI-SA-00001 · AE → SA · re-export by 30 Jan 2027'));
    T.check('where it is, with its country', (await h.text(row('GN-3001') + ' .fx-fleet-where')) === 'Riyadh · PK-C-0310' && (await h.text(row('GN-3001'))).includes('Saudi Arabia'));
    T.check('value with its currency', (await h.text(row('CR-2001'))).includes('AED 1,500,000.00'));
    await widths(h, '#page-yard', 'Yard');
    T.check('screenshot', !!(await h.shotFull('future-ops-yard.png')));
    await h.page.setViewportSize({ width: 1024, height: 1000 });
    await h.page.waitForTimeout(400);
    T.check('screenshot at 1024 px', !!(await h.shotFull('future-ops-yard-1024.png')));
    await h.page.setViewportSize({ width: 1440, height: 1000 });
  });

  // ── 'onHire': Lena returns Customer Y's unit two days ago, with the customer's signed timesheet; the bill by the hour ─
  await story('onHire', 'p-desk', 'site', async (h) => {
    const { page, ids } = h;
    const hire = '#page-site .fx-hire[data-request="FR-1004"]';
    T.section('Return on a date with the final timesheet and the final bill (Lena, Customer Y, billed by the hour)');
    await page.click('#fxWeek');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Sat 14 Nov 2026', null, { timeout: 5000 });
    await page.waitForTimeout(500);
    T.eq('the card: billed by the hour, the hour rate', [await h.text(hire + ' .fx-ap-title'), await h.text(hire + ' .fx-hire-facts')].map((x) => x.includes('Billed by the hour') || x.includes('AED 52.50/hour, by the hour (at least 16 h per hire)')).join(), 'true,true');
    T.check('the desk records the customer\'s hours: the days are buttons, standard hours to today', (await page.$$(hire + ' button.fx-day')).length === 8 && !!(await page.$(hire + ' .fx-fill')));
    await h.ask(hire + ' .fx-fill', '#stAsk');
    await h.confirm('#stAsk');
    T.eq('the small print says what a return is, once', [await page.$$eval('#page-site .fx-st-fine', (x) => x.length), (await h.text('#stReturnTerm')).split(':')[0]].join(' | '), '1 | Return (off hire)');
    await h.ask(hire + ' .fx-mv-return', '#stReturn');
    T.eq('Return: the request\'s end by default, the timesheet to the return day (by the hour), planned after today', [await h.text('#stRetTitle'), await page.inputValue('#stRetDate'),
      await page.$$eval('#stRetRows .fx-sheet-row', (r) => r.map((x) => x.dataset.date.slice(8) + (x.className.includes('fx-sheet-row--planned') ? 'p' : '')).join())].join(' | '),
      'Return GN-3002 | 2026-11-25 | 07,08,09,10,11,12,13,14,15p,16p,17p,18p,19p,20p,21p,22p,23p,24p,25p');
    await page.fill('#stRetDate', '2026-11-12');
    await page.waitForFunction(() => document.querySelectorAll('#stRetRows .fx-sheet-row').length === 6, null, { timeout: 5000 });
    await page.waitForTimeout(300);
    T.eq('two days ago: the rows to the return day (its hours count, by the hour), the weekend marked, prefilled', await page.$$eval('#stRetRows .fx-sheet-row', (r) => r.map((x) => x.dataset.date.slice(8)
      + (x.className.includes('fx-sheet-row--we') ? 'w' : '') + ':' + x.querySelector('[data-kind="usage"]').value + '/' + x.querySelector('[data-kind="standby"]').value).join(' ')),
      '07w:/ 08w:/ 09:8/0 10:8/0 11:8/0 12:8/0');
    T.eq('…the last row is the return day', await h.text('#stRetRows .fx-sheet-row[data-date="2026-11-12"] .fx-sheet-ret'), 'RETURN DAY');
    T.eq('…when, and the hours after it dropped', [await h.text('#stRetWhenText'), await h.text('#stRetDropped')].join(' | '),
      'Returned on Thu 12 Nov 2026: the hire stops that day; by the hour, the hours of the return day count too. | Hours recorded on 13 Nov are dropped: the hire stops on 12 Nov 2026 (its hours count, not the days after).');
    T.eq('the final bill: hours × AED 52.50 (the return day\'s too), transport out and back, VAT', await page.$$eval('#stRetBillRows .fx-bill-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' ; ')),
      'Rental 32 h of use × AED 52.50 an hour AED 1,680.00 ; Transport out to the site AED 2,200.00 ; Transport back when the yard collects it AED 2,200.00');
    T.eq('…the total for the hire, with VAT, already charged and still to charge', [await h.text('#stRetTotal'), await h.text('#stRetGross'), await h.text('#stRetToCharge')].join(' | '),
      'AED 6,080.00 | AED 6,384.00 | AED 6,080.00 at the next charge run');
    await page.fill('#stRetU-2026-11-10', '6');
    await page.fill('#stRetS-2026-11-10', '2');
    await page.waitForFunction(() => /AED 6,027.50/.test(document.getElementById('stRetTotal').innerText), null, { timeout: 5000 });
    T.eq('a day changed: the bill follows as it is typed', [await h.text('#stRetSum'), await h.text('#stRetRows .fx-sheet-row[data-date="2026-11-10"] .fx-chip'),
      await page.$$eval('#stRetBillRows .fx-bill-row', (r) => r.slice(0, 2).map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' ; ')), await h.text('#stRetTotal')].join(' | '),
      '4 days with hours · 30 h of use · 2 h of standby | Changed | Rental 30 h of use × AED 52.50 an hour AED 1,575.00 ; Standby 2 h × AED 26.25 (50 % of the hour rate) AED 52.50 | AED 6,027.50');
    T.check('…the field keeps what was typed', (await page.inputValue('#stRetU-2026-11-10')) === '6' && (await page.inputValue('#stRetS-2026-11-10')) === '2');
    T.eq('the hours agreed: signed by the customer', await h.text('#page-site #stReturn .fx-ret-agree'), 'These hours are agreed (signed by the customer, Customer Y)');
    await page.check('#stRetApprove');
    await page.waitForFunction(() => /agrees every day of it/.test(document.getElementById('stRetDoes').innerText), null, { timeout: 5000 });
    const does = await h.text('#stRetDoes');
    T.check('What EquipRite does: stops the hire, records and agrees the timesheet, the yard collects', ['Stops the hire of GN-3002 on 12 Nov 2026; 1 day of hours recorded after it is dropped.',
      'Records 1 day of the timesheet and agrees every day of it (signed by the customer).', 'Collect GN-3002 from Customer site: returned on 12 Nov 2026.'].every((x) => does.includes(x)), does);
    T.eq('Confirm says it', await h.text('#stRetConfirm'), 'Return GN-3002 on 12 Nov 2026');
    for (const w of [1440, 1024]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(400);
      const f = await h.dialogFits('#stReturn');
      T.check(`${w}px, the Return dialog: no sideways scroll`, f.ok, f.over);
      T.check(`${w}px, …a screenshot of it`, !!(await h.env.shot(w === 1440 ? 'future-ops-return-dialog.png' : 'future-ops-return-dialog-1024.png')));
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(300);
    await h.confirmReturn();
    T.eq('the toast: returned, the days, the hours, the final bill', await h.toast(), 'GN-3002 returned on 12 Nov 2026: 6 days with the return day, 30 h of use, final bill AED 6,027.50 + VAT 5 % AED 301.38.');
    const s = await h.state();
    const l = h.line(s, ids.r3);
    const hrs = s.hours.filter((x) => x.lineId === l.id).sort((a, b) => a.date.localeCompare(b.date));
    T.eq('the state: returned on that date', [l.status, l.events.offHire].join(), 'OFF_HIRED,2026-11-12');
    T.eq('…the hours to the return day, approved: signed by the customer', hrs.map((x) => x.date.slice(8) + ':' + x.usage + '/' + x.standby + (x.approved ? ':' + x.approvedBy : '')).join(' | '),
      '09:8/0:Lena Novak (signed by the customer) | 10:6/2:Lena Novak (signed by the customer) | 11:8/0:Lena Novak (signed by the customer) | 12:8/0:Lena Novak (signed by the customer)');
    T.eq('…none after the return date', hrs.filter((x) => x.date > '2026-11-12').length, 0);
    T.check('the unit has left On hire', !(await page.$(hire)));

    T.section('The request\'s Money: the bill for this hire');
    await h.env.open(`/?open=request&id=${ids.r3}`);
    await page.waitForSelector('#page-request #recTabs', { timeout: 20000 });
    await page.click('#recTab-money');
    const bill = '#recBills .fx-bill-card';
    await page.waitForSelector(bill, { timeout: 10000 });
    T.eq('by the hour, from the approved timesheet: the final bill', [await h.text(bill + ' .fx-bill-cardhead .fx-chip'), await h.text(bill + ' .fx-bill-mode'), await h.text(bill + ' .fx-bill-totalv'),
      await h.text(bill + ' .fx-bill-gross'), await h.text(bill + ' .fx-bill-charged')].join(' | '),
      'By the hour: from the approved timesheet | Returned 12 Nov 2026: on hire 7 Nov – 12 Nov 2026 (6 days, the return day included) | AED 6,027.50 | AED 6,328.88 | AED 0.00 nothing charged yet');
    T.check('…damage after the yard\'s inspection', (await h.text(bill + ' .fx-bill-notes')).includes('Damage, if any, is added after the yard’s inspection.'));
    T.check('…the step says returned, the hours signed by the customer', (await page.click('#recTab-flow'), await page.waitForSelector('#recFlow'), await h.text('#recFlow .fx-fs[data-key="offHire"]')).includes('Returned: the hire stops')
      && (await h.text('#recFlow .fx-fs[data-key="hours"]')).includes('Timesheet signed by the customer'));
    await page.click('#recTab-money');
    await page.waitForSelector(bill);
    await page.$eval(bill, (e) => e.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    const shot = require('path').join(require('os').tmpdir(), 'equiprite-e2e', 'future-ops-request-bill.png');
    await (await page.$(bill)).screenshot({ path: shot });
    T.check('screenshot of the bill card', !!shot);
    await widths(h, '#page-request', 'the request\'s Money');
  });

  // ── 'onHire': Omar books a return in 5 days; a week on the clock returns it by itself and asks for the timesheet ──
  await story('onHire', 'p-site', 'site', async (h) => {
    const { page, ids } = h;
    const hire = '#page-site .fx-hire[data-request="FR-1001"]';
    T.section('A planned return (Omar): booked for a later date, it happens by itself');
    await h.ask(hire + ' .fx-mv-return', '#stReturn');
    await page.fill('#stRetDate', '2026-11-12');
    await page.waitForFunction(() => /Planned return/.test(document.getElementById('stRetWhenText').innerText), null, { timeout: 5000 });
    T.eq('in 5 days: planned, the timesheet to the day before (by the day), planned after today, the estimated bill', [await h.text('#stRetWhenText'), await h.text('#stRetConfirm'), await h.text('#stRetBillTitle'),
      await page.$$eval('#stRetRows .fx-sheet-row', (r) => r.map((x) => x.dataset.date.slice(8) + (x.className.includes('fx-sheet-row--planned') ? 'p' : '')).join())].join(' | '),
      'Planned return: the hire stops by itself on 12 Nov 2026. Until then, record the hours as the days pass; the final timesheet is asked for on the day. | Book the return for 12 Nov 2026 | ESTIMATED FINAL BILL | 07,08p,09p,10p,11p');
    T.eq('…by the day: the actual day and the planned ones apart (5 days at the week rate), transport out and back', [await page.$$eval('#stRetBillRows .fx-bill-row', (r) => r.slice(0, 2).map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' ; ')),
      await h.text('#stRetTotal')].join(' | '), 'Rental, actual 7 Nov 2026 · 1 day AED 800.00 ; Rental, planned 8 Nov – 11 Nov 2026 · 4 days AED 2,700.00 | AED 6,500.00');
    await h.confirmReturn();
    T.eq('the toast', await h.toast(), 'Return booked for 12 Nov 2026 (EX-1001). Until then, record the hours as the days pass; the final timesheet is asked for on the day.');
    let s = await h.state();
    T.eq('booked, still on hire', [h.line(s, ids.r1).status, h.line(s, ids.r1).plannedReturn].join(), 'ON_HIRE,2026-11-12');
    T.eq('the card: the return planned, and Change', [await h.text(hire + ' .fx-planned'), await h.text(hire + ' .fx-mv-return')].join(' | '), 'Return planned for 12 Nov 2026 | Change the return…');
    await page.click('#fxWeek');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Sat 14 Nov 2026', null, { timeout: 5000 });
    await page.waitForTimeout(600);
    s = await h.state();
    T.eq('a week on: returned by itself on the date', [h.line(s, ids.r1).status, h.line(s, ids.r1).events.offHire].join(), 'OFF_HIRED,2026-11-12');
    await page.click('#nxBell');
    await page.waitForSelector('#nxBellPanel .nx-alert');
    T.check('the bell asks Omar for the final timesheet', (await h.text('#nxBellPanel')).includes('EX-1001 was returned on 12 Nov 2026: send the final timesheet.'), await h.text('#nxBellPanel'));
    await page.click('.nx-backdrop');
    await page.waitForTimeout(300);
    const back = '#stReturned .fx-item[data-unit="EX-1001"]';
    await page.waitForSelector(back, { timeout: 10000 });
    T.eq('Returned: the final timesheet to send', await h.text(back + ' .fx-ret-open'), '3 working days without hours');
    await h.ask(back + ' .fx-send-sheet', '#stReturn');
    T.eq('the timesheet only: returned already', [await h.text('#stRetTitle'), await h.text('#stRetWhenText'), !!(await page.$('#stRetDate'))].join(' | '),
      'The final timesheet of EX-1001 | Returned on 12 Nov 2026: the hire stopped that day. The timesheet runs to 11 Nov 2026. | false');
    await page.click('#stRetFill');
    await page.waitForTimeout(400);
    T.eq('Fill standard hours: 8 h on each working day, the weekend left empty', await page.$$eval('#stRetRows [data-kind="usage"]', (r) => r.map((x) => x.dataset.date.slice(8) + ':' + x.value).join(' ')),
      '07: 08: 09:8 10:8 11:8');
    await h.confirmReturn();
    s = await h.state();
    T.eq('sent: waiting for Priya or Mark', s.hours.filter((x) => x.lineId === h.line(s, ids.r1).id).map((x) => x.date.slice(8) + ':' + x.usage + (x.approved ? 'A' : '')).join(' '), '09:8 10:8 11:8');
    T.eq('…the card says who approves', await h.text(back + ' .fx-hours-wait'), 'Waiting for the approval of Priya Raman or Mark Lee.');
    await widths(h, '#page-site', 'Receive, hours, moves with a returned unit');
  });

  // ── 'early': FR-1001, a Customer Y rental for 9 Nov – 6 Dec, delivered on 2 Nov (today): Lena books the return on the
  //    request's end with an estimated final bill; two weeks on she records the actual days and keeps the return. ───
  await story({ name: 'early', state: earlyState() }, 'p-desk', 'site', async (h) => {
    const { page } = h;
    const hire = '#page-site .fx-hire[data-request="FR-1001"]';
    T.section('Delivered early: on hire from the request\'s start (Lena, FR-1001, Customer Y, 9 Nov – 6 Dec)');
    await page.waitForSelector(hire, { timeout: 10000 });
    T.eq('the card: delivered early, the request\'s dates, on hire from 9 Nov', [await h.text(hire + ' .fx-early'), await h.text(hire + ' .fx-hire-requested'), await h.text(hire + ' .fx-hire-since')].map((x) => x.replace(/\s+/g, ' ')).join(' | '),
      'Delivered early on 2 Nov: on hire from 9 Nov | REQUESTED 9 Nov – 6 Dec 2026 28 days requested | ON HIRE FROM 9 Nov 2026 Starts in 7 days');
    T.eq('…the hours start at the hire\'s start: no day yet, no standard hours to record', [await h.text(hire + ' .fx-hours-notyet'), (await page.$$(hire + ' .fx-day')).length, !!(await page.$(hire + ' .fx-fill'))].join(' | '),
      'The hours start on 9 Nov 2026, the hire\'s start (delivered early on 2 Nov). | 0 | false');
    await widths(h, '#page-site', 'Receive, hours, moves with a unit delivered early');

    T.section('Return at 2 Nov: the request\'s end, the planned days, the estimated final bill');
    await h.ask(hire + ' .fx-mv-return', '#stReturn');
    T.eq('the return date: the request\'s end, not before the hire\'s start', [await page.inputValue('#stRetDate'), await page.getAttribute('#stRetDate', 'min'), await h.text('#stRetDates')].join(' | '),
      '2026-12-06 | 2026-11-09 | Requested 9 Nov – 6 Dec 2026 · on hire from 9 Nov (delivered early on 2 Nov)');
    T.eq('nothing to record yet, said so; the days planned', [await h.text('#stRetNotYet'), await h.text('#stRetRange')].join(' | '),
      'The hire starts on 9 Nov 2026 (delivered early on 2 Nov): no day to record yet. | 9 Nov – 6 Dec 2026 · 28 days (28 planned) · Weekend in United Arab Emirates: Sat–Sun');
    T.eq('the planned rows, prefilled with standard hours (the weekend empty), the return day last', await page.$$eval('#stRetRows .fx-sheet-row', (r) => r.slice(0, 7).concat(r.slice(-1)).map((x) => x.dataset.date.slice(5)
      + (x.className.includes('fx-sheet-row--planned') ? 'p' : '') + ':' + x.querySelector('[data-kind="usage"]').value + '/' + x.querySelector('[data-kind="standby"]').value + ':' + x.querySelector('.fx-chip').innerText.trim()
      + (x.querySelector('.fx-sheet-ret') ? ':R' : '')).join(' ')),
      '11-09p:8/0:Planned 11-10p:8/0:Planned 11-11p:8/0:Planned 11-12p:8/0:Planned 11-13p:8/0:Planned 11-14p:/:Planned 11-15p:/:Planned 12-06p:/:Planned:R');
    T.eq('the estimated final bill: 160 planned hours × AED 140, transport out and back, VAT; no minimum top-up', [await h.text('#stRetBillTitle'),
      await page.$$eval('#stRetBillRows .fx-bill-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' ; ')), await h.text('#stRetTotal'), await h.text('#stRetGross')].join(' | '),
      'ESTIMATED FINAL BILL | Rental, planned 9 Nov – 6 Dec 2026 · 160 h of use × AED 140.00 an hour (estimate) AED 22,400.00 ; Transport out to the site AED 2,200.00 ; Transport back when the yard collects it AED 2,200.00 | AED 26,800.00 | AED 28,140.00');
    T.eq('…the actual days and the planned ones apart', await page.$$eval('#stRetSplit .fx-ret-phase', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' / ')),
      'ACTUAL, UP TO TODAY None yet: the hire starts on 9 Nov 2026 (delivered early on 2 Nov) AED 0.00 / PLANNED, AN ESTIMATE 9 Nov – 6 Dec 2026 · 28 days · 160 h of use AED 22,400.00');
    T.check('…no agreement to tick before a day has passed', !(await page.$('#stRetApprove')));
    T.eq('Confirm books it', await h.text('#stRetConfirm'), 'Book the return for 6 Dec 2026');
    for (const w of [1440, 1024]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(400);
      const f = await h.dialogFits('#stReturn');
      T.check(`${w}px, the Return dialog with the estimate: no sideways scroll`, f.ok, f.over);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(300);
    T.check('screenshot: the estimated final bill at 2 Nov', !!(await h.env.shot('future-ops-return-estimate.png')));
    await h.confirmReturn();
    T.eq('the toast says the return is booked', await h.toast(), 'Return booked for 6 Dec 2026 (EX-1002). Until then, record the hours as the days pass; the final timesheet is asked for on the day.');
    let s = await h.state();
    let l = h.line(s, 'R1001');
    T.eq('the state: the return planned for 6 Dec, still on hire, no hours saved', [l.status, l.plannedReturn, s.hours.filter((x) => x.lineId === l.id).length].join(' | '), 'ON_HIRE | 2026-12-06 | 0');
    T.eq('the card says it', [await h.text(hire + ' .fx-planned'), await h.text(hire + ' .fx-mv-return')].join(' | '), 'Return planned for 6 Dec 2026 | Change the return…');

    T.section('A week and more on (+1 week, then to Sun 15 Nov): the actual days 9–15 Nov, the rest planned');
    await page.click('#fxWeek');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Mon 9 Nov 2026', null, { timeout: 5000 });
    for (let i = 0; i < 6; i++) { await page.click('#fxDay'); await page.waitForTimeout(250); }
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Sun 15 Nov 2026', null, { timeout: 5000 });
    await page.waitForTimeout(500);
    T.eq('the card: on hire since 9 Nov, the grid from the hire\'s start', [await h.text(hire + ' .fx-hire-since').then((x) => x.replace(/\s+/g, ' ')),
      await page.$$eval(hire + ' .fx-day', (d) => d.map((x) => x.dataset.date.slice(8)).join())].join(' | '), 'ON HIRE SINCE 9 Nov 2026 7 days on hire | 09,10,11,12,13,14,15');
    await h.ask(hire + ' .fx-mv-return', '#stReturn');
    T.eq('Return again: the booked date; 9–15 Nov actual and editable, then planned', [await page.inputValue('#stRetDate'),
      await page.$$eval('#stRetRows .fx-sheet-row:not(.fx-sheet-row--planned)', (r) => r.map((x) => x.dataset.date.slice(8) + ':' + x.querySelector('[data-kind="usage"]').value + (x.querySelector('input').disabled ? 'x' : '')).join(' ')),
      await page.$eval('#stRetRows .fx-sheet-row--planned', (x) => x.dataset.date), await h.text('#stRetRange')].join(' | '),
      '2026-12-06 | 09: 10: 11: 12: 13: 14: 15: | 2026-11-16 | 9 Nov – 6 Dec 2026 · 28 days (7 actual, 21 planned) · Weekend in United Arab Emirates: Sat–Sun');
    await page.click('#stRetFill');
    await page.waitForTimeout(400);
    await page.check('#stRetApprove');
    await page.waitForFunction(() => /agrees every day of it/.test(document.getElementById('stRetDoes').innerText), null, { timeout: 5000 });
    T.eq('filled and agreed: the actual days recorded, the planned ones an estimate', [await page.$$eval('#stRetRows .fx-sheet-row:not(.fx-sheet-row--planned)', (r) => r.map((x) => x.dataset.date.slice(8) + ':'
      + x.querySelector('[data-kind="usage"]').value + ':' + x.querySelector('.fx-chip').innerText.trim()).join(' ')), await h.text('#stRetSum')].join(' | '),
      '09:8:New 10:8:New 11:8:New 12:8:New 13:8:New 14::Weekend 15::Weekend | Actual: 5 days with hours · 40 h of use · 0 h of standby — Planned: 15 days with hours · 120 h of use · 0 h of standby (an estimate)');
    T.eq('…the estimate: 40 h actual, 120 h planned', [await page.$$eval('#stRetBillRows .fx-bill-row', (r) => r.slice(0, 2).map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' ; ')), await h.text('#stRetTotal')].join(' | '),
      'Rental, actual 9 Nov – 15 Nov 2026 · 40 h of use × AED 140.00 an hour AED 5,600.00 ; Rental, planned 16 Nov – 6 Dec 2026 · 120 h of use × AED 140.00 an hour (estimate) AED 16,800.00 | AED 26,800.00');
    T.eq('Confirm records them and keeps the return', await h.text('#stRetConfirm'), 'Record the hours, keep the return on 6 Dec 2026');
    for (const w of [1440, 1024]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(400);
      const f = await h.dialogFits('#stReturn');
      T.check(`${w}px, the Return dialog at 15 Nov: no sideways scroll`, f.ok, f.over);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(300);
    await page.$eval('#stReturn .nx-dialog-body', (b) => { b.scrollTop = 0; });
    await page.waitForTimeout(200);
    T.check('screenshot: the dialog at 15 Nov', !!(await h.env.shot('future-ops-return-actual.png')));
    await h.confirmReturn();
    T.eq('the toast', await h.toast(), 'Return booked for 6 Dec 2026 (EX-1002, 5 days of hours recorded and agreed). Until then, record the hours as the days pass; the final timesheet is asked for on the day.');
    s = await h.state();
    l = h.line(s, 'R1001');
    T.eq('the state: 9–13 Nov saved and approved (signed by the customer), the return still planned for 6 Dec', [s.hours.filter((x) => x.lineId === l.id).map((x) => x.date.slice(8) + ':' + x.usage + (x.approved ? ':' + x.approvedBy : '')).join(' | '),
      l.status, l.plannedReturn].join(' | '),
      '09:8:Lena Novak (signed by the customer) | 10:8:Lena Novak (signed by the customer) | 11:8:Lena Novak (signed by the customer) | 12:8:Lena Novak (signed by the customer) | 13:8:Lena Novak (signed by the customer) | ON_HIRE | 2026-12-06');
    await widths(h, '#page-site', 'Receive, hours, moves at 15 Nov');
  });

  // ── 'fresh': Sara switches an intercompany agreement to billing by the hour (a new version) ─────────────────────────
  await story('fresh', 'p-fin', 'setup', async (h) => {
    const { page } = h;
    T.section('Setup: billed by the hour (timesheet) or by the day (Sara)');
    await page.click('#setupSections .fx-section[data-value="agreements"]');
    const ag = '#setupAgreements .fx-ag[data-agreement="ICA-01"]';
    await page.waitForSelector(ag);
    T.eq('each agreement says how it bills', await page.$$eval('#setupAgreements .fx-ag', (a) => a.map((x) => x.dataset.agreement + ': ' + x.querySelector('.fx-ag-billing-chip').innerText.trim()).join(' | ')),
      'ICA-01: Billed by the day | ICA-02: Billed by the day | ICA-03: Billed by the day | XCA-01: Billed by the day | RA-01: Billed by the hour (timesheet) | RA-02: Billed by the hour (timesheet)');
    T.eq('…the hour rate per class, next to the day and the week', await page.$eval(ag + ' .fx-rate[data-cls="EXC"] .fx-rate-hour', (x) => x.innerText.trim()), 'AED 100.00');
    T.check('…what switching does, before it is done', (await h.text(ag + ' .fx-ag-billing-what')).startsWith('Switching makes ICA-FC-PC-2026 version 2 from 2 Nov 2026: billed by the hour from the approved timesheets'));
    await page.click(ag + ' .fx-billing');
    await page.waitForFunction((q) => { const v = document.querySelector(q + ' .fx-ag-version'); return v && v.innerText.trim() === 'v2'; }, ag, { timeout: 10000 });
    await page.waitForTimeout(300);
    const s = await h.state();
    const a = s.agreements.find((x) => x.id === 'ICA-01');
    T.eq('switched: version 2, by the hour, 16 hours at least', [a.version, a.billing, a.minHours, a.versions[a.versions.length - 1].note].join(' | '), '2 | HOURLY | 16 | Billing daily → hourly');
    T.eq('…the card says so, and offers the way back', [await h.text(ag + ' .fx-ag-billing-chip'), await h.text(ag + ' .fx-billing')].join(' | '), 'Billed by the hour (timesheet) | Bill by the day');
    T.check('…the toast', (await h.toast()).includes('ICA-FC-PC-2026 v2: billed by the hour (timesheets)'), await h.toast());
    await widths(h, '#page-setup', 'Setup, agreements');
    T.check('screenshot', !!(await h.shotFull('future-setup-billing.png')));
  });

  T.report();
})();
