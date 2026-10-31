'use strict';
/*
 * EquipRite Future · Money in a real browser: Charges & statements, the Intercompany workbench, Customer billing,
 * played by the people who do each step on the story's fixture points (tests/e2e/future-fixture.js):
 *   the charge run (not ready before the month end, the demo clock, what it makes, the result);
 *   'monthEnd' as Sara: the statements, released; as Mark: a line disputed (the reason is required), the rest agreed;
 *     as Sara: the dispute resolved with a part credit;
 *   the workbench: the failure switch on, the invoice pair fails (the error in words) and Retry creates it (AR and AP
 *     with one number), the cross-border pair at the day's rate, internal postings, the reconciliation ✓, the KSA
 *     settlement with its withholding and exchange difference named before it runs, the accounting shown, not posted;
 *   'invoiced' as Lena: the customer invoice and its payment; as Mark: Customer X billed at cost + 40 % (the margin);
 *   'returned' as Lena: the deposit applied to the open invoice;
 * every list exports, no sideways scroll at 1440 and 1024 px, no browser error, no backend call.
 * Needs `npm run build`.
 * Run: node tests/e2e/future-money.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const F = require('./future-fixture');

const T = H.makeAsserter();
const NAMES = { 'p-fin': 'Sara Ahmed', 'p-pcfin': 'Mark Lee', 'p-desk': 'Lena Novak', 'p-pm': 'Priya Raman' };

(async () => {
  const env = await E.start({ port: 19630, app: 'future', init: F.init(F.state('onHire'), 'p-fin') });
  const { page } = env;
  const shots = [];
  const shot = async (name) => {
    // The screen scrolls inside the shell: a tall window shows all of it.
    const size = page.viewportSize();
    const h = await page.evaluate(() => document.querySelector('.nx-content').scrollHeight + 160);
    await page.setViewportSize({ width: size.width, height: Math.min(Math.max(h, size.height), 8000) });
    await page.waitForTimeout(300);
    shots.push(await env.shot(name));
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
  };
  const state = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), F.KEY);
  const until = async (pred, what, ms) => {
    const t0 = Date.now();
    let s = null;
    while (Date.now() - t0 < (ms || 10000)) {
      s = await state();
      if (s && pred(s)) return s;
      await page.waitForTimeout(150);
    }
    throw new Error('timed out waiting for: ' + what);
  };
  const text = async (sel) => ((await page.$(sel)) ? env.text(sel) : '');
  const settle = (ms) => page.waitForTimeout(ms || 400);
  const load = async (point, who, navId) => {
    const s = Object.assign({}, F.state(point), { personaId: who });
    await page.evaluate(([k, j]) => localStorage.setItem(k, j), [F.KEY, JSON.stringify(s)]);
    await env.open('/?open=' + navId);
    await page.waitForSelector('#page-' + navId + ' .nx-kpis', { timeout: 20000 });
  };
  const playAs = async (id) => {
    await page.click('#fxPersona');
    await page.waitForSelector('#fxPersonaPanel');
    await page.click(`#fxPersonaPanel .fx-person[data-id="${id}"]`);
    await page.waitForFunction((n) => { const e = document.getElementById('fxPersonaName'); return e && e.innerText.trim() === n; }, NAMES[id], { timeout: 10000 });
    await settle(500);
  };
  const openTab = async (navId) => {
    await page.click(`.nx-nav-item[data-nav-id="${navId}"]`);
    await page.waitForSelector('#page-' + navId + ' .nx-kpis', { timeout: 15000 });
    await settle(300);
  };
  const download = async (menuSel, itemSel) => {
    await page.click(menuSel);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(itemSel)]);
    const file = path.join(os.tmpdir(), 'future-money-' + dl.suggestedFilename());
    await dl.saveAs(file);
    return { name: dl.suggestedFilename(), lines: fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean) };
  };
  // Nothing wider than the window: the document, the shell's content, and every element of the screen shown.
  const fits = (id) => page.evaluate((pid) => {
    const de = document.documentElement;
    const c = document.querySelector('.nx-content');
    const root = document.getElementById(pid);
    const r = root.getBoundingClientRect();
    const over = Array.prototype.filter.call(root.querySelectorAll('*'), (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > r.right + 1; });
    return de.scrollWidth <= de.clientWidth && c.scrollWidth <= c.clientWidth && over.length === 0 ? 'fits' : 'overflow: ' + over.slice(0, 4).map((e) => e.className || e.tagName).join(', ');
  }, 'page-' + id);
  const st = (s, id) => s.statements.find((x) => x.id === id);

  try {
    T.section('the charge run: ready only after the month end, says what it makes, then does it');
    await env.open('/?open=charges');
    await page.waitForSelector('#page-charges #chRun', { timeout: 30000 });
    T.eq('Sara on 7 Nov: the run panel offers the closed and the current months', await page.$$eval('#chRunPeriods .nx-seg-btn', (b) => b.map((x) => x.innerText.trim()).join(', ')), 'Nov 2026, Oct 2026');
    await page.click('#chRunPeriods .nx-seg-btn[data-value="2026-11"]');
    await page.waitForSelector('#chRunNotReady');
    T.eq('November is not ready yet, in words', await text('#chRunNotReady'), 'Move the demo clock to the month end, 30 Nov 2026.');
    T.check('…and the run button waits', await page.$eval('#chRunGo', (b) => b.disabled));
    T.check('what the run does is listed (rate engine, standby from approved hours, transport, breakdown, minimum hire, damage, loss, statements)',
      /rate engine[\s\S]*approved hours[\s\S]*Transport[\s\S]*Breakdown[\s\S]*Minimum hire[\s\S]*Damage[\s\S]*Loss[\s\S]*One statement per company pair/.test(await text('#chRunDoes')));
    await page.click('#chMoveClock');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Mon 30 Nov 2026', null, { timeout: 10000 });
    await page.waitForSelector('#chRunPreview', { timeout: 10000 });
    T.eq('after the month end: ready', await text('#chRunReady'), 'Ready: Nov 2026 closed on 30 Nov 2026.');
    T.check('before it runs, it says what it will make', (await text('#chRunPreview')).includes('9 new charge lines: 6 intercompany lines on 2 statements (FleetCo → ProjectCo, FleetCo → ProjectCo KSA)'), await text('#chRunPreview'));
    await page.click('#chRunGo');
    let s = await until((x) => x.statements.length === 2, 'two statements');
    T.eq('Run the charges: 9 charge lines, two statements in draft', [s.charges.length, s.statements.map((x) => x.status).join()].join(' | '), '9 | DRAFT,DRAFT');
    await page.waitForSelector('#chRunResult');
    T.eq('…and the result stays on the panel', await text('#chRunResult'), 'Charge run Nov 2026 done: 9 new charge lines, 2 statements made or topped up.');
    T.eq('the statements are listed', await page.$$eval('#chStatements .fxm-st', (a) => a.map((x) => x.dataset.id).join()), 'S2,S1');
    await shot('future-money-run.png');

    T.section('month end, as Sara (owner\'s finance): the statements, released');
    await load('monthEnd', 'p-fin', 'charges');
    const s1 = '#chStatements .fxm-st[data-id="S1"]';
    const s2 = '#chStatements .fxm-st[data-id="S2"]';
    T.eq('FleetCo → ProjectCo, intercompany · domestic, in words, with its total', [await text(s1 + ' .fxm-st-pair'), await text(s1 + ' .fx-chip--ic'), await text(s1 + ' .fxm-st-status'), await text(s1 + ' .fxm-st-amount')].join(' | '),
      'FleetCo → ProjectCo | Intercompany · domestic | Draft: owner to check and release | AED 72,750.00');
    T.eq('FleetCo → ProjectCo KSA, cross-border', [await text(s2 + ' .fxm-st-pair'), await text(s2 + ' .fx-chip--xb')].join(' | '), 'FleetCo → ProjectCo KSA | Intercompany · cross-border');
    T.eq('its lines: kind, unit, request, project and task, quantity, amount, status', await page.$$eval(s1 + ' .fxm-line[data-id="CH00004"] [role="cell"]', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'Rental 24 days, 7 Nov – 30 Nov, at AED 15,000.00 a week or AED 3,000.00 a day | CR-2001 FR-1002 | PC-C-2207 · 2.1 Excavation | 24 days | AED 54,000.00 | On a statement');
    T.check('before Release, it says what it does and what Fusion does', (await text(s1 + ' .fxm-st-acts')).includes('to agree or dispute by 3 Dec 2026; no answer by then accepts it. In Fusion: nothing yet'));
    T.check('the rules: silence accepts after 3 days, disputed lines held, the rest goes on', /not answered in 3 days is agreed by itself[\s\S]*disputed line is held; the rest of the statement goes on/.test(await text('#chRules')));
    T.check('Sara, not the user, cannot agree or dispute', !(await page.$('.fxm-st-agree')) && !(await page.$('.fxm-line-dispute')));
    T.eq('the waiting customer and same-company lines, with their screens', [await text('#chWaitingCustomer b'), await text('#chWaitingInternal b')].join(' | '), '2 lines · AED 9,760.00 | 1 line · AED 1,620.00');
    const csv = await download('#chExport', '#chStatementsCard .nx-menu-item[data-list="statements"][data-format="csv"]');
    T.eq('the statements export (CSV): a header and the two statements', [csv.lines.length, csv.lines[0].split(',').slice(0, 3).join(','), csv.lines.slice(1).map((l) => l.split(',')[0]).join(' ')].join(' | '),
      '3 | Statement,Period,Owner company | ICS-2026-11-002 ICS-2026-11-001');
    const lines = await download('#chExport', '#chStatementsCard .nx-menu-item[data-list="lines"][data-format="csv"]');
    T.eq('…and their lines', lines.lines.length, 10);
    await page.click(s1 + ' .fxm-st-release');
    await until((x) => st(x, 'S1').status === 'RELEASED', 'S1 released');
    await page.click(s2 + ' .fxm-st-release');
    s = await until((x) => st(x, 'S2').status === 'RELEASED', 'S2 released');
    T.eq('Release: both released, the answer due in three days', [st(s, 'S1').dueBy, st(s, 'S2').dueBy].join(), '2026-12-03,2026-12-03');
    await page.waitForFunction(() => /Released: waiting for the user/.test(document.querySelector('#chStatements .fxm-st[data-id="S1"] .fxm-st-status').innerText), null, { timeout: 5000 });
    T.eq('…the statement says who is next', await text(s1 + ' .fxm-st-nexttext'), 'ProjectCo Projects agrees or disputes it by 3 Dec 2026; no answer by then accepts it.');

    T.section('as Mark (ProjectCo finance, the user): dispute a line with a reason, agree the rest');
    await playAs('p-pcfin');
    T.check('the charges screen stays open to Mark', !!(await page.$('#page-charges .fxm-st-agree')));
    await page.click(s1 + ' .fxm-line[data-id="CH00004"] .fxm-line-dispute');
    await page.waitForSelector('#chDisputeForm');
    T.check('the form asks why, and says what disputing does', (await text('#chDisputeForm')).includes('Required: FleetCo Fleet sees it.') && (await text('#chDisputeForm')).includes('The rest of the statement goes on.'));
    await page.click('#chDisputeSend');
    await page.waitForSelector('#chDisputeFail');
    T.eq('without a reason: refused, in words, and it stays', await text('#chDisputeFail'), 'Not done: Give the reason for the dispute: the owner sees it and resolves the line.');
    T.eq('…nothing changed', (await state()).charges.find((c) => c.id === 'CH00004').status, 'IN_STATEMENT');
    await page.fill('#chReason', 'Crane idle 2 days waiting for permits');
    await page.click('#chDisputeSend');
    s = await until((x) => x.charges.find((c) => c.id === 'CH00004').status === 'DISPUTED', 'crane disputed');
    T.eq('with a reason: the line disputed, the statement in dispute', [st(s, 'S1').status, s.charges.find((c) => c.id === 'CH00004').dispute.reason].join(' | '), 'DISPUTED | Crane idle 2 days waiting for permits');
    await page.waitForSelector(s1 + ' .fxm-line[data-id="CH00004"] .fxm-line-dispute-text');
    T.check('…the line shows the dispute', (await text(s1 + ' .fxm-line[data-id="CH00004"] .fxm-line-dispute-text')).includes('Crane idle 2 days waiting for permits'));
    T.check('Agree says the disputed line stays held', (await text(s1 + ' .fxm-st-acts')).includes('Agrees 5 lines (AED 18,750.00); 1 disputed line stays held'), await text(s1 + ' .fxm-st-acts'));
    await page.click(s1 + ' .fxm-st-agree');
    s = await until((x) => st(x, 'S1').status === 'PARTLY_AGREED', 'S1 partly agreed');
    T.eq('Agree: the rest agreed, the disputed line held', s.charges.filter((c) => c.statementId === 'S1').map((c) => c.status).join(), 'ACCEPTED,ACCEPTED,ACCEPTED,DISPUTED,ACCEPTED,ACCEPTED');
    await page.click(s2 + ' .fxm-st-agree');
    s = await until((x) => st(x, 'S2').status === 'AGREED', 'S2 agreed');
    T.check('Mark agrees the KSA statement too (ProjectCo KSA is his)', st(s, 'S2').agreedBy === 'Mark Lee');
    await shot('future-money-statements-mark.png');

    T.section('as Sara (owner): resolve the dispute with a part credit');
    await playAs('p-fin');
    await page.click(s1 + ' .fxm-line[data-id="CH00004"] .fxm-line-resolve');
    await page.waitForSelector('#chResolveForm');
    T.eq('the credit starts at the disputed amount', await page.$eval('#chCredit', (i) => i.value), '54000');
    T.check('credit and keep each say what they do', (await text('#chResolveForm')).includes('Adds a credit line to the statement') && (await text('#chResolveForm')).includes('Keeps the charge and sends it back to ProjectCo Projects'));
    await page.fill('#chCredit', '60000');
    await page.click('#chCreditSend');
    await page.waitForSelector('#chResolveFail');
    T.eq('more than the line: refused, in words', await text('#chResolveFail'), 'Not done: Give a credit between AED 0.01 and AED 54,000.00 (the disputed amount).');
    await page.fill('#chCredit', '6000');
    await page.click('#chCreditSend');
    s = await until((x) => x.charges.some((c) => c.kind === 'CREDIT'), 'the credit');
    T.eq('Credit: a credit line of −6,000, the line agreed, the statement agreed', [s.charges.find((c) => c.kind === 'CREDIT').amount, s.charges.find((c) => c.id === 'CH00004').status, st(s, 'S1').status].join(' | '), '-6000 | ACCEPTED | AGREED');
    await page.waitForSelector(s1 + ' .fxm-line[data-kind="CREDIT"]');
    T.check('…the credit line shows on the statement, and the dispute is resolved', (await text(s1 + ' .fxm-line[data-kind="CREDIT"]')).includes('AED −6,000.00')
      && (await text(s1 + ' .fxm-disputes')).includes('Credit given (Sara Ahmed)'));
    await shot('future-money-charges.png');

    T.section('the Intercompany workbench: the invoice pair, a failure and Retry');
    await openTab('ic-workbench');
    const w1 = '#wbCreate .fxm-pair[data-id="S1"]';
    const w2 = '#wbCreate .fxm-pair[data-id="S2"]';
    T.eq('two agreed statements to create', await page.$$eval('#wbCreate .fxm-pair', (a) => a.map((x) => x.dataset.id).join()), 'S1,S2');
    T.eq('before it runs: the AR in FleetCo, net, VAT, total', [await text(w1 + ' .fxm-ar-number'), await text(w1 + ' .fxm-ar-vat'), await text(w1 + ' .fxm-pv-ar .fxm-dl-total')].join(' | '),
      'FL-ICAR-000101 | VAT 5 %: AED 3,337.50 | Total AED 70,087.50');
    T.eq('…the AP in ProjectCo, one line per project and task', await page.$$eval(w1 + ' .fxm-costlines li b', (b) => b.map((x) => x.innerText.trim()).join(' | ')),
      'PC-INT-014 · 1.1 Site works | PC-INT-014 · 1.1 Site works | PC-C-2207 · 2.1 Excavation | PC-C-2207 · 2.1 Excavation');
    T.eq('…its tax and what is payable', [await text(w1 + ' .fxm-ap-vat'), await text(w1 + ' .fxm-pv-ap .fxm-dl-total')].join(' | '), 'Input VAT AED 3,337.50 (recoverable) | Payable to FleetCo AED 70,087.50');
    T.eq('…and the cost per project in PPM', await page.$$eval(w1 + ' .fxm-pv-ppm li', (l) => l.map((x) => x.dataset.project + ' ' + x.querySelector('.fxm-num').innerText.trim()).join(' | ')),
      'P-INT AED 15,000.00 | P-EXT AED 51,750.00');
    T.eq('the cross-border pair: no VAT on the AR; the AP in SAR at the day\'s rate, VAT self-assessed', [await text(w2 + ' .fxm-ar-vat'), await text(w2 + ' .fxm-ap-rate'), await text(w2 + ' .fxm-ap-vat')].join(' | '),
      'No VAT: reverse charge (cross-border), ProjectCo KSA self-assesses it | SAR · 1 AED = 1.0216 SAR, the rate of 30 Nov 2026 | VAT self-assessed SAR 1,045.89 (15 %, reverse charge: input and output VAT, no cash)');
    await page.click(w1 + ' .fxm-acc-toggle');
    await page.waitForSelector(w1 + ' .fxm-accgrid');
    T.check('the accounting Fusion would make, shown, not posted', (await text(w1 + ' .fxm-accs')).includes('Shown, not posted') && (await text(w1 + ' .fxm-accs')).includes('1210 Intercompany receivable · ProjectCo 70,087.50'));
    await page.click('#wbSwitch');
    s = await until((x) => x.settings.simulateFailure === true, 'the failure switch on');
    await page.waitForSelector(w1 + ' .fxm-willfail');
    T.check('the switch on: the page says this try fails once', (await text('#wbDemoOn')).includes('Demo switch on') && (await text(w1 + ' .fxm-willfail')).includes('fails once'));
    await page.click(w1 + ' .fxm-pair-go');
    s = await until((x) => st(x, 'S1').status === 'FAILED', 'the pair failed');
    await page.waitForSelector(w1 + ' .fxm-pair-error');
    T.check('the pair failed: the error stays on the statement, in words', (await text(w1 + ' .fxm-pair-error')).includes('Fusion Payables rejected the AP invoice: supplier site FleetCo is not enabled for ProjectCo Projects'));
    T.eq('…nothing created in either company, and the button says Retry', [s.tx.filter((t) => t.kind === 'IC_AR' || t.kind === 'IC_AP').length, await text(w1 + ' .fxm-pair-go')].join(' | '), '0 | Retry the invoice pair');
    await shot('future-money-workbench-failed.png');
    await page.click(w1 + ' .fxm-pair-go');
    s = await until((x) => st(x, 'S1').pair && st(x, 'S1').pair.status === 'CREATED', 'the pair created');
    const ar = s.tx.find((t) => t.id === st(s, 'S1').pair.arTx);
    const ap = s.tx.find((t) => t.id === st(s, 'S1').pair.apTx);
    T.eq('Retry: the AR in FleetCo and the AP in ProjectCo, one number', [ar.le, ap.le, ar.number, ap.number].join(' '), 'LE-FC LE-PC FL-ICAR-000101 FL-ICAR-000101');
    T.eq('…as the preview said', ar.entered.amount, 70087.5);
    await until((x) => x.settings.simulateFailure === false, 'the failure switch off by itself after one failure');
    await page.waitForSelector(w2 + ' .fxm-pair-go');
    T.check('the switch off: no failure announced', !(await page.$(w2 + ' .fxm-willfail')) && !(await page.$('#wbDemoOn')));
    await page.click(w2 + ' .fxm-pair-go');
    s = await until((x) => st(x, 'S2').pair && st(x, 'S2').pair.status === 'CREATED', 'the KSA pair');
    T.eq('the KSA pair: AP in SAR, reverse charge', [s.tx.find((t) => t.id === st(s, 'S2').pair.apTx).currency, st(s, 'S2').pair.vat, st(s, 'S2').pair.reverseCharge > 0].join(), 'SAR,0,true');
    T.check('…and the cost reached PPM on each project', s.tx.filter((t) => t.kind === 'PROJECT_COST').map((t) => t.refs.projectId).sort().join() === 'P-EXT,P-INT,P-KSA');

    T.section('internal postings, the reconciliation');
    T.check('the same-company cross-charge waits, and says no invoice, no tax', (await text('#wbInternal')).includes('No invoice, no tax: one legal entity (OD-14).'));
    await page.click('#wbInternalGo');
    s = await until((x) => x.tx.some((t) => t.kind === 'CROSS_CHARGE'), 'the cross-charge');
    T.eq('Post to PPM: the cross-charge posted, no invoice', [s.tx.filter((t) => t.kind === 'CROSS_CHARGE').length, s.charges.find((c) => c.relation === 'SAME_LE').status].join(), '1,POSTED');
    await page.waitForSelector('#wbNoInternal');
    await page.waitForSelector('#wbReconRows .fxm-recon[data-number="ICS-2026-11-002"]');
    T.eq('reconciliation: charges = AR = AP for both statements', await page.$$eval('#wbReconRows .fxm-recon', (r) => r.map((x) => x.dataset.number + ' ' + x.querySelector('.fxm-recon-check').innerText.trim()).join(' | ')),
      'ICS-2026-11-001 ✓ Equal | ICS-2026-11-002 ✓ Equal');
    T.check('…with the amounts side by side', (await text('#wbReconRows .fxm-recon[data-number="ICS-2026-11-002"]')).includes('AED 6,825.00 AED 6,825.00 AED 6,825.00 (booked SAR 6,972.61)'));
    const rc = await download('#wbRecon .nx-export .nx-btn', '#wbRecon .nx-menu-item[data-format="csv"]');
    T.eq('the reconciliation exports', [rc.lines.length, rc.lines[0]].join(' | '), '3 | Statement,Invoice pair,EquipRite charges,AR (owner),AP (user),Check');

    T.section('settle the KSA statement: withholding and the exchange difference, named before it runs');
    await page.click('#fxDay');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Tue 1 Dec 2026', null, { timeout: 5000 });
    await page.click('#fxDay');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Wed 2 Dec 2026', null, { timeout: 5000 });
    await settle(500);
    const k = '#wbSettle .fxm-settle[data-id="S2"]';
    T.eq('withholding: 5 % of the net, kept by ProjectCo KSA for its tax authority', await text(k + ' .fxm-wht'),
      'Withholding 5 % of the net: ProjectCo KSA keeps AED 341.25 and pays it to Saudi Arabia\'s tax authority; FleetCo books a withholding tax credit.');
    T.eq('the exchange difference, with both rates', await text(k + ' .fxm-fxdiff'), 'Exchange gain of SAR 2.51 in ProjectCo KSA: invoiced at 1.0216, settled at 1.0213.');
    T.eq('the domestic one: no withholding, no exchange difference', [await text('#wbSettle .fxm-settle[data-id="S1"] .fxm-wht'), await text('#wbSettle .fxm-settle[data-id="S1"] .fxm-fxdiff')].join(' | '),
      'No withholding tax (domestic). | Same currency (AED): no exchange difference.');
    await page.click(k + ' .fxm-acc-toggle');
    await page.waitForSelector(k + ' .fxm-accgrid');
    T.check('…and the accounting in both companies, shown', (await text(k + ' .fxm-accs')).includes('1410 Withholding tax credit') && (await text(k + ' .fxm-accs')).includes('4900 Exchange gain'));
    await shot('future-money-workbench.png');
    await page.click(k + ' .fxm-settle-go');
    s = await until((x) => st(x, 'S2').status === 'SETTLED', 'KSA settled');
    T.eq('Settle: netted, net of withholding, with the exchange difference', [st(s, 'S2').pair.settled.wht, st(s, 'S2').pair.settled.fxDiff].join(' | '), '341.25 | -2.51');
    await page.click('#wbSettle .fxm-settle[data-id="S1"] .fxm-settle-go');
    s = await until((x) => st(x, 'S1').status === 'SETTLED', 'S1 settled');
    T.check('both settled, nothing left to settle', s.statements.every((x) => x.status === 'SETTLED') && !!(await page.waitForSelector('#wbNothingToSettle')));

    T.section('the transactions created, each with its accounting');
    await page.click('#wbTxKinds .nx-chip[data-value="IC_AR"]');
    await page.waitForFunction(() => Array.prototype.every.call(document.querySelectorAll('#wbTxRows .fxm-tx'), (x) => x.dataset.kind === 'IC_AR'), null, { timeout: 5000 });
    T.eq('the IC AR invoices', await page.$$eval('#wbTxRows .fxm-tx .fxm-tx-number', (a) => a.map((x) => x.innerText.trim()).join()), 'FL-ICAR-000102,FL-ICAR-000101');
    await page.click('#wbTxKinds .nx-chip[data-value="IC_AP"]');
    await page.waitForFunction(() => document.querySelector('#wbTxRows .fxm-tx') && document.querySelector('#wbTxRows .fxm-tx').dataset.kind === 'IC_AP', null, { timeout: 5000 });
    await page.click('#wbTxRows .fxm-tx:first-child .fxm-tx-row');
    await page.waitForSelector('#wbTxRows .fxm-tx:first-child .fxm-accgrid');
    T.check('an AP opens to its accounting: entered in AED, booked in SAR at the rate, shown not posted', /Shown, not posted[\s\S]*Entered AED 6,825\.00, booked in SAR at 1\.0216/.test(await text('#wbTxRows .fxm-tx:first-child .fxm-tx-acc'))
      && (await text('#wbTxRows .fxm-tx:first-child .fxm-tx-acc')).includes('2110 Intercompany payable · FleetCo'));
    await page.click('#wbTxKinds .nx-chip[data-value=""]');
    await page.waitForFunction(() => document.querySelectorAll('#wbTxRows .fxm-tx').length > 6, null, { timeout: 5000 });
    const tx = await download('#wbTx .nx-export .nx-btn', '#wbTx .nx-menu-item[data-format="csv"]');
    T.check('the transactions export, one row per accounting line', tx.lines.length > 20 && tx.lines[0].startsWith('Transaction,Kind,Company,Date,What,Account,Account name,Debit,Credit'));

    T.section('Customer billing, \'invoiced\' as Lena (rental desk): the customer invoice and its payment');
    await load('invoiced', 'p-desk', 'billing');
    const inv = '#blInvoices .fxm-inv[data-number="FC-AR-000013"]';
    T.eq('FleetCo\'s invoice to Customer Y, open', [await text(inv + ' .fxm-tx-number'), await text(inv + ' .fxm-tx-kind .nx-cell-main'), await text(inv + ' .fxm-inv-open')].join(' | '),
      'FC-AR-000013 · Customer invoice | Customer Y · Gulf Builders | Open AED 10,248.00');
    T.check('Record the payment says what it does first', (await text(inv + ' .fxm-inv-pay')).includes('Records the payment of AED 10,248.00 from Customer Y · Gulf Builders in Fusion Receivables (Dr bank, Cr receivable)'));
    T.check('the deposit is held until the return', (await text('#blDeposits')).includes('Received 2 Nov 2026: held until the return inspection'));
    await page.click(inv + ' .fxm-tx-row');
    await page.waitForSelector(inv + ' .fxm-accgrid');
    T.check('the invoice opens to its accounting, with VAT, shown not posted', /Shown, not posted[\s\S]*1200[\s\S]*10,248\.00[\s\S]*2200 Output VAT[\s\S]*488\.00/.test(await text(inv + ' .fxm-tx-acc')));
    await page.click(inv + ' .fxm-pay-go');
    s = await until((x) => x.tx.some((t) => t.kind === 'CUSTOMER_RECEIPT'), 'the receipt');
    T.eq('Record the payment: the invoice paid, a receipt in FleetCo', [s.tx.find((t) => t.number === 'FC-AR-000013').open, s.tx.find((t) => t.kind === 'CUSTOMER_RECEIPT').le].join(), '0,LE-FC');
    await page.waitForFunction((sel) => /Paid/.test((document.querySelector(sel) || {}).innerText || ''), inv + ' .fxm-inv-open', { timeout: 5000 });
    T.check('…the invoice says paid, and when', (await text(inv + ' .fxm-inv-state')).startsWith('Paid Paid 30 Nov 2026'));
    const ic = await download('#blInvoicesCard .nx-export .nx-btn', '#blInvoicesCard .nx-menu-item[data-format="csv"]');
    T.eq('the invoices export', ic.lines.length, 2);

    T.section('as Mark (ProjectCo finance): bill Customer X at cost plus the mark-up');
    await playAs('p-pcfin');
    const pj = '#blS2 .fxm-prj[data-id="P-EXT"]';
    await page.waitForSelector(pj + ' .fxm-bill-go', { timeout: 10000 });
    T.check('the mode, and never both', (await text('#blMode')).includes('PPM contract billing (OD-07 a)') && (await text('#blMode')).includes('Never both'));
    T.eq('before it runs: cost from the IC AP, mark-up 40 %, the margin, the bill', [await text(pj + ' .fxm-bill-pv')].join(),
      'Equipment cost (from the IC AP) AED 57,750.00 Mark-up 40 % AED 23,100.00 Bill AED 80,850.00 VAT AED 4,042.50 Customer pays AED 84,892.50');
    await page.click(pj + ' .fxm-bill-go');
    s = await until((x) => x.tx.some((t) => t.kind === 'PROJECT_BILL'), 'the project bill');
    const bill = s.tx.find((t) => t.kind === 'PROJECT_BILL');
    T.eq('Bill the customer: ProjectCo\'s PPM invoice, the margin kept', [bill.le, bill.cost, bill.margin, bill.open].join(' | '), 'LE-PC | 57750 | 23100 | 84892.5');
    await page.waitForSelector('#blInvoices .fxm-inv .fxm-inv-margin');
    T.eq('…the invoice shows the margin', await text('#blInvoices .fxm-inv .fxm-inv-margin'), 'Margin AED 23,100.00 on cost AED 57,750.00');
    T.check('…and the cost line says it is billed', (await text(pj + ' .fxm-costs')).includes('Billed on ' + bill.number));
    await shot('future-money-billing.png');

    T.section('\'returned\' as Lena: the deposit applied to the open invoice');
    await load('returned', 'p-desk', 'billing');
    const dp = '#blDeposits .fxm-deposit[data-id="R1004"]';
    T.check('Settle the deposit says what it does', (await text(dp)).includes('Applies AED 2,100.00 to the open invoices of Customer Y · Gulf Builders and refunds AED 0.00'));
    await page.click(dp + ' .fxm-deposit-settle');
    s = await until((x) => x.requests.find((r) => r.id === 'R1004').deposit.settled, 'the deposit settled');
    T.eq('Settle the deposit: applied, nothing refunded, the invoice open for the rest', [s.requests.find((r) => r.id === 'R1004').deposit.settled.applied, s.tx.find((t) => t.number === 'FC-AR-000013').open].join(), '2100,8148');

    T.section('fits the window');
    await load('agreed', 'p-fin', 'charges');
    await openTab('ic-workbench');
    await openTab('billing');
    for (const w of [1440, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await settle(300);
      for (const id of ['charges', 'ic-workbench', 'billing']) {
        await page.click(`.nx-tab-btn[data-id="${id}"]`);
        await settle(400);
        T.eq(`${w}px, ${id}: no sideways scroll`, await fits(id), 'fits');
      }
    }
    await page.click('.nx-tab-btn[data-id="ic-workbench"]');
    await settle(300);
    await shot('future-money-workbench-1024.png');
    await page.setViewportSize({ width: 1440, height: 1000 });

    T.section('runs on the store alone');
    T.eq('no call to any backend', env.calls.join('\n'), '');
    T.eq('no browser errors or warnings', env.errors.join('\n'), '');
    console.log('screenshots:\n  ' + shots.join('\n  '));
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('future-money-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
