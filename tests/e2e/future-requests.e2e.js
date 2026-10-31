'use strict';
/*
 * EquipRite Future · Requests in a real browser, played as the people who use them (FDD v2.0):
 *   fresh as Priya    New request for PC-INT-014 with a FleetCo excavator, sourced from any company in the group (the
 *                     default of Source from): the sourcing cards (own fleet first, the IC price, the estimate), the
 *                     head "Requested by … → sourced from …", what will happen, Submit, the new request's tab; as Faisal
 *                     the KSA project (Source from: FleetCo across the border; a unit blocked by its certificate for
 *                     Saudi Arabia); as Lena a customer on credit hold (Source from: her own fleet only; the failure
 *                     stays in words); as Priya again a request above the threshold, approved by her BU.
 *   fresh as Priya    Source from FleetCo on step 1: its card (relationship, money, lead time, agreement, units free),
 *                     step 2 shows only FleetCo's units and says so, Show every company and back, the review's
 *                     "Requested by … → Sourced from …", Submit: the line's provider is BU-FC.
 *   fresh as Lena     a rental for Customer Y: the tab opens on Approval & flow; Ana is the approver; the deposit is
 *                     next and it is Lena's ("It's you"), "Here now" on it in the customer's lane; she takes it in
 *                     Customer billing; then Ana's approval is current, the flag in FleetCo's lane, and "Play as Ana"
 *                     switches the persona and opens Approve & allocate.
 *   onHire as Priya   My requests: the journey as dots, "Here now: the hours · Priya Raman"; r1's flow: approved by
 *                     Ana Costa with the date, shipped, received; the flag on the hours in ProjectCo's lane.
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
const SOURCES_PRIYA = 'Any company in the group (Every allowed owner)* ; ProjectCo Projects (Own fleet) ; ProjectCo Facilities (Same company · cross-charge) ; FleetCo Fleet (Intercompany · domestic)';
const NAMES = { 'p-pm': 'Priya Raman', 'p-pk': 'Faisal Al-Qahtani', 'p-desk': 'Lena Novak', 'p-fin': 'Sara Ahmed', 'p-em': 'Ana Costa', 'p-admin': 'Admin' };

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
    /** Step 1's Source from cards: "name (relationship)", the one chosen marked *. */
    sources: () => page.$$eval('#nrSources .fx-nr-source', (c) => c.map((x) => x.querySelector('.fx-nr-source-name').innerText.trim() + ' (' + x.querySelector('.fx-chip').innerText.trim() + ')'
      + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' ; ')),
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
    T.eq('Source from: who lends the equipment', await env.text('#nrSourceTitle'), 'Sourcing business unit: who lends the equipment');
    T.eq('…Any company in the group (the default), own fleet, ProjectCo Facilities, FleetCo Fleet', await k.sources(), SOURCES_PRIYA);
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
    T.eq('step 2\'s head: requested by → sourced from any company in the group', await env.text('#nrRoute'), 'Requested by ProjectCo Projects (ProjectCo) → sourced from any company in the group');
    T.eq('…every company\'s units, nothing to undo', [await env.text('#nrShownText'), !!(await page.$('#nrShowAll'))].join(' | '), 'Units of every company you may source from, own fleet first | false');
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
    T.eq('…the head, and the group: requested by → sourced from', [await env.text('#nrReviewRoute'), await env.text('#nrReview .fx-nr-owner-route'), await env.text('#nrSourcing')].join(' | '),
      'Requested by ProjectCo Projects (ProjectCo) → sourced from any company in the group | Requested by ProjectCo Projects (ProjectCo) → Sourced from FleetCo Fleet (FleetCo) | FleetCo Fleet · FleetCo');
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
    T.eq('the tab opens on Approval & flow: not on hire yet', await page.getAttribute('#recTab-flow', 'aria-selected'), 'true');
    T.eq('…who approves, in words', await env.text('#recApproverText'), 'Approver: Ana Costa (Equipment Manager, FleetCo Fleet), the owner of EX-1001.');
    T.eq('…the head names the real next step and who does it', await env.text('#recFinBadge'), 'Next: approval · Ana Costa, Equipment Manager');
    await page.click('#recTab-equipment');
    await page.waitForSelector('#recLines');
    T.eq('Equipment: the approver and the next step, in short', [await env.text('#recCompactApprover'), await env.text('#recCompactNext')].join(' | '),
      'Ana Costa (Equipment Manager, FleetCo Fleet) | Owner approves and allocates · Ana Costa, Equipment Manager');
    T.eq('…the owner approves next, in Approve & allocate (Priya plays Ana there)', await env.text('#recLines .fx-rec-linenext'), 'Next FleetCo Fleet approves and allocates a unit Play as Ana and open Approve & allocate');
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
    T.eq('Source from: FleetCo Fleet across the border, plus Any', await k.sources(), 'Any company in the group (Every allowed owner)* ; FleetCo Fleet (Intercompany · cross-border)');
    const xbCard = await env.text('#nrSources [data-source="BU-FC"]');
    T.check('…the money across the border, its lead time and agreement', ['Invoice pair in AED without VAT: ProjectCo KSA self-assesses 15 % and withholds 5 %; customs at the border', 'Lead time 7 days',
      'ICA-FC-PK-2026 v1'].every((x) => xbCard.includes(x)), xbCard);
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
    T.eq('Source from: her own fleet only, and why', [await k.sources(), await env.text('#nrSourceNote')].join(' | '),
      'FleetCo Fleet (Customer rental)* | A customer rental always comes from the owner itself: FleetCo Fleet rents out its own units, never another company’s.');
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
    await page.waitForSelector('#recFlow .fx-fs[data-key="requester"]');
    T.check('…the flow: ProjectCo Projects approves first, and it\'s Priya', (await env.text('#recFlow .fx-fs[data-key="requester"]')).includes('Now')
      && (await env.text('#recFlow .fx-fs[data-key="requester"] .fx-fs-go')).includes('It\'s you') && (await env.text('#recApproverAlso')).startsWith('ProjectCo Projects approves first'),
      await env.text('#recFlow .fx-fs[data-key="requester"]'));
    T.eq('…waiting for her BU', (await k.stored()).requests[1].status, 'AWAITING_REQUESTER_APPROVAL');
    await page.click('#recApprove');
    await page.waitForFunction(() => !document.getElementById('recApprove'), null, { timeout: 10000 });
    T.eq('approved: the owners now see it', (await k.stored()).requests[1].status, 'SUBMITTED');
    T.check('…the toast says so', (await k.toast()).includes('Approved FR-1002 above the threshold.'), await k.toast());
    await k.fits('a request\'s tab');
  }, (s) => { s.settings.requesterApproval = true; });

  // ── fresh: sourced from FleetCo, chosen on step 1 ─────────────────────────────────────────────────────────
  await run('fresh', 'p-pm', 'fresh as Priya: Source from FleetCo on step 1, only its units on step 2', async (env, k) => {
    const { page } = env;
    await env.open('/?open=new-request');
    await page.waitForSelector('#page-new-request #nrSources', { timeout: 30000 });
    T.eq('Source from: Any first, chosen', await k.sources(), SOURCES_PRIYA);
    T.check('…shown under the requesting business unit, before what it is for', await page.evaluate(() => {
      const bu = document.getElementById('nrBu'); const src = document.getElementById('nrSourceField'); const opts = document.getElementById('nrOptions');
      return !!(bu.compareDocumentPosition(src) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(src.compareDocumentPosition(opts) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
    const fc = await env.text('#nrSources [data-source="BU-FC"]');
    T.check('FleetCo\'s card: BU and company, country, relationship, money, lead time, agreement and version, units', ['FleetCo Fleet', 'FleetCo Equipment LLC · United Arab Emirates', 'Intercompany · domestic',
      'Invoice pair: AR in FleetCo, AP in ProjectCo coded to the project; VAT 5 %', 'Lead time 2 days', 'ICA-FC-PC-2026 v1 (intercompany agreement)', '8 units · 8 free for the dates'].every((x) => fc.includes(x)), fc);
    T.check('…own fleet: cost straight to the project, no invoice', (await env.text('#nrSources [data-source="BU-PC"]')).includes('Own fleet ProjectCo Projects ProjectCo Contracting LLC · United Arab Emirates Cost straight to the project, no invoice'),
      await env.text('#nrSources [data-source="BU-PC"]'));
    T.check('…ProjectCo Facilities: a cross-charge at its rates', (await env.text('#nrSources [data-source="BU-PF"]')).includes('XC-PF-PC-2026 v1 (cross-charge rates)'));
    await k.pick('#nrOptions [data-value="P:P-INT"]');
    await page.fill('#nrFrom', '2026-11-03');
    await page.fill('#nrTo', '2026-12-20');
    await page.waitForTimeout(300);
    await k.pick('#nrSources [data-source="BU-FC"]');
    T.eq('FleetCo chosen: its card on, Any off', await k.sources(),
      'Any company in the group (Every allowed owner) ; ProjectCo Projects (Own fleet) ; ProjectCo Facilities (Same company · cross-charge) ; FleetCo Fleet (Intercompany · domestic)*');
    shots.push(await k.shot('future-new-request-source-from.png'));
    await k.fits('New request, Source from');

    await k.pick('#nrToEquipment');
    await page.waitForSelector('#nrStepEquipment');
    T.eq('step 2\'s head: requested by ProjectCo → sourced from FleetCo', await env.text('#nrRoute'), 'Requested by ProjectCo Projects (ProjectCo) → sourced from FleetCo Fleet (FleetCo)');
    T.eq('…says whose units it shows, and offers every company', [await env.text('#nrShownText'), await env.text('#nrShowAll')].join(' | '), 'Units of FleetCo Fleet (FleetCo) | Show every company');
    const owners = () => page.$$eval('#nrGroups .fx-nr-group', (g) => g.map((x) => x.dataset.owner).join());
    const units = () => page.$$eval('#nrGroups .fx-nr-card', (c) => c.map((x) => x.dataset.unit).join());
    await k.pick('#nrClasses [data-cls="GEN"]');
    T.eq('generators: FleetCo\'s only, not the own fleet\'s GN-3901', [await owners(), await units()].join(' | '), 'BU-FC | GN-3001,GN-3002');
    await k.pick('#nrClasses [data-cls="TWR"]');
    T.eq('light towers: FleetCo has none, said in words', await env.text('#nrNoUnits'), 'FleetCo Fleet has no Light towers for you. Try another class, or show every company.');
    await k.pick('#nrShowAll');
    T.eq('Show every company: the head and the units follow', [await env.text('#nrRoute'), await env.text('#nrShownText'), await owners()].join(' | '),
      'Requested by ProjectCo Projects (ProjectCo) → sourced from any company in the group | Units of every company you may source from, own fleet first | BU-PF');
    await k.pick('#nrSteps [data-step="1"]');
    T.eq('…and step 1 says Any again', await k.sources(), SOURCES_PRIYA);
    await k.pick('#nrSources [data-source="BU-FC"]');
    await k.pick('#nrToEquipment');
    await k.pick('#nrClasses [data-cls="EXC"]');
    T.eq('FleetCo again: its excavators', [await owners(), await units()].join(' | '), 'BU-FC | EX-1001,EX-1002,EX-1003');
    await k.pick('#nrGroups .fx-nr-card[data-unit="EX-1001"] .fx-nr-add');
    T.eq('EX-1001 on the request', await page.$$eval('#nrCart .fx-nr-cartlist li', (l) => l.map((x) => x.dataset.unit).join()), 'EX-1001');
    shots.push(await k.shot('future-new-request-fleetco-units.png'));
    await k.fits('New request, FleetCo\'s units');

    await k.pick('#nrToReview');
    await page.waitForSelector('#nrStepReview');
    T.eq('review: the head, the group, the sourcing BU', [await env.text('#nrReviewRoute'), await env.text('#nrReview .fx-nr-owner-route'), await env.text('#nrSourcing')].join(' | '),
      'Requested by ProjectCo Projects (ProjectCo) → sourced from FleetCo Fleet (FleetCo) | Requested by ProjectCo Projects (ProjectCo) → Sourced from FleetCo Fleet (FleetCo) | FleetCo Fleet · FleetCo');
    T.check('…FleetCo\'s Equipment Manager approves, by name; billed by the invoice pair', (await env.text('#nrReview [data-key="approve"]')).includes('(Ana Costa, Equipment Manager · FleetCo)')
      && (await env.text('#nrReview [data-key="bill"]')).includes('an AR invoice in FleetCo and an AP invoice in ProjectCo coded to PC-INT-014'));
    shots.push(await k.shot('future-new-request-fleetco-review.png'));
    await k.fits('New request, review from FleetCo');
    await page.click('#nrSubmit');
    await k.waitTab('request:R1001');
    const r = (await k.stored()).requests[0];
    T.eq('Submit: the line\'s provider is BU-FC', [r.number, r.requestingBu, r.lines.map((l) => l.preferredUnit + ' ' + l.provider + ' ' + l.relation + ' ' + l.status).join()].join(' | '),
      'FR-1001 | BU-PC | U-EX1 BU-FC IC_DOMESTIC REQUESTED');
    await page.click('.nx-tab-btn[data-id="new-request"]');
    await page.waitForSelector('#nrSent');
    T.eq('the form starts again: Any company in the group', await k.sources(), SOURCES_PRIYA);
  });

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
      'FleetCo Fleet · FleetCo', 'Intercompany · domestic', 'On hire', 'Here now: off hire · Omar Haddad (ProjectCo Projects)', '4 of 7', 'Money next: Settled · Treasury', 'AED 15,000.00'].every((x) => r1.includes(x)), r1);
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

  // ── fresh as Lena: a customer rental, its approval and flow ────────────────────────────────────────────
  await run('fresh', 'p-desk', 'fresh as Lena: a rental for Customer Y, who approves and what is next', async (env, k) => {
    const { page } = env;
    await env.open('/?open=new-request');
    await page.waitForSelector('#page-new-request #nrOptions', { timeout: 30000 });
    await k.pick('#nrOptions [data-value="C:C-Y"]');
    await k.pick('#nrToEquipment');
    await k.pick('#nrClasses [data-cls="GEN"]');
    await k.pick('#nrGroups .fx-nr-card[data-unit="GN-3001"] .fx-nr-add');
    await k.pick('#nrToReview');
    await page.click('#nrSubmit');
    await k.waitTab('request:R1001');
    await page.waitForSelector('#page-request #recFlow', { timeout: 15000 });
    T.eq('raised: the request opens on Approval & flow', [await page.getAttribute('#recTab-flow', 'aria-selected'), (await env.text('#recTabs')).split(/\s+/).slice(0, 4).join(' ')].join(' | '), 'true | Approval & flow 1');
    T.eq('…the approver is Ana, the owner; the deposit comes first', [await env.text('#recApproverText'), await env.text('#recApproverAlso')].join(' '),
      'Approver: Ana Costa (Equipment Manager, FleetCo Fleet), the owner of GN-3001. First Lena Novak (rental desk) takes the deposit; only then may the owner approve.');
    T.eq('…the head: next, the deposit by Lena', await env.text('#recFinBadge'), 'Next: the deposit · Lena Novak, rental desk');
    T.check('…next: the deposit, and it\'s Lena', (await env.text('#recFlowNext')).startsWith('NEXT Deposit taken FleetCo Fleet (Requesting and sourcing BU) · Lena Novak · Rental desk · FleetCo It\'s you'),
      await env.text('#recFlowNext'));
    const steps = () => page.$$eval('#recFlow [data-section="L1"] .fx-fs', (l) => l.map((x) => x.dataset.key + ':' + x.dataset.state).join(' '));
    T.eq('…the steps in order: the deposit now, the owner\'s approval waiting', await steps(),
      'raised:done requester:na deposit:current approve:waiting ship:waiting receive:waiting offHire:waiting back:waiting');
    const dep = await env.text('#recFlow .fx-fs[data-key="deposit"]');
    T.check('…the deposit: what, the BU, who, "It\'s you"', ['Deposit taken', 'Now', '25 % of four weeks (AED 2,100.00), before the owner may approve', 'FleetCo Fleet · FleetCo',
      'Lena Novak · Rental desk · FleetCo', 'It\'s you', 'Open Customer billing'].every((x) => dep.includes(x)), dep);
    const ap = await env.text('#recFlow .fx-fs[data-key="approve"]');
    T.check('…the approval: the approver, Ana Costa, waiting for the deposit', ['Owner approves and allocates', 'Waiting', 'The approver', 'Ana Costa · Equipment Manager · FleetCo',
      'Waits for the deposit: the rental desk takes it first'].every((x) => ap.includes(x)), ap);
    const here = () => page.$eval('#recJourneyGrid .fx-jr-node--here', (n) => [n.dataset.key, n.dataset.lane, n.querySelector('.fx-jr-flag').innerText.trim(),
      n.querySelector('.fx-jr-persontext').innerText.trim()].join(' | '));
    T.eq('the journey: the lanes, by name', await page.$$eval('#recJourneyGrid .fx-jr-lanename', (l) => l.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'Customer Y rents, through FleetCo Fleet’s rental desk | FleetCo Fleet owns, approves, ships | Money starts when it is on hire');
    T.eq('…"Here now" on the deposit, in Lena\'s lane (the customer\'s, through the rental desk)', await here(), 'deposit | 1 | HERE NOW | Lena Novak · takes the deposit');
    T.eq('…raised: done, with its date', await env.text('#recJourneyGrid [data-key="raised"]'), 'Raised 2 Nov');
    T.eq('…in words: her turn', await env.text('#recJourneySentence'), 'FR-1001 is with FleetCo Fleet. It\'s your turn: take the deposit in Customer billing. Before that: Lena Novak raised it on 2 Nov 2026.');
    T.check('…the hand-over to the owner is drawn', (await page.$$('#recJourneyGrid .fx-jr-link')).length === 3);
    shots.push(await k.shot('future-request-flow-deposit.png'));
    await k.fits('Approval & flow, waiting for the deposit');

    await page.click('#recFlow .fx-fs[data-key="deposit"] .fx-fs-go [data-nav="billing"]');
    await k.waitTab('billing');
    await page.waitForSelector('#blDeposits .fxm-deposit[data-id="R1001"] .fxm-deposit-take', { timeout: 15000 });
    await page.click('#blDeposits .fxm-deposit[data-id="R1001"] .fxm-deposit-take');
    await page.waitForFunction(() => !document.querySelector('#blDeposits .fxm-deposit[data-id="R1001"] .fxm-deposit-take'), null, { timeout: 10000 });
    T.check('Customer billing: the deposit taken', (await k.stored()).requests[0].deposit.amount === 2100);
    await page.click('.nx-tab-btn[data-id="request:R1001"]');
    await page.waitForSelector('#recFlow .fx-fs[data-key="approve"][data-state="current"]', { timeout: 10000 });
    T.eq('after the deposit: Ana\'s approval is current', await steps(), 'raised:done requester:na deposit:done approve:current ship:waiting receive:waiting offHire:waiting back:waiting');
    T.check('…the deposit done by Lena, with the date', (await env.text('#recFlow .fx-fs[data-key="deposit"]')).includes('Done 2 Nov 2026 by Lena Novak'));
    T.eq('…Lena plays Ana there', await env.text('#recFlow .fx-fs[data-key="approve"] .fx-fs-go'), 'Play as Ana and open Approve & allocate');
    T.eq('…the flag moves to Ana, in FleetCo\'s lane', await here(), 'approve | 2 | HERE NOW | Ana Costa · approves');
    T.eq('…in words', await env.text('#recJourneySentence'), 'FR-1001 is with FleetCo Fleet: Ana Costa (Equipment Manager) approves and allocates. Before that: Lena Novak took the deposit on 2 Nov 2026.');
    T.eq('…the head', await env.text('#recFinBadge'), 'Next: approval · Ana Costa, Equipment Manager');
    shots.push(await k.shot('future-request-flow-approval.png'));
    await page.click('#recFlow .fx-fs[data-key="approve"] .fx-play');
    await k.waitTab('approvals');
    T.eq('Play as Ana: one click switches the persona and opens Approve & allocate', await env.text('#fxPersonaName'), 'Ana Costa');
    await page.waitForSelector('#apLines', { timeout: 15000 });
    T.check('…where FR-1001 waits for her', (await env.text('#apLines')).includes('FR-1001'));
  });

  // ── onHire as Priya: r1's flow half-way ───────────────────────────────────────────────────────────────
  await run('onHire', 'p-pm', 'onHire as Priya: r1 approved, shipped, received; its hours now', async (env, k, ids) => {
    const { page } = env;
    await env.open('/?open=requests');
    await page.waitForSelector('#page-requests #rqRows', { timeout: 30000 });
    const row = `#rqRows .fx-rq-row[data-id="${ids.r1}"]`;
    T.eq('My requests: where it is now, and who', await env.text(row + ' .fx-rq-here'), 'Here now: the hours · Priya Raman (ProjectCo Projects)');
    T.eq('…its journey as dots: done, here, waiting', await page.$$eval(row + ' .fx-jr-dot', (d) => d.map((x) => x.className.replace(/fx-jr-dot ?/g, '').replace(/--/g, '') || '-').join(' ')),
      'done done done done current here waiting waiting current money waiting waiting waiting');
    shots.push(await k.shot('future-my-requests-here-now.png'));
    await k.fits('My requests with the journey dots');
    await page.click(row);
    await k.waitTab('request:' + ids.r1);
    await page.waitForSelector('#page-request #recLines', { timeout: 15000 });
    T.eq('on hire: the tab opens on Equipment, the approver and the next step on top', [await page.getAttribute('#recTab-equipment', 'aria-selected'), await env.text('#recCompactApprover'),
      await env.text('#recCompactNext')].join(' | '), 'true | Ana Costa (Equipment Manager, FleetCo Fleet) | Hours recorded and approved · Priya Raman, Project Manager');
    await page.click('#recCompactAll');
    await page.waitForSelector('#recFlow');
    const done = (key) => env.text(`#recFlow [data-section="L1"] [data-key="${key}"] .fx-fs-done`);
    T.eq('Approval & flow: approved by Ana Costa with the date, shipped, received', [await done('approve'), await done('ship'), await done('receive')].join(' | '),
      'Done 2 Nov 2026 by Ana Costa | Done 2 Nov 2026 by Ravi Kumar | Done 7 Nov 2026 by Omar Haddad');
    T.eq('…now the hours: it\'s Priya', await env.text('#recFlow [data-section="L1"] [data-key="hours"] .fx-fs-go'), 'It\'s you Open Receive, hours, moves');
    const nodes = await page.$$eval('#recJourneyGrid .fx-jr-node', (n) => n.map((x) => x.dataset.lane + ':' + x.dataset.key + ':' + x.dataset.state + (x.classList.contains('fx-jr-node--here') ? '*' : '')).join(' '));
    T.eq('the journey: done nodes, the flag on the hours in ProjectCo\'s lane, the money from the day on hire', nodes,
      '1:raised:done 2:approve:done 2:ship:done 1:receive:done 1:hours:current* 1:offHire:waiting 2:back:waiting 3:m-charges:current 3:m-agreed:waiting 3:m-pair:waiting 3:m-settled:waiting');
    T.eq('…its person', await env.text('#recJourneyGrid .fx-jr-node--here .fx-jr-persontext'), 'Priya Raman · approves the hours');
    T.eq('…the done nodes carry their dates', await page.$$eval('#recJourneyGrid .fx-jr-node--done .fx-jr-date', (d) => d.map((x) => x.innerText.trim()).join()), '2 Nov,2 Nov,2 Nov,7 Nov');
    T.eq('…in words', await env.text('#recJourneySentence'),
      'FR-1001 is with ProjectCo Projects. It\'s your turn: record and approve the hours in Receive, hours, moves. Before that: Omar Haddad received it on 7 Nov 2026.');
    T.eq('…the head', await env.text('#recFinBadge'), 'Next: the hours · Priya Raman, Project Manager');
    shots.push(await k.shot('future-request-flow-onhire.png'));
    await k.fits('Approval & flow, on hire');
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(300);
    T.check('1024px: the journey scrolls inside its own box, not the page', await page.evaluate(() => {
      const box = document.querySelector('.fx-jr-scroll');
      return document.documentElement.scrollWidth <= document.documentElement.clientWidth && box.scrollWidth >= box.clientWidth;
    }));
    shots.push(await k.shot('future-request-flow-onhire-1024.png'));
    await page.setViewportSize({ width: 1440, height: 1000 });
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
