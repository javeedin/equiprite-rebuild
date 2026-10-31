/*
 * EquipRite Future (FDD v2.0): the simulated backend, end to end. Every scenario played through the rules: who may do
 * what (requesting BU vs sourcing BU), the money each step makes, the invoice pair, accruals, netting with withholding
 * and exchange differences, customer billing, deposits, damage, loss, moves, and that every company's books balance
 * and the intercompany eliminates.
 *
 * Run:  node tests/future-engine.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const DIR = path.join(__dirname, '..', 'webApps', 'equiprite-future', 'resources', 'js', 'future');
const mods = {};
function load(name) {
  if (mods[name]) return mods[name];
  const sandbox = { console, JSON, Math, Date, Object, Array, String, Number, Error };
  sandbox.define = (deps, factory) => { mods[name] = factory(...deps.map((d) => load(d.split('/').pop()))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(DIR, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mods[name];
}
const Seed = load('fxSeed');
const E = load('fxEngine');
const V = load('fxViews');

let s = Seed.seed();
function as(id) { s = E.apply(s, 'setPersona', { id }).state; }
function act(type, payload, expectFail) {
  const r = E.apply(s, type, payload);
  if (r.ok) s = r.state;
  if (expectFail) return r;
  if (!r.ok) T.check(type + ' worked', false, r.error);
  return r;
}
function advance(n) { act('advance', { days: n }); }
const line = (rid) => s.requests.find((r) => r.id === rid).lines[0];

T.section('who may do what');
as('p-pm');
let r = act('createRequest', { requestingBu: 'BU-FC', projectId: 'P-INT', from: '2026-11-03', to: '2026-12-20', lines: [{ cls: 'EXC', unitId: 'U-EX1' }] }, true);
T.check('a requester raises only for their own BU', !r.ok && /own business units/.test(r.error), r.error);
r = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-KSA', from: '2026-11-03', to: '2026-12-20', lines: [{ cls: 'EXC' }] }, true);
T.check('…and only on their BU\'s projects (MC-FR-10)', !r.ok && /projects/.test(r.error), r.error);
const opts = E.sourcing(s, { requestingBu: 'BU-PC', cls: 'GEN', from: '2026-11-03', to: '2026-12-20' });
T.eq('sourcing: own fleet first, then the same company, then intercompany (MC-FR-11)', [...new Set(opts.map((o) => o.relation))].join(), 'SAME_BU,IC_DOMESTIC');
T.check('…each with the owner, a price and an estimate', opts.every((o) => o.ownerShort && o.price && o.estimate > 0));
T.eq('relationship types', ['BU-PC', 'BU-PF', 'BU-PK'].map((b) => E.relationType(s, 'BU-FC', b)).concat([E.relationType(s, 'BU-PF', 'BU-PC'), E.relationType(s, 'BU-PC', 'BU-PC')]).join(),
  'IC_DOMESTIC,IC_DOMESTIC,IC_CROSS_BORDER,SAME_LE,SAME_BU');

T.section('scenario 1: ProjectCo internal project, FleetCo asset');
r = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-03', to: '2026-12-20', lines: [{ cls: 'EXC', unitId: 'U-EX1' }] });
const r1 = r.result.id;
T.eq('raised: internal project, intercompany domestic, owner FleetCo', [s.requests[0].type, line(r1).relation, line(r1).provider].join(), 'INTERNAL,IC_DOMESTIC,BU-FC');
T.check('…FleetCo\'s Equipment Manager is told', V.notifications(Object.assign({}, s, { personaId: 'p-em' })).rows.some((n) => /approve and allocate/.test(n.text)));
T.eq('My requests (Priya) shows it; Ana (FleetCo) does not see it as hers', [V.requests(s, {}).count, V.requests(Object.assign({}, s, { personaId: 'p-em' }), {}).count].join(), '1,0');
r = act('approveLine', { requestId: r1, lineId: line(r1).id, unitId: 'U-EX1' }, true);
T.check('the requester cannot approve: the sourcing BU does (MC-FR-13)', !r.ok, r.error);
as('p-em');
T.eq('Ana\'s queue: the line that uses her fleet', V.approvals(s).count, 1);
act('approveLine', { requestId: r1, lineId: line(r1).id, unitId: 'U-EX1' });
as('p-yard');
act('shipLine', { requestId: r1, lineId: line(r1).id });
T.eq('an asset ships as custody, no accounting', s.tx.filter((t) => t.kind === 'ASSET_CUSTODY').map((t) => t.lines.length).join(), '0');
advance(1);
as('p-site');
act('receiveLine', { requestId: r1, lineId: line(r1).id });
T.eq('on hire at receipt (OD-05)', line(r1).events.onHire, '2026-11-03');
act('fillHours', { requestId: r1, lineId: line(r1).id });
as('p-pm');
act('approveHours', { requestId: r1, lineId: line(r1).id });

T.section('scenario 2: ProjectCo customer project, FleetCo crane');
r = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-EXT', from: '2026-11-03', to: '2026-12-31', lines: [{ cls: 'CRN', unitId: 'U-CR1' }] });
const r2 = r.result.id;
as('p-em'); act('approveLine', { requestId: r2, lineId: line(r2).id, unitId: 'U-CR1' });
as('p-yard'); act('shipLine', { requestId: r2, lineId: line(r2).id });
as('p-site'); act('receiveLine', { requestId: r2, lineId: line(r2).id });

T.section('cross-border: ProjectCo KSA, FleetCo stock generator');
as('p-pk');
r = act('createRequest', { requestingBu: 'BU-PK', projectId: 'P-KSA', from: '2026-11-05', to: '2026-12-31', lines: [{ cls: 'EXC', unitId: 'U-EX3' }] }, true);
T.check('a unit without a valid KSA certificate for the dates cannot go (MC-FR-18)', !r.ok && /expires|certificate/i.test(r.error), r.error);
r = act('createRequest', { requestingBu: 'BU-PK', projectId: 'P-KSA', from: '2026-11-05', to: '2026-12-31', lines: [{ cls: 'GEN', unitId: 'U-GN1' }] });
const rk = r.result.id;
T.eq('cross-border relationship', line(rk).relation, 'IC_CROSS_BORDER');
as('p-em'); act('approveLine', { requestId: rk, lineId: line(rk).id, unitId: 'U-GN1' });
as('p-yard'); act('shipLine', { requestId: rk, lineId: line(rk).id });
const to = s.tx.filter((t) => t.kind === 'TO_SHIP').pop();
T.eq('stock ships on a transfer order inside FleetCo: its KSA deployment org (GR-6)', [to.le, to.destOrg, to.lines.map((l) => l.account).join('/')].join(), 'LE-FC,FC-DEP-SA,1310/1300');
T.eq('customs: temporary import opened (MC-FR-17)', s.customs.map((c) => c.regime + ' ' + c.from + '→' + c.to + ' ' + c.status).join(), 'Temporary import AE→SA OPEN');
advance(2);
as('p-pk'); act('receiveLine', { requestId: rk, lineId: line(rk).id });
T.eq('received: the deployment org takes it in', s.tx.filter((t) => t.kind === 'TO_RECEIPT').length, 1);
act('fillHours', { requestId: rk, lineId: line(rk).id });
act('approveHours', { requestId: rk, lineId: line(rk).id });

T.section('scenario 3: FleetCo rents to Customer Y');
as('p-desk');
r = act('createRequest', { requestingBu: 'BU-FC', customerId: 'C-W', from: '2026-11-06', to: '2026-11-25', lines: [{ cls: 'GEN' }] }, true);
T.check('a customer on credit hold cannot rent (INT-26)', !r.ok && /credit hold/.test(r.error), r.error);
r = act('createRequest', { requestingBu: 'BU-FC', customerId: 'C-Y', from: '2026-11-06', to: '2026-11-25', lines: [{ cls: 'GEN', unitId: 'U-GN2' }] });
const r3 = r.result.id;
T.eq('customer rental, priced on the customer agreement', [line(r3).relation, line(r3).agreementId].join(), 'CUSTOMER,RA-01');
as('p-em');
r = act('approveLine', { requestId: r3, lineId: line(r3).id, unitId: 'U-GN2' }, true);
T.check('no allocation before the deposit', !r.ok && /deposit/.test(r.error), r.error);
as('p-desk'); act('takeDeposit', { requestId: r3 });
as('p-em'); act('approveLine', { requestId: r3, lineId: line(r3).id, unitId: 'U-GN2' });
as('p-yard'); act('shipLine', { requestId: r3, lineId: line(r3).id });
T.eq('…to FleetCo\'s own customer-site org', s.tx.filter((t) => t.kind === 'TO_SHIP').pop().destOrg, 'FC-CUST-AE');
as('p-desk'); act('receiveLine', { requestId: r3, lineId: line(r3).id });

T.section('same company: Facilities lends a light tower to Projects');
as('p-pm');
r = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-07', to: '2026-11-30', lines: [{ cls: 'TWR', unitId: 'U-TW1' }] });
const rl = r.result.id;
T.eq('cross-charge', line(rl).relation, 'SAME_LE');
as('p-em');
r = act('approveLine', { requestId: rl, lineId: line(rl).id, unitId: 'U-TW1' }, true);
T.check('FleetCo cannot approve Facilities\' unit', !r.ok && /owner/.test(r.error), r.error);
as('p-pf'); act('approveLine', { requestId: rl, lineId: line(rl).id, unitId: 'U-TW1' }); act('shipLine', { requestId: rl, lineId: line(rl).id });
as('p-site'); act('receiveLine', { requestId: rl, lineId: line(rl).id });

T.section('November closes');
as('p-fin');
r = act('runCharges', { period: '2026-11' }, true);
T.check('the open month cannot be charged', !r.ok && /still open/.test(r.error), r.error);
act('toMonthEnd');
T.eq('the demo clock is at the month end', s.today, '2026-11-30');
as('p-site'); act('fillHours', { requestId: r1, lineId: line(r1).id }); act('fillHours', { requestId: r2, lineId: line(r2).id });
as('p-pm'); act('approveHours', { requestId: r1, lineId: line(r1).id }); act('approveHours', { requestId: r2, lineId: line(r2).id });
as('p-fin');
// S3 ends early: off hire on the 20th.
r = act('runCharges', {});
T.eq('charge run November: statements per company pair (FC→PC, FC→PK)', s.statements.map((x) => x.provider + '>' + x.receiver).sort().join(), 'BU-FC>BU-PC,BU-FC>BU-PK');
const stPC = s.statements.find((x) => x.receiver === 'BU-PC');
const rent = s.charges.find((c) => c.requestId === r1 && c.kind === 'RENTAL');
T.eq('rental 3–30 Nov = 28 days = 4 weeks at 3,500', [rent.qty, rent.amount].join(), '28,14000');
T.check('standby charged from approved hours', s.charges.some((c) => c.requestId === r1 && c.kind === 'STANDBY' && c.amount > 0));
T.check('transport out charged', s.charges.some((c) => c.requestId === r1 && c.kind === 'TRANSPORT'));
r = act('runCharges', {});
T.eq('rerun: nothing new (idempotent)', r.result.made, 0);
act('releaseStatement', { statementId: stPC.id });
as('p-pcfin');
const crane = s.charges.find((c) => c.requestId === r2 && c.kind === 'RENTAL');
act('disputeCharge', { chargeId: crane.id, reason: 'Crane idle 2 days waiting for permits' });
act('acceptStatement', { statementId: stPC.id });
T.eq('agreed, the disputed line held', s.statements.find((x) => x.id === stPC.id).status, 'PARTLY_AGREED');
as('p-fin');
act('resolveDispute', { chargeId: crane.id, resolution: 'credit', amount: 6000 });
T.check('…a credit line, the original agreed', s.charges.some((c) => c.kind === 'CREDIT' && c.amount === -6000) && s.charges.find((c) => c.id === crane.id).status === 'ACCEPTED');
act('setSetting', { key: 'simulateFailure', value: true });
r = act('createInvoicePair', { statementId: stPC.id });
T.eq('the invoice pair can fail (and says why)', s.statements.find((x) => x.id === stPC.id).status, 'FAILED');
act('setSetting', { key: 'simulateFailure', value: false });
act('createInvoicePair', { statementId: stPC.id });
const st1 = s.statements.find((x) => x.id === stPC.id);
const ar = s.tx.find((t) => t.id === st1.pair.arTx);
const ap = s.tx.find((t) => t.id === st1.pair.apTx);
T.eq('retry: AR in FleetCo, AP in ProjectCo, same number', [ar.le, ap.le, ar.number === ap.number].join(), 'LE-FC,LE-PC,true');
T.eq('domestic: same amount both sides, VAT 5 %', [ar.entered.amount === ap.entered.amount, st1.pair.vat === Math.round(st1.pair.net * 0.05 * 100) / 100].join(), 'true,true');
T.check('the AP is coded to both projects (P-INT and P-EXT)', ap.lines.some((l) => /PC-INT-014/.test(l.name)) && ap.lines.some((l) => /PC-C-2207/.test(l.name)));
T.eq('PPM gets the cost per project', s.tx.filter((t) => t.kind === 'PROJECT_COST').map((t) => t.refs.projectId).sort().join(), 'P-EXT,P-INT');
act('postInternal', {});
T.eq('cross-charge posted without invoice', s.tx.filter((t) => t.kind === 'CROSS_CHARGE').length, 1);
as('p-desk');
act('invoiceCustomer', {});
T.eq('Customer Y invoiced by FleetCo', s.tx.filter((t) => t.kind === 'CUSTOMER_AR').map((t) => t.le).join(), 'LE-FC');
as('p-pcfin');
r = act('billProject', { projectId: 'P-EXT' });
const bill = s.tx.find((t) => t.kind === 'PROJECT_BILL');
T.eq('ProjectCo bills Customer X: cost + 40 %', [bill.le, bill.margin > 0].join(), 'LE-PC,true');

T.section('the KSA statement: accrued at the cut-off, then invoiced cross-border');
as('p-fin');
const stK = s.statements.find((x) => x.receiver === 'BU-PK');
act('releaseStatement', { statementId: stK.id });
advance(4); // past the dispute window and the IC cut-off (4 Dec)
const k1 = s.statements.find((x) => x.id === stK.id);
T.eq('silence accepts it after 3 days; the cut-off accrued it in both ledgers', [k1.status, !!k1.accrued, s.tx.filter((t) => t.kind === 'ACCRUAL').map((t) => t.le).sort().join()].join('|'), 'AGREED|true|LE-FC,LE-PK');
act('createInvoicePair', { statementId: stK.id });
const k2 = s.statements.find((x) => x.id === stK.id);
const apK = s.tx.find((t) => t.id === k2.pair.apTx);
T.eq('AP in SAR at the day\'s rate; reverse charge, no VAT on the AR', [apK.currency, k2.pair.vat, k2.pair.reverseCharge > 0].join(), 'SAR,0,true');
T.eq('accruals reversed', s.tx.filter((t) => t.kind === 'ACCRUAL_REVERSAL').length, 2);
advance(3);
act('settle', { statementId: stK.id });
const k3 = s.statements.find((x) => x.id === stK.id).pair.settled;
T.check('settled net of 5 % withholding, with an exchange difference', k3.wht > 0 && k3.fxDiff !== undefined, JSON.stringify(k3));
act('settle', { statementId: stPC.id });

T.section('returns, damage, deposit, loss, moves');
as('p-desk'); act('offHire', { requestId: r3, lineId: line(r3).id });
as('p-yard'); act('returnLine', { requestId: r3, lineId: line(r3).id }); act('inspectLine', { requestId: r3, lineId: line(r3).id, damage: 1500, note: 'Cracked panel', photos: 3 });
T.eq('stock back home: the return transfer order inside FleetCo', s.tx.filter((t) => t.kind === 'TO_RETURN').length, 1);
as('p-site');
act('redeploy', { requestId: r1, lineId: line(r1).id, projectId: 'P-EXT' });
T.eq('redeployed: charges go to the new project from today (MC-S10)', line(r1).segments.map((g) => g.projectId).join(), 'P-INT,P-EXT');
act('reportBreakdown', { requestId: r2, lineId: line(r2).id, days: 2, reason: 'Hydraulic fault' });
as('p-pm');
r = act('moveToCompany', { requestId: rl, lineId: line(rl).id, projectId: 'P-FAC' }, true);
T.check('a SAME_LE unit is not moved to its own owner', !r.ok, r.error);
as('p-site'); act('reportLoss', { requestId: rl, lineId: line(rl).id });
T.eq('lost: Facilities retires the asset', s.tx.filter((t) => t.kind === 'ASSET_RETIRE').map((t) => t.le).join(), 'LE-PC');
// Scenario 1 ends: off hire, back, inspected.
act('offHire', { requestId: r1, lineId: line(r1).id });
as('p-yard'); act('returnLine', { requestId: r1, lineId: line(r1).id }); act('inspectLine', { requestId: r1, lineId: line(r1).id, damage: 0 });
as('p-fin');
act('toMonthEnd');
act('runCharges', {});
const dec = s.statements.filter((x) => x.period === '2026-12');
T.eq('December: statements for FC→PC and FC→PK', dec.map((x) => x.receiver).sort().join(), 'BU-PC,BU-PK');
T.check('breakdown credit and the redeployed project appear', s.charges.some((c) => c.kind === 'BREAKDOWN_CREDIT') && s.charges.some((c) => c.requestId === r1 && c.projectId === 'P-EXT'));
dec.forEach((x) => act('releaseStatement', { statementId: x.id }));
as('p-pcfin'); act('acceptStatement', { statementId: dec.find((x) => x.receiver === 'BU-PC').id });
as('p-pk'); act('acceptStatement', { statementId: dec.find((x) => x.receiver === 'BU-PK').id });
as('p-fin');
dec.forEach((x) => { act('createInvoicePair', { statementId: x.id }); act('settle', { statementId: x.id }); });
act('postInternal', {});
as('p-desk'); act('invoiceCustomer', {});
s.tx.filter((t) => t.kind === 'CUSTOMER_AR' && t.open > 0 && t.le === 'LE-FC').forEach(() => {});
act('settleDeposit', { requestId: r3 });
T.check('deposit applied to the open invoices and the rest refunded', !!s.requests.find((x) => x.id === r3).deposit.settled);

T.section('money: complete, balanced, eliminated');
const f1 = V.finance(s, r1);
T.eq('scenario 1 request: financially complete', [f1.complete, f1.done + '/' + f1.total].join(' '), 'true ' + f1.total + '/' + f1.total);
T.check('…with the checklist the FDD asks for', ['ops', 'charges', 'agreed', 'ar', 'ap', 'cost', 'settled'].every((k) => f1.items.some((i) => i.key === k)));
const fk = V.finance(s, rk);
T.check('the KSA request still open (on hire): says what is next', !fk.complete && /Next:/.test(fk.words), fk.words);
['LE-FC', 'LE-PC', 'LE-PK'].forEach((le) => { const lg = V.ledger(s, le); T.check(lg.company + ': the books balance (' + lg.count + ' transactions)', lg.balanced); });
const cons = V.consolidation(s);
T.check('intercompany receivable and payable eliminate (exchange differences only)', cons.eliminations.every((e) => Math.abs(e.diff) < 400), JSON.stringify(cons.eliminations.map((e) => e.diff)));
const acc = V.requestAccounting(s, r1);
T.eq('the request shows each company\'s accounting', acc.map((x) => x.company).sort().join(), 'FleetCo,ProjectCo');
const wb = V.workbench(s);
T.check('reconciliation: charges = AR = AP for every pair', wb.recon.length >= 3 && wb.reconOk, JSON.stringify(wb.recon));
const rep = V.reports(s);
T.check('reports: IC by pair, margins, customs, certificates, disputes', rep.icByPair.length && rep.margins.length && rep.customs.length && rep.certs.length && rep.disputes.length === 1);
T.check('every view renders for every person', Seed.PERSONAS.every((p) => { const x = Object.assign({}, s, { personaId: p.id }); return V.work(x) && V.requests(x, {}) && V.approvals(x) && V.yard(x) && V.site(x) && V.charges(x, {}) && V.workbench(x) && V.billing(x) && V.reports(x) && V.setup(x); }));
T.eq('the guide follows the story', V.guide(s).done >= 12, true);
T.report();
