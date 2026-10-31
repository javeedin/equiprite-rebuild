/*
 * EquipRite Future · Money (resources/js/future/fxMoney.js): what Charges & statements, the Intercompany workbench and
 * Customer billing add to their views, played on the story's fixture points (tests/e2e/future-fixture.js) with the
 * real engine. Every preview is a dry run: it must leave the state alone and show exactly what the action then does.
 * Also the page's own logic: forms, checks, failures kept in view, picks, exports of every list.
 *
 * Run:  node tests/future-money.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');
const Fx = require('./e2e/future-fixture');

const T = H.makeAsserter();
const APP = path.join(__dirname, '..', 'webApps', 'equiprite-future');
const mods = {};
function load(id) {
  if (mods[id]) return mods[id];
  const file = path.join(APP, id + '.js');
  const sandbox = { console, JSON, Math, Date, Object, Array, String, Number, Boolean, Error };
  sandbox.define = (deps, factory) => { mods[id] = factory(...deps.map(load)); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return mods[id];
}
const Seed = load('resources/js/future/fxSeed');
const E = load('resources/js/future/fxEngine');
const V = load('resources/js/future/fxViews');
const M = load('resources/js/future/fxMoney');

let s;
const as = (id) => { s = E.apply(s, 'setPersona', { id }).state; };
const act = (type, payload) => { const r = E.apply(s, type, payload); if (!r.ok) throw new Error(type + ': ' + r.error); s = r.state; return r.result; };
const charges = (ui) => M.charges(s, V.charges(s, (ui && ui.period) ? { period: ui.period } : {}), ui || {});
const workbench = (ui) => M.workbench(s, V.workbench(s), ui || {});
const billing = (ui) => M.billing(s, V.billing(s), ui || {});
const st = (id) => s.statements.find((x) => x.id === id);

T.section('the charge run: ready after the month end, a dry run says what it makes');
s = Fx.state('onHire');
as('p-fin');
let c = charges({ runPeriod: '2026-11' });
T.eq('7 Nov: November is not ready, and says what to do', [c.run.ready, c.run.notReadyText, c.run.canMoveClock].join(' | '), 'false | Move the demo clock to the month end, 30 Nov 2026. | true');
T.eq('…the periods offered', c.run.options.map((o) => o.key + (o.ready ? '' : '*')).join(), '2026-11*,2026-10');
T.check('what the run does: eight points, Fusion untouched', c.run.does.length === 8 && /nothing yet/.test(c.run.fusion));
act('toMonthEnd');
const before = JSON.stringify(s);
c = charges({ runPeriod: '2026-11' });
T.eq('the dry run left the state alone', JSON.stringify(s) === before, true);
T.eq('30 Nov: ready, and the preview counts what the run makes', [c.run.ready, c.run.preview.made, c.run.preview.statements, c.run.preview.kinds.map((k) => k.text).join(', ')].join(' | '), 'true | 9 | 2 | Rental 5, Transport 4');
const ran = act('runCharges', { period: '2026-11' });
T.eq('…exactly what the run then made', [ran.made, ran.statements].join(), '9,2');
T.eq('afterAct keeps the result in words', M.afterAct({ type: 'runCharges' }, { ok: true, result: ran }, s, {}).set.lastRun.text, 'Charge run Nov 2026 done: 9 new charge lines, 2 statements made or topped up.');
T.check('a rerun says nothing new', /Nothing new to charge for Nov 2026/.test(charges({ runPeriod: '2026-11' }).run.preview.words));

T.section('statements: who does what');
s = Fx.state('monthEnd');
as('p-fin');
c = charges({});
const c1 = c.statements.find((x) => x.id === 'S1');
T.eq('Sara: the owner releases, the pair and relationship in words', [c1.pairText, c1.relTone, c1.statusTone, c1.canRelease, c1.canAgree].join(' | '), 'FleetCo → ProjectCo | ic | na | true | false');
T.check('Release says what it does, and what Fusion does', /to agree or dispute by 3 Dec 2026; no answer by then accepts it\. In Fusion: nothing yet/.test(c1.releaseDoes));
T.eq('lines: the detail with its money', c1.rows.find((r) => r.id === 'CH00004').detail, '24 days, 7 Nov – 30 Nov, at AED 15,000.00 a week or AED 3,000.00 a day');
T.eq('the rules, the dispute window from the settings', c.rules.map((r) => r.key).join(), 'silence,held,damage,rerun,duties');
T.eq('waiting elsewhere: customer and same company', [c.waitingCustomer.length, c.waitingCustomerTotal, c.waitingInternal.length, c.waitingInternalTotal].join(' | '), '2 | AED 9,760.00 | 1 | AED 1,620.00');
T.eq('period chips with counts', c.periodChips.map((p) => p.label + ' ' + p.count).join(', '), 'All periods 2, Nov 2026 2');
s.statements.forEach((x) => act('releaseStatement', { statementId: x.id }));
as('p-pcfin');
c = charges({});
let m1 = c.statements.find((x) => x.id === 'S1');
T.eq('Mark: the user agrees or disputes each line, cannot release', [m1.canRelease, m1.canAgree, m1.rows.every((r) => r.canDispute), m1.rows.some((r) => r.canResolve)].join(), 'false,true,true,false');
T.eq('a dispute needs a reason (the page says so first)', M.check(s, M.withForm({ type: 'disputeCharge', payload: { chargeId: 'CH00004' } }, { reason: '  ' })), 'Give the reason for the dispute: the owner sees it and resolves the line.');
const dreq = M.withForm({ type: 'disputeCharge', payload: { chargeId: 'CH00004' } }, { reason: ' Crane idle 2 days ' });
T.eq('…the reason comes from the open form', [dreq.payload.reason, M.check(s, dreq)].join('|'), 'Crane idle 2 days|');
act('disputeCharge', dreq.payload);
act('acceptStatement', { statementId: 'S1' });
m1 = charges({}).statements.find((x) => x.id === 'S1');
T.eq('disputed and agreed: the line held, in words', [m1.status, m1.rows.find((r) => r.id === 'CH00004').disputeText].join(' | '), 'PARTLY_AGREED | “Crane idle 2 days” · Mark Lee, 30 Nov 2026');
as('p-fin');
const r1 = charges({}).statements.find((x) => x.id === 'S1').rows.find((r) => r.id === 'CH00004');
T.eq('Sara resolves it: up to the disputed amount', [r1.canResolve, r1.maxCreditText].join(' | '), 'true | AED 54,000.00');
T.eq('a credit above the line is refused, in words', M.check(s, M.withForm({ type: 'resolveDispute', payload: { chargeId: 'CH00004', resolution: 'credit' } }, { credit: '60000' })),
  'Give a credit between AED 0.01 and AED 54,000.00 (the disputed amount).');
T.check('…and an empty one', !!M.check(s, M.withForm({ type: 'resolveDispute', payload: { chargeId: 'CH00004', resolution: 'credit' } }, { credit: '' })));
T.eq('keeping needs no amount', M.check(s, M.withForm({ type: 'resolveDispute', payload: { chargeId: 'CH00004', resolution: 'keep' } }, { credit: '' })), '');
const fail = M.failure(s, { type: 'disputeCharge', payload: { chargeId: 'CH00004' } }, 'Say why.');
T.eq('a failure on a line is shown on its statement and its form', [fail.ref, fail.chargeId, fail.text].join(' | '), 'S1 | CH00004 | Say why.');
T.eq('…the run, the internal postings, the switch, an invoice', ['runCharges', 'postInternal', 'setSetting'].map((t) => M.failure(s, { type: t, payload: {} }, 'x').ref).concat([M.failure(s, { type: 'customerPays', payload: { txId: 'T9' } }, 'x').ref]).join(), 'run,internal,switch,T9');
T.eq('a failed engine answer stays; a good one clears it and closes the forms', JSON.stringify([M.afterAct({ type: 'acceptStatement', payload: { statementId: 'S1' } }, { ok: false, error: 'Nothing to agree.' }, s, {}).set.failure.ref,
  M.afterAct({ type: 'x' }, { ok: true }, s, { ui: { disputing: 'CH1', reason: 'r', txKind: 'IC_AR' } }).set.ui]), '["S1",{"disputing":"","reason":"","txKind":"IC_AR","resolving":"","credit":""}]');
act('resolveDispute', { chargeId: 'CH00004', resolution: 'credit', amount: 6000 });
T.eq('resolved: the dispute says so', charges({}).statements.find((x) => x.id === 'S1').rows.find((r) => r.id === 'CH00004').resolvedText, 'Credit given by Sara Ahmed, 30 Nov 2026');

T.section('picks: the page\'s own state');
const vars = { ui: { disputing: '', reason: '', resolving: '', credit: '' }, exportOpen: '' };
T.eq('a period reloads the view', JSON.stringify(M.pick(vars, 'period', '2026-11', s)), '{"set":{"period":"2026-11"},"reload":true}');
T.eq('Dispute opens the line\'s form (again closes it)', [M.pick(vars, 'dispute', 'CH00001', s).set.ui.disputing, M.pick({ ui: { disputing: 'CH00001' } }, 'dispute', 'CH00001', s).set.ui.disputing].join('|'), 'CH00001|');
T.eq('Resolve opens with the full amount as the credit', M.pick(vars, 'resolve', 'CH00002', s).set.ui.credit, '600');
T.eq('an accounting opens and closes', [JSON.stringify(M.pick(vars, 'tx', 'T1', s).set.ui.openTx), JSON.stringify(M.pick({ ui: { openTx: { T1: true } } }, 'tx', 'T1', s).set.ui.openTx)].join(' '), '{"T1":true} {}');
T.eq('an export menu toggles', [M.pick(vars, 'exportOpen', 'lines', s).set.exportOpen, M.pick({ exportOpen: 'lines' }, 'exportOpen', 'lines', s).set.exportOpen].join('|'), 'lines|');

T.section('the workbench: each preview is what the action then creates');
as('p-pcfin'); act('acceptStatement', { statementId: 'S2' });
as('p-fin');
let w = workbench();
T.eq('two pairs to create', w.toCreate.map((x) => x.id).join(), 'S1,S2');
const p1 = w.toCreate.find((x) => x.id === 'S1').preview;
const p2 = w.toCreate.find((x) => x.id === 'S2').preview;
T.eq('S1: the AR in FleetCo, VAT 5 %', [p1.ar.number, p1.ar.company, p1.ar.net, p1.ar.vatText, p1.ar.total].join(' | '), 'FL-ICAR-000101 | FleetCo | AED 66,750.00 | VAT 5 %: AED 3,337.50 | AED 70,087.50');
T.eq('…the AP in ProjectCo, one line per project and task', p1.ap.costLines.map((l) => l.projectTask + ' ' + l.amount).join(' | '),
  'PC-INT-014 · 1.1 Site works AED 13,500.00 | PC-INT-014 · 1.1 Site works AED 1,500.00 | PC-C-2207 · 2.1 Excavation AED 50,250.00 | PC-C-2207 · 2.1 Excavation AED 1,500.00');
T.eq('…the PPM cost per project, billable or not', p1.ppm.map((x) => x.project + ' ' + x.amount + ' ' + x.billable).join(' | '), 'PC-INT-014 AED 15,000.00 false | PC-C-2207 AED 51,750.00 true');
T.eq('S2 cross-border: no VAT, AP in SAR at the day\'s rate, VAT self-assessed', [p2.ar.vatText, p2.ap.currency, p2.ap.rateText, p2.ap.vatText].join(' | '),
  'No VAT: reverse charge (cross-border), ProjectCo KSA self-assesses it | SAR | 1 AED = 1.0216 SAR, the rate of 30 Nov 2026 | VAT self-assessed SAR 1,045.89 (15 %, reverse charge: input and output VAT, no cash)');
T.check('the accounting of the dry run comes with it, balanced', p1.txs.filter((t) => t.hasLines).every((t) => t.balanced) && p1.txs.length === 4);
act('setSetting', { key: 'simulateFailure', value: true });
T.eq('the demo switch: the preview says this try fails', workbench().toCreate.find((x) => x.id === 'S1').preview.willFail, true);
const f1 = act('createInvoicePair', { statementId: 'S1' });
w = workbench();
T.eq('the pair failed: the error in words, the preview still there, no failure announced twice', [f1.failed, w.toCreate.find((x) => x.id === 'S1').failed, /Fusion Payables rejected/.test(w.toCreate.find((x) => x.id === 'S1').errorText), w.toCreate.find((x) => x.id === 'S1').preview.willFail].join(), 'true,true,true,false');
act('createInvoicePair', { statementId: 'S1' });
const ar = s.tx.find((t) => t.id === st('S1').pair.arTx);
const ap = s.tx.find((t) => t.id === st('S1').pair.apTx);
T.eq('Retry made what the preview showed: number, total, AP lines', [ar.number, ap.number, ar.entered.amount].join(' '), 'FL-ICAR-000101 FL-ICAR-000101 70087.5');
act('setSetting', { key: 'simulateFailure', value: false });
act('createInvoicePair', { statementId: 'S2' });
T.eq('S2 as previewed', s.tx.find((t) => t.id === st('S2').pair.apTx).currency, 'SAR');
w = workbench();
T.eq('internal postings previewed: the cross-charge, no invoice', w.internalTxs.map((t) => t.kindText + ' ' + t.amountText + ' ' + t.drcr).join(), 'Cross-charge (PPM) AED 1,620.00 Dr 5150 Project cost · cross-charged equipment · PC-INT-014 / Cr 4300 Equipment cost recovery (cross-charge) · ProjectCo Facilities');
T.eq('reconciliation ✓', w.recon.map((r) => r.number + ' ' + r.diffText).join(' | '), 'ICS-2026-11-001 ✓ Equal | ICS-2026-11-002 ✓ Equal');
T.eq('transactions: the kinds and their counts', w.txChips.map((k) => k.label + ' ' + k.count).join(', '), 'All 7, IC AR 2, IC AP 2, Project cost 3, Settlement 0, Accruals and reversals 0, Cross-charge and own cost 0');
T.eq('…filtered by kind', workbench({ txKind: 'IC_AP' }).txs.map((t) => t.number + ' ' + t.amountText).join(' | '), 'FL-ICAR-000102 AED 6,825.00 (SAR 6,972.61) | FL-ICAR-000101 AED 70,087.50');
T.check('…an AP says it was entered in AED and booked in SAR at the rate', /Entered AED 6,825\.00, booked in SAR at 1\.0216/.test(workbench({ txKind: 'IC_AP' }).txs[0].enteredText));
act('advance', { days: 2 });
const sp = workbench().toSettle.find((x) => x.id === 'S2').preview;
T.eq('settle S2, before it runs: withholding 5 %, the exchange difference', [sp.whtAmount, sp.fxDiff, sp.fxText].join(' | '), 'AED 341.25 | -2.51 | Exchange gain of SAR 2.51 in ProjectCo KSA: invoiced at 1.0216, settled at 1.0213.');
act('settle', { statementId: 'S2' });
T.eq('…exactly what settling did', [st('S2').pair.settled.wht, st('S2').pair.settled.fxDiff].join(), '341.25,-2.51');
T.eq('S1 domestic: no withholding, no difference', workbench().toSettle.find((x) => x.id === 'S1').preview.fxText, 'Same currency (AED): no exchange difference.');

T.section('accruals at the cut-off');
s = Fx.state('released');
as('p-fin');
w = workbench();
T.eq('statements waiting on the user, with who acts and the cut-off', w.waitingUser.map((x) => x.number + ': ' + x.whoText + ' ' + x.cutoffText).join(' | '),
  'ICS-2026-11-001: ProjectCo Projects (user) agrees or disputes it by 3 Dec 2026; silence accepts it then. IC cut-off 4 Dec 2026 | ICS-2026-11-002: ProjectCo KSA Projects (user) agrees or disputes it by 3 Dec 2026; silence accepts it then. IC cut-off 4 Dec 2026');
T.check('Accrue now says what both ledgers get', /Accrue now: books FleetCo AED 72,750\.00, ProjectCo AED 72,750\.00 in both ledgers at 30 Nov 2026/.test(w.waitingUser[0].accrueText));
act('accrueNow', { statementId: 'S1' });
T.check('accrued as said, and not offered again', s.tx.filter((t) => t.kind === 'ACCRUAL').length === 2 && !workbench().waitingUser.find((x) => x.id === 'S1').accrueOk);

T.section('customer billing');
s = Fx.state('agreed');
as('p-desk');
let b = billing();
T.eq('scenario 3: Customer Y\'s charges and the invoice Fusion would make', [b.customers.length, b.customers[0].name, b.customers[0].invoices.map((i) => i.net + ' + ' + i.vatText + ' = ' + i.total).join()].join(' | '),
  '1 | Customer Y · Gulf Builders | AED 9,760.00 + VAT 5 %: AED 488.00 = AED 10,248.00');
T.eq('…e-invoicing is Fusion\'s', b.customers[0].eInvoicing, 'E-invoicing is Fusion\'s, not EquipRite\'s: United Arab Emirates, planned (Fusion localisation).');
act('invoiceCustomer', { customerId: 'C-Y' });
b = billing();
T.eq('…the invoice made as previewed, open', [b.invoices[0].totalText, b.invoices[0].openText, b.invoices[0].canPayNow].join(' | '), 'AED 10,248.00 | AED 10,248.00 | true');
T.check('Record the payment says what it records', /Records the payment of AED 10,248\.00 from Customer Y · Gulf Builders in Fusion Receivables/.test(b.invoices[0].payDoes));
act('customerPays', { txId: b.invoices[0].id });
T.eq('paid, with its receipt', [billing().invoices[0].paid, /^Paid 30 Nov 2026/.test(billing().invoices[0].receiptText)].join(), 'true,true');
T.eq('the deposit: held until the return; only the desk settles it', [billing().deposits[0].statusText, billing().deposits[0].canSettleNow].join(' | '), 'Received 2 Nov 2026: held until the return inspection | false');
s = Fx.state('invoiced');
as('p-pcfin');
b = billing();
const px = b.projects.find((x) => x.id === 'P-EXT');
T.eq('scenario 2: Customer X at cost + 40 %, the margin', [px.preview.cost, px.preview.margin, px.preview.bill, px.preview.total].join(' | '), 'AED 57,750.00 | AED 23,100.00 | AED 80,850.00 | AED 84,892.50');
T.check('…the mode and never both', /PPM contract billing/.test(b.s2ModeText) && /Never both/.test(b.neverBoth));
const billed = act('billProject', { projectId: 'P-EXT' });
T.eq('…billed as previewed', [billed.bill, s.tx.find((t) => t.kind === 'PROJECT_BILL').margin].join(), '80850,23100');
T.eq('…the invoice carries the margin', billing().invoices.find((t) => t.kindWords === 'Project invoice (PPM billing)').marginText, 'Margin AED 23,100.00 on cost AED 57,750.00');
as('p-fin'); act('setSetting', { key: 's2Billing', value: 'EQUIPRITE' });
T.check('the other mode says EquipRite invoices, the contract cost non-billable', /EquipRite invoice from ProjectCo/.test(billing().s2ModeText));
s = Fx.state('returned');
as('p-desk');
const dp = billing().deposits.find((d) => d.id === 'R1004');
T.eq('after the return: settle the deposit, previewed', [dp.canSettleNow, dp.settleText].join(' | '), 'true | Applies AED 2,100.00 to the open invoices of Customer Y · Gulf Builders and refunds AED 0.00 (Fusion Receivables).');

T.section('every list exports, as shown');
s = Fx.state('invoiced');
as('p-fin');
const vs = { charges: charges({}), workbench: workbench(), billing: billing() };
const lists = Object.keys(M.LISTS).reduce((a, pg) => a.concat(Object.keys(M.LISTS[pg]).map((l) => pg + '/' + l)), []);
T.eq('the lists', lists.join(' '), 'charges/statements charges/lines charges/waiting workbench/create workbench/settle workbench/internal workbench/waitingUser workbench/recon workbench/txs billing/waiting billing/deposits billing/projects billing/invoices');
T.check('each has columns, a title and rows as shown', lists.every((x) => { const [pg, l] = x.split('/'); const e = M.exportSpec(pg, l, vs[pg]); return e.columns.length > 2 && e.title && Array.isArray(e.rows) && e.rows.length === M.exportCount(pg, l, vs[pg]); }));
const ex = M.exportSpec('workbench', 'txs', vs.workbench);
T.eq('the transactions: one row per accounting line', [ex.rows.length > 20, ex.columns.map((col) => col.label).slice(5, 9).join()].join(' | '), 'true | Account,Account name,Debit,Credit');
T.eq('…named, with who and when', [ex.name, ex.subtitle].join(' | '), 'equiprite-future-workbench-txs | As Sara Ahmed · Demo date 30 Nov 2026');

T.section('every person, every point: the three screens render');
const bad = [];
Fx.STEPS.forEach((pt) => {
  const base = Fx.state(pt);
  Seed.PERSONAS.forEach((p) => {
    s = Object.assign({}, base, { personaId: p.id });
    try { charges({}); workbench(); billing(); } catch (e) { bad.push(pt + '/' + p.id + ': ' + e.message); }
  });
});
T.eq('no screen fails for anyone', bad.join('; '), '');

T.report();
