'use strict';
/*
 * EquipRite Future · Requests in a real browser, played as the people who use them (FDD v2.0):
 *   fresh as Priya    New request for PC-INT-014 with a FleetCo excavator: the sourcing cards (own fleet first, the IC
 *                     price, the estimate), what will happen, Submit, the new request's tab; as Faisal the KSA project
 *                     (a unit blocked by its certificate for Saudi Arabia); as Lena a customer on credit hold (the
 *                     failure stays in words); as Priya again a request above the threshold, approved by her BU.
 *   invoiced as Priya My requests: ProjectCo Projects' requests only (not the KSA one), chips, search, export; the r1
 *                     tab's Money: the IC AR and AP done, settlement to do, and where it happens; another BU's request
 *                     hidden.
 *   settled as Admin  the accounting shown: both companies' entries, domestic and cross-border.
 *   returned as Priya r1 is financially complete.
 * No sideways scroll at 1440 and 1024 px, no browser errors, no backend call. Needs `npm run build`.
 * Run: node tests/e2e/future-requests.e2e.js
 */
const fs = require('fs');
const E = require('./harness');
const H = require('../_harness');
const F = require('./future-fixture');

const T = H.makeAsserter();
const PORT = 19610;
const NAMES = { 'p-pm': 'Priya Raman', 'p-pk': 'Faisal Al-Qahtani', 'p-desk': 'Lena Novak', 'p-fin': 'Sara Ahmed', 'p-admin': 'Admin' };

function kit(env) {
  const { page } = env;
  const k = {
    stored: () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), F.KEY),
    currentTab: () => page.$eval('.nx-tab--on', (t) => t.dataset.tabId),
    toast: async () => ((await page.$('#nxToast')) ? env.text('#nxToast') : ''),
    waitTab: (id) => page.waitForFunction((x) => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === x; }, id, { timeout: 15000 }),
    playAs: async (id) => {
      await page.click('#fxPersona');
      await page.waitForSelector('#fxPersonaPanel');
      await page.click(`#fxPersonaPanel .fx-person[data-id="${id}"]`);
      await page.waitForFunction((n) => { const e = document.getElementById('fxPersonaName'); return e && e.innerText.trim() === n; }, NAMES[id], { timeout: 10000 });
      await page.waitForTimeout(400);
    },
    /** A screenshot of the whole screen: the window made as tall as the tab's content, then back. */
    shot: async (name) => {
      await page.waitForTimeout(300);
      const vp = page.viewportSize();
      const h = await page.evaluate(() => { const c = document.querySelector('.nx-content'); return c ? c.scrollHeight + (window.innerHeight - c.clientHeight) : 1000; });
      await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 4000) });
      await page.waitForTimeout(250);
      const f = await env.shot(name);
      await page.setViewportSize(vp);
      return f;
    },
    fits: async (label) => {
      for (const w of [1440, 1024]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(300);
        T.check(`${w}px, ${label}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
          && document.querySelector('.nx-content').scrollWidth <= document.querySelector('.nx-content').clientWidth + 1));
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForTimeout(200);
    },
    pick: async (sel) => { await page.click(sel); await page.waitForTimeout(250); },
    download: async (format) => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click(`.nx-menu [data-format="${format}"]`)]);
      return fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
    }
  };
  return k;
}

async function run(point, persona, title, fn, prepare) {
  const s = F.state(point);
  if (prepare) prepare(s);
  const env = await E.start({ port: PORT, app: 'future', init: F.init(s, persona) });
  T.section(title);
  try {
    await fn(env, kit(env), F.ids(s));
  } catch (e) {
    T.check(point + ': run finished', false, e.message);
    await env.shot(`future-requests-${point}-failed.png`).catch(() => {});
  } finally {
    T.eq(point + ': no call to any backend', env.calls.join('\n'), '');
    T.eq(point + ': no browser errors or warnings', env.errors.join('\n'), '');
    await env.close();
  }
}

(async () => {
  const shots = [];

  // ── fresh: raising requests ──────────────────────────────────────────────────────────────────────────────
  await run('fresh', 'p-pm', 'fresh as Priya: New request for PC-INT-014 with a FleetCo excavator', async (env, k) => {
    const { page } = env;
    await env.open('/?open=new-request');
    await page.waitForSelector('#page-new-request #nrSteps', { timeout: 30000 });
    T.eq('three steps, the first one current', await page.$$eval('#nrSteps .fx-nr-stepbtn', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ').trim() + (x.getAttribute('aria-current') === 'step' ? '*' : '')).join(' | ')), '1 For* | 2 Equipment | 3 Review');
    T.eq('the requesting BU: Priya\'s only one, shown, not chosen', await env.text('#nrBu'), 'ProjectCo Projects · ProjectCo Contracting LLC (United Arab Emirates, AED)');
    T.eq('for: its projects, internal or customer', await page.$$eval('#nrOptions .fx-nr-option', (o) => o.map((x) => x.querySelector('.fx-chip').innerText.trim() + ': ' + x.querySelector('.fx-nr-option-title').innerText.trim()).join(' ; ')),
      'Internal project: PC-INT-014 · ProjectCo head office fit-out ; Customer project: PC-C-2207 · Marina Tower (Customer X)');
    T.check('nothing chosen yet: it says so, and the next step waits', (await env.text('#nrForHint')).startsWith('Choose what the equipment is for') && await page.isDisabled('#nrToEquipment'));
    await k.pick('#nrOptions [data-value="P:P-INT"]');
    await page.fill('#nrFrom', '2026-10-30');
    await page.waitForTimeout(250);
    T.eq('a start before the demo\'s today is refused in words', await env.text('.fx-nr-dateerror'), 'The start cannot be before the demo\'s today, 2 Nov 2026.');
    await page.fill('#nrFrom', '2026-11-03');
    await page.fill('#nrTo', '2026-12-20');
    await page.waitForTimeout(300);
    T.eq('the dates', await env.text('#nrDays'), '48 days: 3 Nov 2026 to 20 Dec 2026');
    T.eq('the site and its country', await env.text('#nrSiteFacts'), 'SITE Business Bay, Dubai · United Arab Emirates ITS COUNTRY United Arab Emirates: AED, VAT 5 %, weekend Sat–Sun');
    T.eq('the project\'s tasks, the first chosen', await page.$$eval('#nrTasks .nx-chip', (c) => c.map((x) => x.innerText.trim() + (x.classList.contains('nx-chip--on') ? '*' : '')).join(', ')), '1.1 Site works*, 1.2 MEP');
    shots.push(await k.shot('future-new-request-for.png'));

    await k.pick('#nrToEquipment');
    await page.waitForSelector('#nrStepEquipment');
    await k.pick('#nrClasses [data-cls="GEN"]');
    T.eq('generators: own fleet first, then same company, then FleetCo', await page.$$eval('#nrGroups .fx-nr-group', (g) => g.map((x) => x.querySelector('.fx-nr-group-title').innerText.trim() + ' (' + x.querySelector('.fx-chip').innerText.trim() + ')').join(' ; ')),
      'Your own fleet · ProjectCo Projects (Own fleet) ; FleetCo Fleet · FleetCo (Intercompany · domestic)');
    T.check('…own equipment at its internal cost rate, no invoice', (await env.text('#nrGroups .fx-nr-card[data-unit="GN-3901"]')).includes('Own equipment: internal cost rate'));
    await k.pick('#nrClasses [data-cls="EXC"]');
    const ex1 = await env.text('#nrGroups .fx-nr-card[data-unit="EX-1001"]');
    T.check('an excavator: owner FleetCo, intercompany, asset, the yard, lead time', ['Owner: FleetCo Fleet · FleetCo', 'Intercompany · domestic', 'Asset · FA-10021', 'FleetCo Jebel Ali Yard · United Arab Emirates',
      'Lead time 2 days: on site from 4 Nov 2026'].every((x) => ex1.includes(x)), ex1);
    T.check('…the IC agreement\'s price, and the estimate for 48 days', ['AED 3,500.00 a week · AED 800.00 a day', 'Intercompany agreement ICA-FC-PC-2026 v1', 'AED 24,500.00', 'for 48 days', 'Usable · Third-party inspection for the United Arab Emirates to 30 Jun 2027']
      .every((x) => ex1.includes(x)), ex1);
    await k.pick('#nrGroups .fx-nr-card[data-unit="EX-1001"] .fx-nr-add');
    T.eq('added: the card says so, the request holds it', [await env.text('#nrGroups .fx-nr-card[data-unit="EX-1001"] .fx-nr-card-act'), await page.$$eval('#nrCart .fx-nr-cartlist li', (l) => l.map((x) => x.dataset.unit).join()), await env.text('#nrCartTotal')].join(' | '),
      'Added Remove | EX-1001 | AED 24,500.00');
    shots.push(await k.shot('future-new-request-equipment.png'));
    await k.fits('New request, equipment');

    await k.pick('#nrToReview');
    await page.waitForSelector('#nrStepReview');
    T.eq('review: grouped by owner', await page.$$eval('#nrReview .fx-nr-owner h3', (h) => h.map((x) => x.innerText.trim()).join()), 'FleetCo Fleet · FleetCo');
    const happen = await env.text('#nrReview .fx-nr-happen');
    T.check('…what will happen: FleetCo approves (Ana), its yard ships, the invoice pair coded to the project, VAT, terms',
      ['APPROVES FleetCo Fleet, the owner, approves and allocates each unit in Approve & allocate (Ana Costa, Equipment Manager · FleetCo).',
        'an AR invoice in FleetCo and an AP invoice in ProjectCo coded to PC-INT-014', 'Domestic: VAT at 5 %', 'transport AED 1,500.00 each way'].every((x) => happen.includes(x)), happen);
    T.eq('…the estimated total', await env.text('#nrTotal'), 'AED 24,500.00');
    T.check('…and what Submit does, and that nothing goes to Fusion yet', (await env.text('#nrSubmitText')).includes('EquipRite records it; nothing goes to Fusion yet'));
    shots.push(await k.shot('future-new-request-review.png'));
    await k.fits('New request, review');

    await page.click('#nrSubmit');
    await k.waitTab('request:R1001');
    await page.waitForSelector('#page-request #recTitle', { timeout: 15000 });
    T.check('Submit raises it and opens its tab', (await env.text('#recTitle')).startsWith('FR-1001'));
    T.check('…the toast says what happened', (await k.toast()).includes('Raised FR-1001 for ProjectCo Projects · PC-INT-014.'), await k.toast());
    let st = await k.stored();
    const r = st.requests[0];
    T.eq('…in the state: ProjectCo Projects, PC-INT-014, FleetCo\'s EX-1001, intercompany, waiting for the owner',
      [r.number, r.requestingBu, r.projectId, r.task, r.from, r.to, r.lines.map((l) => l.preferredUnit + ' ' + l.provider + ' ' + l.relation + ' ' + l.status).join()].join(' | '),
      'FR-1001 | BU-PC | P-INT | 1.1 Site works | 2026-11-03 | 2026-12-20 | U-EX1 BU-FC IC_DOMESTIC REQUESTED');
    T.eq('the tab: the owner approves next, in Approve & allocate (Priya plays Ana there)', await env.text('#recLines .fx-rec-linenext'), 'Next FleetCo Fleet approves and allocates a unit Play as Ana and open Approve & allocate');
    T.eq('…money: nothing to do yet', await env.text('#recFinBadge'), 'Next: Equipment back and inspected · Owner\'s yard');
    await page.click('.nx-tab-btn[data-id="new-request"]');
    await page.waitForSelector('#nrSent');
    T.check('New request starts again, saying what was raised', (await env.text('#nrSent')).startsWith('FR-1001 is raised for ProjectCo Projects'));

    T.section('fresh as Faisal: the KSA project, a unit blocked by its certificate');
    await k.playAs('p-pk');
    await page.click('.nx-tab-btn[data-id="request:R1001"]');
    await page.waitForSelector('#requestHidden');
    T.eq('FR-1001 is not his BU\'s: hidden', (await env.text('#requestHidden')).split('.')[0], 'This request belongs to other business units');
    await page.click('.nx-tab-btn[data-id="new-request"]');
    await page.waitForSelector('#nrOptions');
    T.eq('his one BU and project, chosen for him', [await env.text('#nrBu'), await page.$$eval('#nrOptions .fx-nr-option--on .fx-nr-option-title', (o) => o.map((x) => x.innerText.trim()).join())].join(' | '),
      'ProjectCo KSA Projects · ProjectCo Arabia Ltd (Saudi Arabia, SAR) | PK-C-0310 · Riyadh Metro Depot (Customer Z)');
    await page.fill('#nrFrom', '2026-11-09');
    await page.fill('#nrTo', '2026-12-31');
    await page.waitForTimeout(250);
    await k.pick('#nrToEquipment');
    await k.pick('#nrClasses [data-cls="EXC"]');
    T.eq('FleetCo\'s excavators across the border: usable, or exactly why not', await page.$$eval('#nrGroups .fx-nr-card', (c) => c.map((x) => x.dataset.unit + ': '
      + (x.querySelector('.fx-nr-why') ? x.querySelector('.fx-nr-why').innerText.trim() : 'usable')).join(' ; ')),
      'EX-1001: usable ; EX-1002: Not usable: No certificate for Saudi Arabia (MC-FR-18) ; EX-1003: Not usable: Its SASO conformity for Saudi Arabia expires 20 Nov 2026, before the hire ends on 31 Dec 2026 (MC-FR-18)');
    T.check('…a blocked unit cannot be added', await page.isDisabled('#nrGroups .fx-nr-card[data-unit="EX-1003"] .fx-nr-add'));
    const ksa = await env.text('#nrGroups .fx-nr-card[data-unit="EX-1001"]');
    T.check('…priced in AED (the agreement), estimated in SAR at today\'s rate', ksa.includes('AED 3,500.00 a week') && /SAR [\d,]+\.\d\d/.test(ksa) && ksa.includes('estimate at today\'s rate')
      && ksa.includes('Intercompany · cross-border'), ksa);
    shots.push(await k.shot('future-new-request-ksa.png'));

    T.section('fresh as Lena: a customer on credit hold, the failure stays in words');
    await k.playAs('p-desk');
    await page.click('.nx-tab-btn[data-id="new-request"]');
    await page.waitForSelector('#nrOptions');
    T.eq('the rental desk rents to FleetCo\'s customers', await page.$$eval('#nrOptions .fx-nr-option-title', (o) => o.map((x) => x.innerText.trim()).join(' ; ')),
      'Customer Y · Gulf Builders ; Customer W · Oman Roads (credit hold)');
    await k.pick('#nrOptions [data-value="C:C-W"]');
    T.check('Customer W: on credit hold, said before anything', (await env.text('#nrHold')).includes('on credit hold in Fusion Receivables'));
    await k.pick('#nrToEquipment');
    await k.pick('#nrClasses [data-cls="GEN"]');
    T.check('…its rental agreement\'s rates', (await env.text('#nrGroups .fx-nr-card[data-unit="GN-3001"]')).includes('Customer agreement RA-FC-W-2026 v1'));
    await k.pick('#nrGroups .fx-nr-card[data-unit="GN-3001"] .fx-nr-add');
    await k.pick('#nrToReview');
    T.check('…the review: a customer rental, FleetCo invoices the customer, no intercompany', (await env.text('#nrReview')).includes('No intercompany'));
    await page.click('#nrSubmit');
    await page.waitForSelector('#nrFailure', { timeout: 10000 });
    T.check('Submit refused: the engine\'s words stay on the page', (await env.text('#nrFailure')).startsWith('Not raised, nothing changed: Customer W · Oman Roads (credit hold) is on credit hold in Fusion Receivables (INT-26)'), await env.text('#nrFailure'));
    st = await k.stored();
    T.eq('…and nothing changed', st.requests.length, 1);
    shots.push(await k.shot('future-new-request-failure.png'));

    T.section('fresh as Priya: above the threshold, her BU approves first (OD-12)');
    await k.playAs('p-pm');
    await page.click('.nx-tab-btn[data-id="new-request"]');
    await page.waitForSelector('#nrOptions');
    await k.pick('#nrOptions [data-value="P:P-EXT"]');
    await page.fill('#nrFrom', '2026-11-03');
    await page.fill('#nrTo', '2027-01-31');
    await page.waitForTimeout(250);
    await k.pick('#nrToEquipment');
    await k.pick('#nrClasses [data-cls="CRN"]');
    await k.pick('#nrGroups .fx-nr-card[data-unit="CR-2001"] .fx-nr-add');
    await k.pick('#nrToReview');
    T.check('the review says ProjectCo Projects approves it first, and how Customer X is billed', (await env.text('#nrStepReview')).includes('Over AED 50,000.00: ProjectCo Projects approves it first')
      && (await env.text('#nrStepReview')).includes('ProjectCo bills Customer X · Marina Developments for it under the project contract'));
    await page.click('#nrSubmit');
    await k.waitTab('request:R1002');
    await page.waitForSelector('#recApprove');
    T.check('its tab: Priya\'s approve button, saying what it does', (await env.text('#recApproveCard')).includes('agrees to this request above its threshold of AED 50,000.00'));
    T.eq('…waiting for her BU', (await k.stored()).requests[1].status, 'AWAITING_REQUESTER_APPROVAL');
    await page.click('#recApprove');
    await page.waitForFunction(() => !document.getElementById('recApprove'), null, { timeout: 10000 });
    T.eq('approved: the owners now see it', (await k.stored()).requests[1].status, 'SUBMITTED');
    T.check('…the toast says so', (await k.toast()).includes('Approved FR-1002 above the threshold.'), await k.toast());
    await k.fits('a request\'s tab');
  }, (s) => { s.settings.requesterApproval = true; });

  // ── invoiced: My requests and the money of r1 ───────────────────────────────────────────────────────────
  await run('invoiced', 'p-pm', 'invoiced as Priya: My requests and the money of a request', async (env, k, ids) => {
    const { page } = env;
    await env.open('/?open=requests');
    await page.waitForSelector('#page-requests #rqRows', { timeout: 30000 });
    T.eq('whose requests: ProjectCo Projects\'', await env.text('#rqScope'), 'Requests of ProjectCo Projects · 3 requests');
    const rows = () => page.$$eval('#rqRows .fx-rq-row', (r) => r.map((x) => x.dataset.number).join());
    T.eq('…its three, never the KSA one or FleetCo\'s rental', await rows(), 'FR-1005,FR-1002,FR-1001');
    T.eq('chips: All, Open, Money not complete', await page.$$eval('#rqChips .nx-chip', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')), 'All 3 | Open 3 | Money not complete 3');
    const r1 = await env.text(`#rqRows .fx-rq-row[data-id="${ids.r1}"]`);
    T.check('a row: number, type, project, BU and company, owner, relationship, stage, money, cost', ['FR-1001', 'Internal project', 'PC-INT-014 · ProjectCo head office fit-out', 'ProjectCo Projects',
      'FleetCo Fleet · FleetCo', 'Intercompany · domestic', 'On hire', '4 of 7', 'Next: Equipment back and inspected · Owner\'s yard', 'AED 15,000.00'].every((x) => r1.includes(x)), r1);
    T.eq('…same company: its chip', await env.text(`#rqRows .fx-rq-row[data-id="${ids.rl}"] .fx-rq-chips`), 'Same company · cross-charge');
    await page.fill('#rqSearch', 'cr-2001');
    await page.waitForTimeout(300);
    T.eq('search: by unit', await rows(), 'FR-1002');
    await page.fill('#rqSearch', '');
    await page.waitForTimeout(300);
    await page.click('#rqExport');
    const csv = await k.download('csv');
    const lines = csv.trim().split(/\r\n/);
    T.check('export: the rows as shown, with their money', lines.length === 4 && lines[0].startsWith('Request,Type,Project or customer,Requesting BU,Company,Owners,Relationships') && lines.some((x) => x.startsWith('FR-1001,Internal project')), lines[0]);
    shots.push(await k.shot('future-my-requests.png'));
    await k.fits('My requests');

    await page.click(`#rqRows .fx-rq-row[data-id="${ids.r1}"]`);
    await k.waitTab('request:R1001');
    await page.waitForSelector('#page-request #recTabs');
    T.eq('the head band: what, for whom, where, when', [await env.text('#recKicker'), await env.text('#recParty'), await env.text('#recFacts')].join(' | '),
      'INTERNAL PROJECT · REQUESTED BY PROJECTCO PROJECTS | Project: PC-INT-014 · ProjectCo head office fit-out · task 1.1 Site works | REQUESTING BU ProjectCo Projects · ProjectCo Contracting LLC SITE Business Bay, Dubai · United Arab Emirates DATES 3 Nov 2026 to 20 Dec 2026 OWNERS FleetCo Fleet · FleetCo · Intercompany · domestic');
    const eq = await env.text('#recLines');
    T.check('Equipment: the unit, the agreement and price, events in order, hours', ['EX-1001 · CAT 320 Excavator', 'ICA-FC-PC-2026 v1 (intercompany agreement)', 'AED 3,500.00 a week · AED 800.00 a day',
      'Requested 2 Nov 2026 Approved and allocated 2 Nov 2026 Shipped 2 Nov 2026 On hire 7 Nov 2026', '16 days of hours: 116 h worked, 12 h standby, all approved', 'Not needed: it stays in one country'].every((x) => eq.includes(x)), eq);
    await page.click('#recTab-money');
    await page.waitForSelector('#recFinance');
    const state = (key) => env.text(`#recFinance [data-key="${key}"] .fx-fin-state`);
    T.eq('Money: the IC AR and AP done, settlement to do', [await state('ar'), await state('ap'), await state('cost'), await state('settled')].join(), 'Done,Done,Done,To do');
    T.check('…each with who does it and its number', (await env.text('#recFinance [data-key="ar"]')).includes('Intercompany AR invoice in the owner (FleetCo) By IC finance (workbench) · FL-ICAR-000101'));
    T.eq('…settlement happens in the workbench: Priya plays Sara there', await env.text('#recFinance [data-key="settled"] .fx-fin-go'), 'Play as Sara and open Intercompany workbench');
    T.eq('the charges', await page.$$eval('#recCharges .nx-row:not(.nx-row--head)', (r) => r.map((x) => x.querySelector('.fx-ch-kind .nx-cell-main').innerText.trim() + ' ' + x.querySelector('.fx-ch-amt').innerText.trim()).join(' ; ')),
      'Rental AED 12,900.00 ; Standby AED 600.00 ; Transport AED 1,500.00');
    T.check('…each with its AR and AP numbers', (await env.text('#recCharges [data-charge="CH00001"] .fx-ch-inv')) === 'AR FL-ICAR-000101 AP FL-ICAR-000101', await env.text('#recCharges [data-charge="CH00001"] .fx-ch-inv'));
    T.eq('totals per company', await page.$$eval('#recCompanies .fx-rec-company', (c) => c.map((x) => x.querySelector('b').innerText.trim()).join()), 'FleetCo,ProjectCo');
    shots.push(await k.shot('future-request-money.png'));
    await page.click('#recExport');
    const charges = (await k.download('csv')).trim().split(/\r\n/);
    T.check('export of the tab shown: the charges', charges.length === 4 && /^Period,Kind,What,Unit,Project/.test(charges[0]), charges[0]);
    await page.click('#recTab-accounting');
    await page.waitForSelector('#recAccounting');
    T.eq('Accounting (shown): the note', (await env.text('#recShownNote')).split('.')[0], 'Fusion makes these entries; EquipRite creates the transactions and shows them');
    T.check('…the invoice shared with FR-1002 says so', (await env.text('#recAccounting')).includes('Covers other requests too (FR-1002): this request\'s part is AED 15,000.00 net'));
    await page.click('#recTab-history');
    T.check('History: raised by Priya', (await env.text('#recHistory')).includes('Raised FR-1001 for ProjectCo Projects · PC-INT-014'));
    await k.fits('a request\'s tab');

    await page.click('#recTab-money');
    await page.click('#recFinance [data-key="settled"] .fx-play');
    await k.waitTab('ic-workbench');
    T.eq('Play as Sara and open the workbench: one click', await env.text('#fxPersonaName'), 'Sara Ahmed');
    await k.playAs('p-pm');

    await env.open(`/?open=request&id=${ids.rk}`);
    await page.waitForSelector('#requestHidden', { timeout: 20000 });
    T.eq('the KSA request: hidden from Priya', (await env.text('#requestHidden')).split('.')[0], 'This request belongs to other business units');
  });

  // ── settled: the accounting shown ─────────────────────────────────────────────────────────────────────
  await run('settled', 'p-admin', 'settled as Admin: the accounting shows both companies\' entries', async (env, k, ids) => {
    const { page } = env;
    await env.open(`/?open=request&id=${ids.r1}`);
    await page.waitForSelector('#page-request #recTabs', { timeout: 30000 });
    await page.click('#recTab-accounting');
    await page.waitForSelector('#recAccounting .fx-acc-company');
    const txs = (le) => page.$$eval(`#recAccounting .fx-acc-company[data-le="${le}"] .fx-acc-txkind`, (t) => t.map((x) => x.innerText.trim()).join(', '));
    T.eq('FleetCo: its AR invoice and the netting', await txs('LE-FC'), 'Asset location, Intercompany AR invoice, Settlement / netting');
    T.eq('ProjectCo: its AP invoice, the project cost, the netting', await txs('LE-PC'), 'Intercompany AP invoice, Project cost (PPM), Settlement / netting');
    const ar = await env.text('#recAccounting .fx-acc-tx[data-tx="FL-ICAR-000101"]');
    T.check('…with Dr/Cr lines, balanced', ar.includes('1210 Intercompany receivable · ProjectCo 76,387.50') && ar.includes('4110 Intercompany rental revenue') && ar.includes('(balanced)'), ar);
    T.check('…and who makes it in Fusion', ar.includes('Fusion Receivables: intercompany invoice (INT-10)'));
    shots.push(await k.shot('future-request-accounting.png'));
    await env.open(`/?open=request&id=${ids.rk}`);
    await page.waitForSelector('#page-request #recTabs', { timeout: 30000 });
    await page.click('#recTab-accounting');
    await page.waitForSelector('#recAccounting .fx-acc-company');
    T.eq('cross-border: FleetCo and ProjectCo KSA', await page.$$eval('#recAccounting .fx-acc-company', (c) => c.map((x) => x.dataset.le).join()), 'LE-FC,LE-PK');
    T.check('…the AP entered in AED, booked in SAR at the rate', /Entered AED 6,825\.00 · rate 1\.\d+ · booked in SAR/.test(await env.text('#recAccounting .fx-acc-company[data-le="LE-PK"]')));
    await page.click('#recTab-equipment');
    T.check('…the customs record of the line', (await env.text('#recLines')).includes('Temporary import TI-SA-00001: United Arab Emirates → Saudi Arabia'));
    await k.fits('the accounting');
  });

  // ── returned: complete ──────────────────────────────────────────────────────────────────────────────────
  await run('closed', 'p-pm', 'closed as Priya: r1 is financially complete', async (env, k, ids) => {
    const { page } = env;
    await env.open('/?open=requests');
    await page.waitForSelector('#page-requests #rqRows', { timeout: 30000 });
    T.check('My requests: FR-1001 financially complete', (await env.text(`#rqRows .fx-rq-row[data-id="${ids.r1}"] .fx-rq-c-money`)).startsWith('Financially complete 7 of 7'));
    await page.click('#rqChips [data-chip="unfinished"]');
    await page.waitForTimeout(300);
    T.eq('Money not complete: the others only', await page.$$eval('#rqRows .fx-rq-row', (r) => r.map((x) => x.dataset.number).join()), 'FR-1005,FR-1002');
    await page.click('#rqChips [data-chip="all"]');
    await page.waitForTimeout(300);
    shots.push(await k.shot('future-my-requests-complete.png'));
    await page.click(`#rqRows .fx-rq-row[data-id="${ids.r1}"]`);
    await k.waitTab('request:R1001');
    await page.waitForSelector('#recFinBadge');
    T.eq('its tab: Financially complete', await env.text('#recFinBadge'), 'Financially complete');
    T.check('…inspected and back', (await env.text('#recLines')).includes('Inspected 30 Nov 2026 by Ravi Kumar: pass'));
    await page.click('#recTab-money');
    await page.waitForSelector('#recFinance .fx-fin-state');
    T.eq('…every step done', await page.$$eval('#recFinance .fx-fin-state', (s) => s.map((x) => x.innerText.trim()).filter((x, i, a) => a.indexOf(x) === i).join()), 'Done');
    shots.push(await k.shot('future-request-complete.png'));
  });

  console.log('\nScreenshots:\n' + shots.join('\n'));
  T.report();
})();
