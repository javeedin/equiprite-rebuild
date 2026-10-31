'use strict';
/*
 * EquipRite Future · Accounting (shown), Reports and Companies & agreements in a real browser, at the story's points
 * (tests/e2e/future-fixture.js). As Sara (group intercompany finance) at 'settled': each company's journal and trial
 * balance, balanced; the group's eliminations, both sides and the difference (nil at 'settled', exchange differences
 * only once the KSA invoice is accrued, invoiced and settled on other days); the reports (IC by pair, the
 * reconciliation, customs with days left, certificates); the setup (a rate change makes version 2, a decision switched,
 * a relationship stopped: New request's sourcing loses that owner), a refusal kept on the page in words, Reset the demo.
 * As Mark (ProjectCo finance): only ProjectCo's companies, no Group. As Priya: no Accounting, Setup read-only.
 * No sideways scroll at 1440 and 1024 px, no browser errors, no backend call. Needs `npm run build`.
 * Run: node tests/e2e/future-finance.e2e.js     (E2E_SHOTS=<dir> keeps the screenshots there)
 */
const fs = require('fs');
const E = require('./harness');
const H = require('../_harness');
const F = require('./future-fixture');

const T = H.makeAsserter();

/** The 'agreed' story, then the cut-off accrues November (30 Nov rate), the invoice pairs come on 4 Dec, settled on 10 Dec. */
function fxState() {
  let s = F.state('agreed');
  const act = (type, payload) => { const r = F.Engine.apply(s, type, payload); if (!r.ok) throw new Error(type + ': ' + r.error); s = r.state; };
  act('setPersona', { id: 'p-fin' });
  act('advance', { days: 4 });
  s.statements.forEach((st) => act('createInvoicePair', { statementId: st.id }));
  act('advance', { days: 6 });
  s.statements.forEach((st) => act('settle', { statementId: st.id }));
  return s;
}

(async () => {
  const start = F.state('settled');
  const ids = F.ids(start);
  const env = await E.start({ port: 19640, app: 'future', init: F.init(start, 'p-fin'), shots: process.env.E2E_SHOTS || undefined });
  const { page } = env;
  const state = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), F.KEY);
  const toast = async () => ((await page.$('#nxToast')) ? env.text('#nxToast') : '');
  const menu = () => page.$$eval('.nx-nav-item', (b) => b.map((x) => x.dataset.navId).join(' '));
  const currentTab = () => page.$eval('.nx-tab--on', (t) => t.dataset.tabId);
  const names = { 'p-fin': 'Sara Ahmed', 'p-pm': 'Priya Raman', 'p-pcfin': 'Mark Lee' };
  const playAs = async (id) => {
    await page.click('#fxPersona');
    await page.waitForSelector('#fxPersonaPanel');
    await page.click(`#fxPersonaPanel .fx-person[data-id="${id}"]`);
    await page.waitForFunction((n) => { const e = document.getElementById('fxPersonaName'); return e && e.innerText.trim() === n; }, names[id], { timeout: 10000 });
    await page.waitForTimeout(500);
  };
  const inBrowser = (mods, fn, arg) => page.evaluate(([m, f, a]) => new Promise((resolve) => {
    window.require(m, (...x) => resolve(new Function('mods', 'arg', 'return (' + f + ')(mods, arg)')(x, a)));
  }), [mods, fn.toString(), arg]);
  const ownersFor = (cls) => inBrowser(['resources/js/future/fxStore', 'resources/js/future/fxEngine'],
    (m, c) => m[1].sourcing(m[0].get(), { requestingBu: 'BU-PC', cls: c }).map((o) => o.owner).filter((x, i, a) => a.indexOf(x) === i).join(), cls);
  const pickCompany = async (le, title) => {
    await page.click(`#acctCompanies .fx-co[data-le="${le}"]`);
    await page.waitForFunction((t) => document.getElementById('acctTitle').innerText.trim() === t, title, { timeout: 10000 });
    await page.waitForTimeout(300);
  };
  /** No sideways scroll on the page, and no list wider than its card. */
  const fits = () => page.evaluate(() => {
    const doc = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    const wide = Array.from(document.querySelectorAll('.nx-page .nx-table, .nx-page .nx-card')).filter((t) => t.offsetParent !== null && t.scrollWidth > t.clientWidth + 1)
      .map((t) => (t.closest('[id]') || t).id || t.className);
    return { ok: doc && !wide.length, doc, wide: wide.join(', ') };
  });
  try {
    // ── Accounting (shown) ──────────────────────────────────────────────────────────────────────────────────────
    T.section('Accounting (shown): Sara at \'settled\' sees each company\'s books');
    await env.open('/?open=accounting');
    await page.waitForSelector('#acctCompanies .fx-co', { timeout: 30000 });
    T.eq('the companies of her BUs, and the group', await page.$$eval('#acctCompanies .fx-co', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'FleetCo AED | ProjectCo AED | ProjectCo KSA SAR | Group AED · consolidated');
    T.eq('the banner says it is shown, never posted', await env.text('#acctBanner'),
      'Each company\'s Fusion makes these entries from the transactions EquipRite creates. Shown here, never posted.');
    T.eq('FleetCo first', await env.text('#acctTitle'), 'Accounting (shown): FleetCo');
    await env.shot('future-accounting-fleetco.png');
    const books = {};
    for (const [le, short, count] of [['LE-FC', 'FleetCo', 12], ['LE-PC', 'ProjectCo', 7], ['LE-PK', 'ProjectCo KSA', 3]]) {
      if (le !== 'LE-FC') await pickCompany(le, 'Accounting (shown): ' + short);
      const n = await page.$$eval('#acctEntries .fx-je', (a) => a.length);
      const dr = await env.text('#acctTrialDr');
      const cr = await env.text('#acctTrialCr');
      books[le] = { n, dr, cr, check: await env.text('#acctTrialCheck'), kpi: await env.text('#acctKpiBalanced .nx-kpi-value') };
      T.eq(short + ': every transaction in the journal', [n, await env.text('#acctKpiCount .nx-kpi-value')].join(), count + ',' + count);
      T.check(short + ': the trial balance is balanced, debits = credits', books[le].kpi === 'Balanced' && dr === cr && books[le].check === 'Balanced Balanced: debits ' + dr + ' = credits ' + cr,
        JSON.stringify(books[le]));
    }
    T.eq('ProjectCo KSA\'s ledger is in SAR', books['LE-PK'].dr.slice(0, 3), 'SAR');
    const ksaAp = '#acctEntries .fx-je[data-kind="IC_AP"]';
    T.eq('the KSA invoice: kind, number, date', await page.$eval(ksaAp, (e) => [e.querySelector('.fx-chip').innerText, e.querySelector('.fx-je-num').innerText, e.querySelector('.fx-je-date').innerText].join(' · ')),
      'Intercompany AP invoice · FL-ICAR-000102 · 30 Nov 2026');
    T.eq('…its source in Fusion', await page.$eval(ksaAp, (e) => e.querySelector('.fx-je-source').innerText.trim()), 'Fusion Payables: intercompany invoice, project-coded (INT-10)');
    T.check('…entered in AED, booked in SAR at the day\'s rate', /^Entered AED 6,825\.00, booked in SAR at 1 AED = 1\.0\d{3} SAR \(30 Nov 2026\)$/.test(await page.$eval(ksaAp, (e) => e.querySelector('.fx-je-rate').innerText.trim())),
      await page.$eval(ksaAp, (e) => e.querySelector('.fx-je-rate').innerText.trim()));
    T.eq('…its Dr/Cr lines with codes and names (reverse charge, payable to FleetCo)', await page.$eval(ksaAp, (e) => Array.from(e.querySelectorAll('.fx-je-line:not(.fx-je-line--head):not(.fx-je-line--total) .fx-je-acc')).map((x) => x.innerText).join(' ')),
      '5100 5110 1400 2200 2110');
    T.check('…the payable named', (await page.$eval(ksaAp, (e) => e.innerText)).includes('Intercompany payable · FleetCo'));
    T.eq('…its request, statement and project as links', await page.$eval(ksaAp, (e) => Array.from(e.querySelectorAll('.fx-je-links .fx-link-chip')).map((x) => x.innerText.trim()).join(' | ')),
      'FR-1003 | Statement ICS-2026-11-002 | PK-C-0310');

    T.section('the journal filters by kind; a request opens from it');
    await pickCompany('LE-FC', 'Accounting (shown): FleetCo');
    T.eq('FleetCo\'s kinds', await page.$$eval('#acctKinds .nx-chip', (b) => b.map((x) => x.dataset.kind).join(' ')), 'ALL ASSET_CUSTODY CUSTOMER_AR DEPOSIT IC_AR NETTING TO_RECEIPT TO_SHIP');
    await page.click('#acctKinds .nx-chip[data-kind="IC_AR"]');
    await page.waitForFunction(() => document.querySelectorAll('#acctEntries .fx-je').length === 2, null, { timeout: 5000 });
    T.eq('Intercompany AR invoices only: the two of the pair', await page.$$eval('#acctEntries .fx-je', (a) => a.map((x) => x.dataset.kind + ' ' + x.dataset.number).join(', ')),
      'IC_AR FL-ICAR-000102, IC_AR FL-ICAR-000101');
    T.eq('…and the count says so', await env.text('#acctShown'), '2 of 12 transactions · Intercompany AR invoice, newest first');
    const ar = '#acctEntries .fx-je[data-number="FL-ICAR-000101"]';
    T.eq('FleetCo\'s AR to ProjectCo: receivable, IC revenue, transport, VAT', await page.$eval(ar, (e) => Array.from(e.querySelectorAll('.fx-je-acc')).map((x) => x.innerText).join(' ')), '1210 4110 4120 2200');
    T.eq('…its source', await page.$eval(ar, (e) => e.querySelector('.fx-je-source').innerText.trim()), 'Fusion Receivables: intercompany invoice (INT-10)');
    T.eq('…covering both ProjectCo requests', await page.$eval(ar, (e) => Array.from(e.querySelectorAll('.fx-je-request')).map((x) => x.innerText.trim()).join()), 'FR-1001,FR-1002');
    await page.click(ar + ' .fx-je-request[data-id="' + ids.r1 + '"]');
    await page.waitForFunction((t) => { const x = document.querySelector('.nx-tab--on'); return x && x.dataset.tabId === t; }, 'request:' + ids.r1, { timeout: 10000 });
    T.check('a request link opens the request in its tab', true);
    await page.click('.nx-tab-btn[data-id="accounting"]');
    await page.waitForTimeout(400);
    await page.click('#acctKinds .nx-chip[data-kind="ALL"]');
    await page.waitForFunction(() => document.querySelectorAll('#acctEntries .fx-je').length === 12, null, { timeout: 5000 });
    T.check('All again: twelve', true);

    T.section('Group: the consolidation, the eliminations');
    await pickCompany('GROUP', 'Accounting (shown): the group');
    T.eq('three eliminations', await page.$$eval('#acctElims .fx-elim', (a) => a.map((x) => x.dataset.pair + ':' + x.dataset.state).join(' ')), 'icbal:zero accrual:zero pl:zero');
    const pl = '#acctElims .fx-elim[data-pair="pl"]';
    T.eq('IC revenue ↔ IC project cost: both sides, in each company\'s currency and in AED', await page.$eval(pl, (e) => Array.from(e.querySelectorAll('.fx-elim-row')).map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'FleetCo AED −79,575.00 AED −79,575.00 | Side total AED −79,575.00 | ProjectCo AED 72,750.00 AED 72,750.00 | ProjectCo KSA SAR 6,972.61 AED 6,825.00 | Side total AED 79,575.00');
    T.eq('…and the difference: nil', await page.$eval(pl, (e) => e.querySelector('.fx-elim-diff').innerText.replace(/\s+/g, ' ').trim()), 'Difference AED 0.00 Both sides eliminate to the cent.');
    T.check('receivable ↔ payable: settled, nil on both sides (FleetCo, ProjectCo, KSA shown)', (await page.$eval('#acctElims .fx-elim[data-pair="icbal"]', (e) => e.innerText)).includes('ProjectCo KSA · nil now'));
    T.check('what remains after elimination balances', (await env.text('#acctAfterCheck')).startsWith('Balanced Balanced after elimination: debits = credits = AED '), await env.text('#acctAfterCheck'));
    T.check('…no intercompany account left in it', !(await page.$$eval('#acctAfterRows .nx-row', (r) => r.map((x) => x.dataset.account))).some((a) => ['1210', '2110', '1220', '2120', '4110', '4120', '4130', '5100', '5110', '5120', '5130'].indexOf(a) !== -1));
    T.eq('the three companies, each balanced', await page.$$eval('#acctGroupCompanies .fx-cos-name', (a) => a.map((x) => x.innerText).join(' | ')), 'FleetCo · AED | ProjectCo · AED | ProjectCo KSA · SAR');
    await env.shot('future-accounting-group.png');

    T.section('Group: exchange differences only, explained (KSA accrued 30 Nov, invoiced 4 Dec, settled 10 Dec)');
    const fx = fxState();
    await page.evaluate((s) => new Promise((resolve) => window.require(['resources/js/future/fxStore'], (st) => { st.replace(s); resolve(); })), Object.assign({}, fx, { personaId: 'p-fin' }));
    await page.waitForFunction(() => document.querySelectorAll('#acctElims .fx-elim[data-state="fx"]').length === 3, null, { timeout: 10000 });
    T.eq('every pair differs by exchange only', await page.$$eval('#acctElims .fx-elim', (a) => a.map((x) => x.dataset.state + ' ' + x.querySelector('.fx-elim-head .fx-chip').innerText).join(' | ')),
      'fx Exchange difference only | fx Exchange difference only | fx Exchange difference only');
    const why = await page.$eval('#acctElims .fx-elim[data-pair="accrual"] .fx-elim-why', (e) => e.innerText);
    T.check('…explained: the KSA entries in SAR translated at each date\'s rate, to the FX reserve', /ProjectCo KSA’s entries are in SAR/.test(why) && /FX reserve/.test(why), why);
    T.check('…with the entries in SAR, each with its date and rate', (await page.$eval('#acctElims .fx-elim[data-pair="accrual"] .fx-elim-fx', (e) => e.textContent)).includes('1 AED = 1.0'));
    T.check('the differences are small (exchange, not a mismatch)', (await page.$$eval('#acctElims .fx-elim-diff-amt', (a) => a.map((x) => Math.abs(Number(x.innerText.replace(/[^0-9.]/g, '')))))).every((d) => d > 0 && d < 50));
    T.check('…and go to the FX reserve, so the rest still balances', (await page.$('#acctAfterRows .nx-row[data-account="FX"]')) && (await env.text('#acctAfterCheck')).startsWith('Balanced'));
    await page.click('#acctElims .fx-elim[data-pair="accrual"] .fx-elim-fx summary');
    await env.shot('future-accounting-group-fx.png');
    await page.evaluate((s) => new Promise((resolve) => window.require(['resources/js/future/fxStore'], (st) => { st.replace(s); resolve(); })), Object.assign({}, start, { personaId: 'p-fin' }));
    await page.waitForFunction(() => document.querySelectorAll('#acctElims .fx-elim[data-state="zero"]').length === 3, null, { timeout: 10000 });

    T.section('an export says what it did');
    await page.click('#acctExportElim');
    const [elimFile] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#acctElims .nx-menu-item[data-format="csv"]')]);
    T.check('eliminations to CSV', /^equiprite-eliminations-\d{4}-\d\d-\d\d\.csv$/.test(elimFile.suggestedFilename()), elimFile.suggestedFilename());
    const elimCsv = fs.readFileSync(await elimFile.path(), 'utf8');
    T.check('…with both sides and the difference', elimCsv.includes('IC revenue ↔ IC project cost') && elimCsv.includes('ProjectCo KSA') && elimCsv.includes('Difference'));

    // ── Reports ─────────────────────────────────────────────────────────────────────────────────────────────────
    T.section('Reports: each a card that exports');
    await page.click('#acctReports');
    await page.waitForSelector('#repIcRows', { timeout: 15000 });
    T.eq('the whole group for Sara', await env.text('#repScope'), 'The whole group (FleetCo, ProjectCo, ProjectCo KSA) · as of 30 Nov 2026');
    T.eq('intercompany charges by pair and month: charged, invoiced, open', await page.$$eval('#repIcRows .nx-row:not(.nx-row--head)', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'FleetCo → ProjectCo Intercompany · domestic Nov 2026 AED 72,750.00 AED 72,750.00 AED 0.00 Invoiced in full ICS-2026-11-001'
      + ' | FleetCo → ProjectCo KSA Intercompany · cross-border Nov 2026 AED 6,825.00 AED 6,825.00 AED 0.00 Invoiced in full ICS-2026-11-002');
    T.eq('the reconciliation: zero differences', await page.$$eval('#repReconRows .nx-row:not(.nx-row--head) .fx-chip', (r) => r.map((x) => x.innerText).join()), 'AED 0.00,AED 0.00');
    T.check('…the KSA AP as booked in SAR', (await env.text('#repReconRows')).includes('booked SAR 6,972.61 in ProjectCo KSA'));
    T.eq('customs: the temporary import, its re-export date and days left', await page.$eval('#repCustomsRows .nx-row[data-permit="TI-SA-00001"]', (r) => r.innerText.replace(/\s+/g, ' ').trim()),
      'TI-SA-00001 · GN-3001 United Arab Emirates → Saudi Arabia · Temporary import · FleetCo, value AED 95,000.00 30 Jan 2027 entered 2 Nov 2026 61 days left Open Pro-forma invoice, Packing list, Certificates FR-1003');
    T.eq('the fleet by country: the KSA unit under customs', await page.$eval('#repFleetCountries .fx-country[data-country="SA"]', (c) => c.innerText.replace(/\s+/g, ' ').trim()),
      'Saudi Arabia · 1 unit GN-3001 Atlas 200 kVA Generator FleetCo Stock Out Riyadh · PK-C-0310 FR-1003 TI-SA-00001 · re-export by 30 Jan 2027 61 days left');
    T.eq('certificates by country', await page.$$eval('#repCertCountries .fx-country-head', (h) => h.map((x) => x.innerText.trim()).join(' | ')),
      'United Arab Emirates · 10 certificates, 1 expiring soon | Saudi Arabia · 5 certificates, 1 expiring soon');
    T.eq('…expiring soon highlighted, the soonest first', await page.$$eval('#repCertCountries .nx-row[data-soon="yes"]', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'EX-1002 FleetCo Third-party inspection In United Arab Emirates now 31 Jan 2027 62 days left | EX-1003 FleetCo SASO conformity not in the country now 20 Nov 2026 expired 10 days ago');
    T.eq('utilisation by owner and country, as bars', await page.$$eval('#repUtilBars .fx-bar', (b) => b.map((x) => x.dataset.key + ' ' + x.querySelector('.fx-bar-pct').innerText).join(' | ')),
      'FleetCo · United Arab Emirates 43 % | FleetCo · Saudi Arabia 100 % | ProjectCo · United Arab Emirates 50 %');
    T.eq('margins by request', await page.$$eval('#repMarginRows .nx-row--click', (r) => r.map((x) => x.dataset.number + ' ' + x.querySelector('.fx-chip--ok, .fx-chip--na, .fx-chip--todo').innerText).join(' | ')),
      'FR-1001 Cost only | FR-1002 AED 23,100.00 | FR-1003 SAR 2,440.41 | FR-1004 AED 9,760.00 | FR-1005 Cost only');
    T.eq('accruals and disputes: none in this story', [await env.text('#repAccrNone'), await env.text('#repDispNone')].join(' | '), 'Nothing accrued: every statement was invoiced by the cut-off. | No dispute raised.');
    await page.click('#repExportIc');
    const [icFile] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#repIc .nx-menu-item[data-format="csv"]')]);
    const icCsv = fs.readFileSync(await icFile.path(), 'utf8');
    T.check('IC by pair exports as shown', icCsv.includes('FleetCo → ProjectCo KSA,Nov 2026,6825,6825,0,AED,Invoiced in full'), icCsv.split('\n')[2]);
    T.check('…and the toast says so', (await toast()).includes('2 rows exported to CSV'), await toast());
    await env.shot('future-reports.png');

    // ── Setup ───────────────────────────────────────────────────────────────────────────────────────────────────
    T.section('Companies & agreements: read-only parts');
    await page.click('.nx-nav-item[data-nav-id="setup"]');
    await page.waitForSelector('#setupCoCards .fx-co-card', { timeout: 15000 });
    T.check('Sara may change it, and is told how', (await env.text('#setupCanEdit')).startsWith('Sara Ahmed may change the relationships, the rates and the decisions.'));
    T.eq('companies with country, currency, VAT, withholding, e-invoicing, weekend', await page.$eval('#setupCoCards .fx-co-card[data-le="LE-PK"]', (c) => c.innerText.replace(/\s+/g, ' ').trim()),
      'ProjectCo Arabia Ltd ProjectCo KSA · Company 3: projects in KSA COUNTRY Saudi Arabia · Asia/Riyadh LEDGER CURRENCY SAR VAT 15 % TAX REGISTRATION SA-VAT-300600900 WITHHOLDING 5 %'
      + ' E-INVOICING Mandatory (Fusion localisation) WEEKEND Fri–Sat IC ORGANIZATION IC-PROJECTCO-KSA BUSINESS UNITS ProjectCo KSA Projects');
    T.eq('business units and their roles', await page.$$eval('#setupBuRows .nx-row[data-bu]', (r) => r.map((x) => x.dataset.bu + ': ' + Array.from(x.querySelectorAll('.fx-chip')).map((c) => c.innerText).join('+')).join(' | ')),
      'BU-FC: Owns fleet+Rents to customers | BU-PC: Runs projects | BU-PF: Owns fleet+Runs projects | BU-PK: Runs projects');
    T.eq('inventory orgs: yards, deployment orgs at sites, customer sites (GR-6)', await page.$$eval('#setupOrgRows .nx-row[data-org]', (r) => r.map((x) => x.dataset.org + ':' + x.querySelector('.fx-chip').innerText).join(' | ')),
      'FC-YARD:Home yard | FC-DEP-AE:Deployment org (at sites) | FC-DEP-SA:Deployment org (at sites) | FC-CUST-AE:At customer sites | PF-STORE:Home yard | PC-SITE:Site store');
    T.check('…the KSA unit on hand in FleetCo\'s own KSA deployment org', (await page.$eval('#setupOrgRows .nx-row[data-org="FC-DEP-SA"]', (r) => r.innerText)).includes('GN-3001'));
    T.check('…GR-6 said', (await env.text('#setupGr6')).startsWith('GR-6 Stock moves stay inside the owner.'));
    await page.click('#setupSections .fx-section[data-value="people"]');
    await page.waitForSelector('#setupPeopleRows');
    T.eq('the people, Sara playing now, the others to play as', await page.$$eval('#setupPeopleRows .nx-row[data-person]', (r) => r.map((x) => (x.querySelector('.fx-play') || x.querySelector('.fx-chip')).innerText.trim()).join(', ')),
      'Play as Priya, Play as Omar, Play as Yusuf, Play as Mark, Play as Faisal, Play as Huda, Play as Ana, Play as Ravi, Play as Lena, Playing now, Play as Admin');

    T.section('a rate change makes version 2, and says so first');
    await page.click('#setupSections .fx-section[data-value="agreements"]');
    await page.waitForSelector('#setupAgreements .fx-ag[data-agreement="ICA-01"]');
    const exc = '#setupAgreements .fx-ag[data-agreement="ICA-01"] .fx-rate[data-cls="EXC"]';
    T.check('nothing to save before a change', await page.$eval(exc + ' .fx-save', (b) => b.disabled));
    await page.fill(exc + ' input[data-key="rate|ICA-01|EXC|day"]', '0');
    await page.waitForSelector('.fx-preview--bad[data-preview="rate|ICA-01|EXC|"]', { timeout: 5000 });
    T.check('a rate of 0 cannot be saved, and says why', (await env.text('.fx-preview[data-preview="rate|ICA-01|EXC|"]')).startsWith('At least 0.01.') && await page.$eval(exc + ' .fx-save', (b) => b.disabled));
    await page.fill(exc + ' input[data-key="rate|ICA-01|EXC|day"]', '850');
    await page.fill(exc + ' input[data-key="rate|ICA-01|EXC|week"]', '3700');
    await page.waitForFunction(() => { const p = document.querySelector('.fx-preview[data-preview="rate|ICA-01|EXC|"]'); return p && /3,700/.test(p.innerText); }, null, { timeout: 5000 });
    const preview = await env.text('.fx-preview[data-preview="rate|ICA-01|EXC|"]');
    T.eq('what saving does, and what Fusion does, before it is done', preview,
      'Saving makes ICA-FC-PC-2026 version 2 from 30 Nov 2026: Excavators AED 800.00/day, 3,500.00/week → 850.00/day, 3,700.00/week. Lines already requested keep the price they were raised at; new requests are priced on version 2 (MC-FR-05).'
      + ' Fusion: nothing now. The invoice pairs of the hires priced on it carry the new rate (INT-10).');
    T.eq('nothing changed yet', (await state()).agreements.find((a) => a.id === 'ICA-01').version, 1);
    await env.shot('future-setup-rate.png');
    await page.click(exc + ' .fx-save');
    await page.waitForFunction(() => !!document.querySelector('#setupAgreements .fx-ag[data-agreement="ICA-01"] .fx-version--on[data-version="2"]'), null, { timeout: 10000 });
    const ica = (await state()).agreements.find((a) => a.id === 'ICA-01');
    T.eq('saved: version 2 with the new rate, in the store', JSON.stringify([ica.version, ica.rates.EXC, ica.versions.map((v) => v.version + ' ' + v.note)]),
      '[2,{"day":850,"week":3700},["1 Market rate card 2026 (OD-04)","2 EXC: 800/3500 → 850/3700"]]');
    T.eq('version 2 appears in the history, current', await page.$eval('#setupAgreements .fx-ag[data-agreement="ICA-01"] .fx-version--on', (v) => v.innerText.replace(/\s+/g, ' ').trim()),
      'v2 From 30 Nov 2026 · current EXC: 800/3500 → 850/3700 Sara Ahmed');
    T.check('…the card says v2, the draft is gone', (await page.$eval('#setupAgreements .fx-ag[data-agreement="ICA-01"] .fx-ag-version', (v) => v.innerText)) === 'v2'
      && !(await page.$('.fx-preview[data-preview="rate|ICA-01|EXC|"]')));
    T.check('…and the toast says what happened', (await toast()).includes('ICA-FC-PC-2026 v2: EXC 850/day, 3700/week'), await toast());
    T.check('a customer agreement\'s history starts at v1 as set up', (await page.$eval('#setupAgreements .fx-ag[data-agreement="RA-01"] .fx-versions', (v) => v.innerText)).includes('FleetCo rental desk'));

    T.section('decisions: a switch, a choice, a number');
    await page.click('#setupSections .fx-section[data-value="decisions"]');
    await page.waitForSelector('#setupDecRows .fx-dec[data-key="netting"]');
    T.eq('netting (OD-10): what turning it off does', await page.$eval('#setupDecRows .fx-dec[data-key="netting"] .fx-what', (e) => e.innerText.trim()),
      'Turning it off: the next settlement is a payment and a receipt through the bank (1100).');
    await page.click('#setupDecRows .fx-dec[data-key="netting"] button[data-act="setSetting"]');
    await page.waitForFunction(() => document.querySelector('#setupDecRows .fx-dec[data-key="netting"] .fx-dec-now').innerText.trim() === 'Now: Off', null, { timeout: 5000 });
    T.eq('switched off, in the store', (await state()).settings.netting, false);
    await page.click('#setupDecRows .fx-dec[data-key="onHire"] button.fx-choice[data-value="DISPATCH"]');
    await page.waitForFunction(() => document.querySelector('#setupDecRows .fx-dec[data-key="onHire"]').dataset.value === 'DISPATCH', null, { timeout: 5000 });
    T.eq('on hire at dispatch (OD-05), in the store', (await state()).settings.onHire, 'DISPATCH');
    await page.fill('#setupDecRows input[data-key="setting|cutoffDay|"]', '40');
    await page.waitForFunction(() => /At most 28/.test((document.querySelector('#setupDecRows .fx-dec[data-key="cutoffDay"] .fx-preview') || {}).innerText || ''), null, { timeout: 5000 });
    T.check('a cut-off day of 40 cannot be saved', await page.$eval('#setupDecRows .fx-dec[data-key="cutoffDay"] .fx-save', (b) => b.disabled));
    await page.fill('#setupDecRows input[data-key="setting|cutoffDay|"]', '6');
    await page.waitForFunction(() => /from 4 to 6/.test((document.querySelector('#setupDecRows .fx-dec[data-key="cutoffDay"] .fx-preview') || {}).innerText || ''), null, { timeout: 5000 });
    T.check('…6 says what it changes, in EquipRite and in Fusion', (await page.$eval('#setupDecRows .fx-dec[data-key="cutoffDay"] .fx-preview', (e) => e.innerText)).includes('Fusion GL: mirrored accrual journals'));
    await page.click('#setupDecRows .fx-dec[data-key="cutoffDay"] .fx-save');
    await page.waitForFunction(() => document.querySelector('#setupDecRows .fx-dec[data-key="cutoffDay"] .fx-dec-now').innerText.trim() === 'Now: 6', null, { timeout: 5000 });
    T.eq('the cut-off is day 6, in the store', (await state()).settings.cutoffDay, 6);
    T.eq('FDD v2.0\'s other decisions, shown as decided', await page.$$eval('#setupFixed .fx-dec', (d) => d.map((x) => x.dataset.ref).join(' ')), 'OD-01 OD-02 OD-03 OD-04 OD-06 OD-08 OD-09 OD-13 OD-14 OD-15');

    T.section('a relationship stopped: New request no longer offers that owner');
    await page.click('#setupSections .fx-section[data-value="relations"]');
    await page.waitForSelector('#setupRelRows .fx-rel[data-relation="R1"]');
    T.eq('before: ProjectCo Projects may source generators from itself and FleetCo', await ownersFor('GEN'), 'BU-PC,BU-FC');
    T.check('what stopping does, said first', (await page.$eval('#setupRelRows .fx-rel[data-relation="R1"] .fx-what', (e) => e.innerText)).startsWith('Stop: New request no longer offers ProjectCo Projects the 8 units of FleetCo Fleet'));
    // A refusal from the engine stays on the page in words: the Stop button pointed at a relationship that does not exist.
    await page.evaluate(() => { document.querySelector('#setupRelRows .fx-rel[data-relation="R1"] button[data-act="setRelation"]').dataset.id = 'R9'; });
    await page.click('#setupRelRows .fx-rel[data-relation="R1"] button[data-act="setRelation"]');
    await page.waitForSelector('#setupFailure', { timeout: 5000 });
    T.eq('a refusal stays visible in words', await env.text('#setupFailure'), 'No such relationship.');
    await page.waitForTimeout(6000);
    T.check('…after the toast has gone', !!(await page.$('#setupFailure')));
    await page.evaluate(() => { document.querySelector('#setupRelRows .fx-rel[data-relation="R1"] button[data-act="setRelation"]').dataset.id = 'R1'; });
    await page.click('#setupRelRows .fx-rel[data-relation="R1"] button[data-act="setRelation"]');
    await page.waitForFunction(() => document.querySelector('#setupRelRows .fx-rel[data-relation="R1"]').dataset.allowed === 'no', null, { timeout: 5000 });
    T.eq('stopped, in the store', (await state()).icRelations.find((r) => r.id === 'R1').allowed, false);
    T.check('…and the failure is gone once something worked', !(await page.$('#setupFailure')));
    T.eq('New request\'s sourcing (fxEngine.sourcing) loses FleetCo for ProjectCo Projects', [await ownersFor('GEN'), await ownersFor('EXC')].join(' | '), 'BU-PC | ');
    T.check('…other users keep it (ProjectCo KSA still sources FleetCo)', (await inBrowser(['resources/js/future/fxStore', 'resources/js/future/fxEngine'],
      (m) => m[1].sourcing(m[0].get(), { requestingBu: 'BU-PK', cls: 'GEN' }).some((o) => o.owner === 'BU-FC'))) === true);
    await env.shot('future-setup-relations.png');
    await page.click('#setupRelRows .fx-rel[data-relation="R1"] button[data-act="setRelation"]');
    await page.waitForFunction(() => document.querySelector('#setupRelRows .fx-rel[data-relation="R1"]').dataset.allowed === 'yes', null, { timeout: 5000 });
    T.eq('allowed again: FleetCo offered again', await ownersFor('GEN'), 'BU-PC,BU-FC');

    T.section('Reset the demo asks first');
    await page.click('#setupResetAsk');
    await page.waitForSelector('#setupResetDialog');
    T.check('it says what goes', (await env.text('#setupResetText')).startsWith('Every request, charge, statement, invoice and notification goes, and so do the changes made here'));
    await page.click('#setupResetCancel');
    await page.waitForTimeout(300);
    T.eq('Keep the story: nothing changed', [!(await page.$('#setupResetDialog')), (await state()).today, (await state()).agreements.find((a) => a.id === 'ICA-01').version].join(), 'true,2026-11-30,2');

    // ── Other people ────────────────────────────────────────────────────────────────────────────────────────────
    T.section('Mark (ProjectCo finance): only his companies, no Group');
    await page.click('.nx-tab-btn[data-id="accounting"]');
    await page.waitForTimeout(300);
    await pickCompany('GROUP', 'Accounting (shown): the group');
    await playAs('p-pcfin');
    await page.waitForFunction(() => document.getElementById('acctTitle').innerText.trim() === 'Accounting (shown): ProjectCo', null, { timeout: 10000 });
    T.eq('ProjectCo and ProjectCo KSA; no FleetCo, no Group (the Group he was on falls back to ProjectCo)',
      await page.$$eval('#acctCompanies .fx-co', (b) => b.map((x) => x.dataset.le).join()), 'LE-PC,LE-PK');
    T.check('…and his journal has ProjectCo\'s entries, balanced', (await env.text('#acctKpiBalanced .nx-kpi-value')) === 'Balanced' && (await page.$$eval('#acctEntries .fx-je', (a) => a.length)) === 7);
    T.check('the statement link goes where he may go (the workbench)', (await page.$eval('#acctEntries .fx-je-statement', (b) => b.dataset.nav)) === 'ic-workbench');

    T.section('Priya: no Accounting, Setup read-only');
    await playAs('p-pm');
    T.check('the Accounting tab closes: not Priya\'s', (await toast()).includes('Closed') && (await toast()).includes('Accounting (shown)') && !(await page.$('.nx-tab[data-tab-id="accounting"]')), await toast());
    T.check('…not in her menu', !(await menu()).includes('accounting'));
    T.eq('her company switch would be ProjectCo only, no Group', await inBrowser(['resources/js/future/fxStore', 'resources/js/future/fxFinance'],
      (m) => { const o = m[1].options(m[0].get()); return o.list.map((x) => x.id).join() + ' group:' + o.groupAllowed; }), 'LE-PC group:false');
    await page.click('.nx-nav-item[data-nav-id="reports"]');
    await page.waitForSelector('#repIcRows', { timeout: 15000 });
    T.eq('her reports are ProjectCo\'s', [await env.text('#repScope'), await page.$$eval('#repIcRows .nx-row[data-pair]', (r) => r.map((x) => x.dataset.pair).join())].join(' | '),
      'ProjectCo: the companies of your business units · as of 30 Nov 2026 | FleetCo → ProjectCo');
    await page.click('.nx-nav-item[data-nav-id="setup"]');
    await page.waitForSelector('#setupReadOnly', { timeout: 15000 });
    T.eq('Setup says why she cannot change it', await env.text('#setupReadOnly .fx-readonly-text'),
      'Priya Raman sees the setup but does not change it: rates, relationships and decisions are approved for both companies by group intercompany finance (Sara Ahmed) or Admin (MC-FR-05).');
    let editable = 0;
    for (const sec of ['companies', 'people', 'relations', 'agreements', 'decisions']) {
      await page.click(`#setupSections .fx-section[data-value="${sec}"]`);
      await page.waitForTimeout(250);
      editable += await page.$$eval('#page-setup [data-act="setRelation"], #page-setup [data-act="setSetting"], #page-setup .fx-save, #page-setup input', (x) => x.length);
    }
    T.eq('…and nothing on any section changes it', editable, 0);
    T.check('…rates shown as text', (await page.click('#setupSections .fx-section[data-value="agreements"]'), await page.waitForTimeout(250),
      (await page.$eval('#setupAgreements .fx-ag[data-agreement="ICA-01"] .fx-rate[data-cls="EXC"]', (r) => r.innerText.replace(/\s+/g, ' ').trim())) === 'Excavators AED AED 850.00 AED 3,700.00'));
    await env.shot('future-setup-readonly.png');
    await page.click('#setupPlaySara');
    await page.waitForFunction(() => { const e = document.getElementById('fxPersonaName'); return e && e.innerText.trim() === 'Sara Ahmed'; }, null, { timeout: 10000 });
    await page.waitForSelector('#setupCanEdit', { timeout: 10000 });
    T.check('Play as Sara: the same screen, editable', !(await page.$('#setupReadOnly')) && (await currentTab()) === 'setup');

    // ── Widths ──────────────────────────────────────────────────────────────────────────────────────────────────
    T.section('fits the window');
    await page.click('.nx-nav-item[data-nav-id="accounting"]');
    await page.waitForSelector('#acctCompanies .fx-co', { timeout: 15000 });
    for (const w of [1440, 1024]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(300);
      const checks = [];
      await page.click('.nx-tab-btn[data-id="accounting"]');
      for (const le of ['LE-FC', 'LE-PK', 'GROUP']) {
        await page.click(`#acctCompanies .fx-co[data-le="${le}"]`);
        await page.waitForTimeout(400);
        checks.push(['accounting ' + le, await fits()]);
      }
      await page.click('.nx-tab-btn[data-id="reports"]');
      await page.waitForTimeout(400);
      checks.push(['reports', await fits()]);
      await page.click('.nx-tab-btn[data-id="setup"]');
      for (const sec of ['companies', 'people', 'relations', 'agreements', 'decisions']) {
        await page.click(`#setupSections .fx-section[data-value="${sec}"]`);
        await page.waitForTimeout(300);
        checks.push(['setup ' + sec, await fits()]);
      }
      T.eq(`${w}px: no sideways scroll, no list wider than its card`, checks.filter((c) => !c[1].ok).map((c) => c[0] + ' (' + c[1].wide + ')').join('; '), '');
    }
    await env.shot('future-setup-1024.png');
    await page.setViewportSize({ width: 1440, height: 1000 });

    T.section('Reset the demo');
    await page.click('#setupResetAsk');
    await page.click('#setupResetConfirm');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Mon 2 Nov 2026', null, { timeout: 10000 });
    const fresh = await state();
    T.eq('the group as set up, still Sara', [fresh.today, fresh.personaId, fresh.agreements.find((a) => a.id === 'ICA-01').version, fresh.settings.netting, fresh.settings.cutoffDay, fresh.requests.length].join(), '2026-11-02,p-fin,1,true,4,0');
    T.check('…the toast says so, the request\'s tab closed', (await toast()).startsWith('The demo starts again on Mon 2 Nov 2026') && !(await page.$('.nx-tab[data-tab-id^="request:"]')), await toast());
    await page.click('.nx-tab-btn[data-id="accounting"]');
    await page.waitForTimeout(400);
    await page.click('#acctCompanies .fx-co[data-le="LE-FC"]');
    await page.waitForSelector('#acctEmpty', { timeout: 5000 });
    T.check('Accounting follows: nothing from EquipRite yet', (await env.text('#acctEmpty')).startsWith('FleetCo’s Fusion has nothing from EquipRite yet'));

    T.section('runs on the store alone');
    T.eq('no call to any backend', env.calls.join('\n'), '');
    T.eq('no browser errors or warnings', env.errors.join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('future-finance-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
