/*
 * EquipRite Future · Finance and Setup (flows/finance, flows/setup): resources/js/future/fxFinance.js and fxSetup.js on
 * the real engine, played through the story (tests/e2e/future-fixture.js). The company switch per persona, each
 * company's journal (links, entered currency and rate) and trial balance, the group's eliminations (nil at 'settled',
 * exchange differences only once the KSA statement is accrued, invoiced and settled on other days), the reports and their
 * scope, the exports, and the setup: who may change it, what a new rate or a decision does before it is saved, a stopped
 * relationship taking the owner out of New request's sourcing. Also the pages' bindings and payloads.
 *
 * Run:  node tests/future-finance.test.js
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
  const sandbox = { console, JSON, Math, Date, Object, Array, String, Number, Boolean, Error, URLSearchParams, setTimeout };
  sandbox.define = (deps, factory) => { mods[id] = factory(...deps.map(load)); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return mods[id];
}
const E = load('resources/js/future/fxEngine');
const V = load('resources/js/future/fxViews');
const Fin = load('resources/js/future/fxFinance');
const Set = load('resources/js/future/fxSetup');
const exportKit = load('resources/js/exportKit');

const as = (s, id) => E.apply(s, 'setPersona', { id }).state;
function play(s0, steps) {
  let s = s0;
  steps.forEach(([type, payload]) => { const r = E.apply(s, type, payload); if (!r.ok) throw new Error(type + ': ' + r.error); s = r.state; });
  return s;
}
const settled = Fx.state('settled');

T.section('the company switch: the persona\'s companies, Group for IC finance and Admin');
const sw = (id) => { const o = Fin.options(as(settled, id)); return o.list.map((x) => x.short).join(', ') + (o.groupAllowed ? ' +G' : ''); };
T.eq('Sara (IC finance): all three and the group', sw('p-fin'), 'FleetCo, ProjectCo, ProjectCo KSA, Group +G');
T.eq('Admin: the same', sw('p-admin'), 'FleetCo, ProjectCo, ProjectCo KSA, Group +G');
T.eq('Mark (ProjectCo finance): ProjectCo and ProjectCo KSA, no group', sw('p-pcfin'), 'ProjectCo, ProjectCo KSA');
T.eq('Lena (FleetCo owner finance): FleetCo', sw('p-desk'), 'FleetCo');
T.eq('Priya: ProjectCo only, no group', sw('p-pm'), 'ProjectCo');
T.eq('a company not hers falls back to her first', Fin.accounting(as(settled, 'p-pcfin'), { le: 'GROUP' }).current, 'LE-PC');
T.eq('…as does one outside her companies', Fin.accounting(as(settled, 'p-pcfin'), { le: 'LE-FC' }).current, 'LE-PC');

T.section('each company\'s journal and trial balance at \'settled\'');
const sara = as(settled, 'p-fin');
['LE-FC', 'LE-PC', 'LE-PK'].forEach((le) => {
  const a = Fin.accounting(sara, { le });
  T.check(a.ledger.company + ': balanced, debits = credits (' + a.ledger.count + ' transactions)', a.ledger.balanced && a.ledger.drTotal === a.ledger.crTotal && /^Balanced: debits /.test(a.ledger.balancedText));
  T.check(a.ledger.company + ': every entry with lines balances on its own', a.ledger.txs.every((t) => t.noAccounting || t.balanced));
});
const fc = Fin.accounting(sara, { le: 'LE-FC' }).ledger;
const ar = fc.txs.find((t) => t.number === 'FL-ICAR-000101');
T.eq('FleetCo\'s AR invoice: kind, source, lines', [ar.kindText, ar.source, ar.lines.map((l) => l.account + ' ' + (l.dr || '-') + '/' + (l.cr || '-')).join(', ')].join(' | '),
  'Intercompany AR invoice | Fusion Receivables: intercompany invoice (INT-10) | 1210 76,387.50/-, 4110 -/69,750.00, 4120 -/3,000.00, 2200 -/3,637.50');
T.eq('…its requests, statement and projects', [ar.requests.map((r) => r.number + (r.visible ? '' : '?')).join(), ar.statement.number, ar.statement.nav, ar.projects.map((p) => p.number).join()].join(' | '),
  'FR-1001,FR-1002 | ICS-2026-11-001 | charges | PC-INT-014,PC-C-2207');
T.eq('…the statement link goes to the workbench when the persona may open it', Fin.accounting(sara, { le: 'LE-FC', statementNav: 'ic-workbench' }).ledger.txs.find((t) => t.number === 'FL-ICAR-000101').statement.nav, 'ic-workbench');
T.eq('…in AED, rate 1', ar.enteredText, 'Entered and booked in AED, the ledger currency (rate 1)');
const pk = Fin.accounting(sara, { le: 'LE-PK' }).ledger;
T.check('KSA\'s AP: entered in AED, booked in SAR at the day\'s rate', /^Entered AED 6,825\.00, booked in SAR at 1 AED = 1\.02\d\d SAR \(30 Nov 2026\)$/.test(pk.txs.find((t) => t.kind === 'IC_AP').enteredText),
  pk.txs.find((t) => t.kind === 'IC_AP').enteredText);
T.eq('…its settlement withholds tax for Saudi Arabia', pk.txs.find((t) => t.kind === 'NETTING').lines.map((l) => l.account).join(), '2110,1150,2210');
T.check('a PPM entry has no accounting of its own, and says why with its items', (() => { const t = pk.txs.find((x) => x.kind === 'PROJECT_COST'); return t.noAccounting && /Payables/.test(t.note) && t.items.length === 3 && /^IC Equipment Rental · 3\.1 Earthworks$/.test(t.items[0].text); })());
T.check('a stock shipment links its unit and request', (() => { const t = fc.txs.find((x) => x.kind === 'TO_SHIP'); return !!t.unit && t.requests.length === 1; })());
const kinds = Fin.accounting(sara, { le: 'LE-FC', kind: 'IC_AR' }).ledger;
T.eq('filter by kind: the two AR invoices of FleetCo', [kinds.shown, kinds.count, kinds.kindLabel, kinds.kinds.filter((k) => k.on).map((k) => k.key).join()].join(' | '), '2 | 12 | Intercompany AR invoice | IC_AR');
T.eq('a kind not in this ledger shows all', Fin.accounting(sara, { le: 'LE-PK', kind: 'IC_AR' }).ledger.shown, 3);
T.check('Lena (FleetCo) may open every request in FleetCo\'s ledger: each uses its fleet', Fin.accounting(as(settled, 'p-desk'), { le: 'LE-FC' }).ledger.txs.every((t) => t.requests.every((r) => r.visible)));
const trial = Fin.accounting(sara, { le: 'LE-PC' }).ledger.trial;
T.check('the trial balance: each account on its side, nil ones marked', trial.every((r) => (r.dr === '') !== (r.cr === '') || r.zero) && trial.some((r) => r.zero && r.account === '2110'));

T.section('the group at \'settled\': everything eliminates');
const g = Fin.accounting(sara, { le: 'GROUP' });
T.check('Group is a company of the switch for Sara', g.isGroup && g.companies.some((c) => c.id === 'GROUP' && c.on));
T.eq('the three eliminations: nil, nothing, to the cent', g.group.eliminations.map((e) => e.key + ':' + e.state + ':' + e.diff).join(' '), 'icbal:zero:0 accrual:zero:0 pl:zero:0');
T.eq('…the same differences as fxViews.consolidation', V.consolidation(sara).eliminations.map((e) => e.diff).join(), '0,0,0');
const pl = g.group.eliminations.find((e) => e.key === 'pl');
T.eq('IC revenue (FleetCo) ↔ IC cost (ProjectCo, KSA in SAR)', [pl.a.rows.map((r) => r.company + ' ' + r.local).join(), pl.b.rows.map((r) => r.company + ' ' + r.local + ' = ' + r.group).join(', ')].join(' | '),
  'FleetCo AED −79,575.00 | ProjectCo AED 72,750.00 = AED 72,750.00, ProjectCo KSA SAR 6,972.61 = AED 6,825.00');
T.check('settled receivable and payable: shown as nil now', g.group.eliminations[0].a.rows.every((r) => r.zero && r.note === 'nil now') && /nil now/.test(g.group.eliminations[0].why));
T.check('what remains has no intercompany account, and balances', g.group.afterBalanced && g.group.off === 0 && !g.group.after.some((a) => ['1210', '2110', '4110', '5100'].indexOf(a.account) !== -1));
T.eq('the companies, each balanced', g.group.companies.map((c) => c.company + ':' + c.balanced).join(), 'FleetCo:true,ProjectCo:true,ProjectCo KSA:true');

T.section('the group with exchange differences (accrued 30 Nov, invoiced 4 Dec, settled 10 Dec)');
const fxs = play(as(Fx.state('agreed'), 'p-fin'), [['advance', { days: 4 }]].concat(Fx.state('agreed').statements.map((st) => ['createInvoicePair', { statementId: st.id }]))
  .concat([['advance', { days: 6 }]]).concat(Fx.state('agreed').statements.map((st) => ['settle', { statementId: st.id }])));
const gx = Fin.group(fxs);
T.eq('every pair differs by exchange only', gx.eliminations.map((e) => e.state).join(), 'fx,fx,fx');
T.check('…by small amounts', gx.eliminations.every((e) => Math.abs(e.diff) > 0 && Math.abs(e.diff) < 50), JSON.stringify(gx.eliminations.map((e) => e.diff)));
T.check('…the same as fxViews.consolidation (to the cent)', gx.eliminations.every((e, i) => Math.abs(e.diff - V.consolidation(fxs).eliminations[i].diff) <= 0.02));
T.check('…explained: the SAR entries, each at its date\'s rate', gx.eliminations.every((e) => /ProjectCo KSA’s entries are in SAR/.test(e.why) && e.foreign.length && e.foreign.every((x) => /^1 AED = 1\.0\d{3} SAR$/.test(x.rate))));
T.check('…the exchange goes to the FX reserve, so the rest balances', gx.after.some((a) => a.fx && a.amount === gx.fxTotal) && gx.afterBalanced);
T.check('an elimination that does not match is said to be one', (() => {
  const bad = JSON.parse(JSON.stringify(sara));
  bad.tx.find((t) => t.kind === 'IC_AP' && t.le === 'LE-PC').lines.find((l) => l.account === '5100').dr += 100;
  bad.tx.find((t) => t.kind === 'IC_AP' && t.le === 'LE-PC').lines.find((l) => l.account === '2110').cr += 100;
  const e = Fin.group(bad).eliminations.find((x) => x.key === 'pl');
  return e.state === 'bad' && e.tone === 'bad' && /Not explained by exchange rates/.test(e.why);
})());

T.section('reports');
const rep = Fin.reports(sara);
T.eq('the whole group for Sara', rep.scope, 'The whole group (FleetCo, ProjectCo, ProjectCo KSA)');
T.eq('IC by pair and month: charged, invoiced, open', rep.icByPair.map((x) => [x.pair, x.periodText, x.chargedText, x.invoicedText, x.openText, x.state].join(' · ')).join(' | '),
  'FleetCo → ProjectCo · Nov 2026 · AED 72,750.00 · AED 72,750.00 · AED 0.00 · Invoiced in full | FleetCo → ProjectCo KSA · Nov 2026 · AED 6,825.00 · AED 6,825.00 · AED 0.00 · Invoiced in full');
T.eq('the reconciliation (fxViews.workbench): zero differences', rep.recon.map((x) => x.number + ' ' + x.diffText + ' ' + x.apBooked).join(' | '),
  'ICS-2026-11-001 AED 0.00 booked as entered | ICS-2026-11-002 AED 0.00 booked SAR 6,972.61 in ProjectCo KSA');
T.eq('customs: the temporary import with its days left', rep.customs.map((c) => [c.permit, c.serial, c.routeShort, c.reexportBy, c.daysLeft, c.tone].join(' ')).join(), 'TI-SA-00001 GN-3001 AE → SA 30 Jan 2027 61 ok');
T.eq('certificates by country, the soon ones', rep.certs.map((c) => c.code + ':' + c.rows.filter((r) => r.soon).map((r) => r.serial + ' ' + r.daysText).join('+')).join(' '),
  'AE:EX-1002 62 days left SA:EX-1003 expired 10 days ago');
T.eq('utilisation by owner and country', rep.utilisation.map((u) => u.key + ' ' + u.pctText).join(' | '), 'FleetCo · United Arab Emirates 43 % | FleetCo · Saudi Arabia 100 % | ProjectCo · United Arab Emirates 50 %');
T.eq('margins: S1 cost only, S2 at cost + markup, KSA in SAR, S3 FleetCo\'s revenue, same company', rep.margins.map((m) => m.number + ' ' + m.marginText + ' / ' + m.groupText).join(' | '),
  'FR-1001 Cost only / AED 0.00 | FR-1002 AED 23,100.00 / AED 80,850.00 | FR-1003 SAR 2,440.41 / AED 9,213.75 | FR-1004 AED 9,760.00 / AED 9,760.00 | FR-1005 Cost only / AED 0.00');
T.eq('the KPIs', [rep.kpis.out, rep.kpis.icCharged, rep.kpis.recon, rep.kpis.customs, rep.kpis.certs, rep.kpis.disputes].join(' | '), '5 of 10 | AED 79,575.00 | All reconciled | 1 | 2 | 0');
const repPm = Fin.reports(as(settled, 'p-pm'));
T.eq('Priya\'s reports: ProjectCo\'s only (MC-BR-12)', [repPm.scope, repPm.icByPair.map((x) => x.pair).join(), repPm.recon.length, repPm.customs.length, repPm.margins.map((m) => m.number).join()].join(' | '),
  'ProjectCo: the companies of your business units | FleetCo → ProjectCo | 1 | 0 | FR-1001,FR-1002,FR-1005');
T.check('…her fleet: ProjectCo\'s units and FleetCo\'s on hire to her', repPm.fleet.reduce((a, c) => a.concat(c.units.map((u) => u.serial)), []).sort().join() === 'CR-2001,EX-1001,GN-3901,TW-5001');
const disputed = (() => {
  let s = Fx.state('released');
  s = as(s, 'p-pcfin');
  const st = s.statements.find((x) => x.receiver === 'BU-PC');
  const c = s.charges.find((x) => x.statementId === st.id && x.kind === 'TRANSPORT');
  s = play(s, [['disputeCharge', { chargeId: c.id, reason: 'Delivered a day late' }], ['advance', { days: 9 }]]);
  return Fin.reports(as(s, 'p-fin'));
})();
T.eq('disputes by age', disputed.disputes.map((d) => [d.serial, d.kind, d.ageText, d.state, d.bucket].join(' · ')).join(), 'EX-1001 · Transport · 9 days · Open · Over 7 days');
T.eq('…in buckets', disputed.buckets.map((b) => b.label + ':' + b.count).join(' '), '0–3 days:0 4–7 days:0 Over 7 days:1');
T.check('accruals: both ledgers, then reversed once invoiced', (() => {
  const r = Fin.reports(fxs);
  return r.accruals.length === 2 && r.accruals.every((a) => a.reversed && /FleetCo FC-JE-/.test(a.entries) && a.reversal);
})());

T.section('exports: every list as shown');
const vAcc = Object.assign({}, Fin.accounting(sara, { le: 'LE-PK' }));
const vGrp = Object.assign({}, Fin.accounting(sara, { le: 'GROUP' }));
const exp = { journal: vAcc, trial: vAcc, elim: vGrp, after: vGrp };
['utilisation', 'icByPair', 'recon', 'margins', 'fleet', 'customs', 'certs', 'accruals', 'disputes'].forEach((k) => { exp[k] = rep; });
const empty = Object.keys(exp).filter((k) => { const sp = Fin.exportOf(k, exp[k]); return !sp.columns.length || (!sp.rows.length && ['accruals', 'disputes'].indexOf(k) === -1); });
T.eq('every Finance list has columns and its rows', empty.join(), '');
const jcsv = exportKit.csv(Fin.exportOf('journal', vAcc).rows, Fin.exportOf('journal', vAcc).columns);
T.check('the journal: a row per line, amounts as numbers, the request and statement', /FL-ICAR-000102,30 Nov 2026,Intercompany AP invoice,.*,2110,Intercompany payable · FleetCo,,6972\.61,SAR,.*FR-1003,ICS-2026-11-002,PK-C-0310/.test(jcsv), jcsv.split('\r\n')[1]);
T.check('the eliminations: both sides and the difference', /Difference,Group,,,0,Eliminates/.test(exportKit.csv(Fin.exportOf('elim', vGrp).rows, Fin.exportOf('elim', vGrp).columns)));
T.eq('an unknown list: nothing to export', Fin.exportOf('nope', rep).columns.length, 0);

T.section('setup: who may change it, and why not');
const sv = Set.setup(sara);
T.check('Sara may change it', sv.canEdit && sv.whyNot === '');
const svPm = Set.setup(as(settled, 'p-pm'));
T.eq('Priya may not, and is told why', [svPm.canEdit, svPm.whyNot].join(' | '),
  'false | Priya Raman sees the setup but does not change it: rates, relationships and decisions are approved for both companies by group intercompany finance (Sara Ahmed) or Admin (MC-FR-05).');
T.check('Admin may too', Set.setup(as(settled, 'p-admin')).canEdit);
T.eq('companies with VAT, withholding, e-invoicing, weekend', sv.companies.map((c) => [c.short, c.currency, c.vat, c.wht, c.weekend].join(' ')).join(' | '), 'FleetCo AED 5 % none Sat–Sun | ProjectCo AED 5 % none Sat–Sun | ProjectCo KSA SAR 15 % 5 % Fri–Sat');
T.eq('orgs with the units in them now (GR-6)', sv.orgs.filter((o) => o.count).map((o) => o.id + ':' + o.units).join(' '), 'FC-YARD:EX-1002, EX-1003, LF-4001, LF-4002 FC-DEP-SA:GN-3001 FC-CUST-AE:GN-3002 PC-SITE:GN-3901');
T.eq('the people, with who is played', sv.people.filter((p) => p.on).map((p) => p.name).join() + ' / ' + sv.people.length, 'Sara Ahmed / 10');
T.eq('relationships: what stopping does, said first', sv.relations[0].stopText,
  'Stop: New request no longer offers ProjectCo Projects the 8 units of FleetCo Fleet (MC-FR-04); lines already approved go on and are billed as before. Fusion: nothing, the matrix lives in EquipRite.');
T.eq('the cross-charge and customer agreements start their history at v1, as set up', sv.agreements.filter((a) => a.kindKey !== 'INTERCOMPANY').map((a) => a.history.map((h) => 'v' + h.version + ' ' + h.by).join()).join(' | '),
  'v1 As the demo group was set up | v1 As the demo group was set up | v1 As the demo group was set up');

T.section('a new rate: what it does before, version 2 after');
const ica = sv.agreements.find((a) => a.id === 'ICA-01');
const exc = ica.rates.find((r) => r.cls === 'EXC');
T.eq('no draft: nothing to save', JSON.stringify(Set.rateChange({}, ica, exc)), '{"day":"800","week":"3500","changed":false,"valid":false,"error":"","text":"","fusion":"","warn":""}');
const drafts = { 'rate|ICA-01|EXC|day': '850', 'rate|ICA-01|EXC|week': '3700' };
const rc = Set.rateChange(drafts, ica, exc);
T.eq('a draft: what saving does, and Fusion', [rc.valid, rc.text, rc.fusion].join(' | '),
  'true | Saving makes ICA-FC-PC-2026 version 2 from 30 Nov 2026: Excavators AED 800.00/day, 3,500.00/week → 850.00/day, 3,700.00/week. Lines already requested keep the price they were raised at; new requests are priced on version 2 (MC-FR-05).'
  + ' | Fusion: nothing now. The invoice pairs of the hires priced on it carry the new rate (INT-10).');
T.eq('a zero rate cannot be saved', [Set.rateChange({ 'rate|ICA-01|EXC|day': '0' }, ica, exc).valid, Set.rateChange({ 'rate|ICA-01|EXC|day': '0' }, ica, exc).error].join(), 'false,At least 0.01.');
T.eq('a week dearer than seven days is warned about', Set.rateChange({ 'rate|ICA-01|EXC|week': '9000' }, ica, exc).warn, 'The week costs more than seven days at the day rate.');
const payload = Set.ratePayload(drafts, { agreementId: 'ICA-01', cls: 'EXC', day: 800, week: 3500 });
T.eq('the payload Save sends', JSON.stringify(payload), '{"agreementId":"ICA-01","cls":"EXC","day":850,"week":3700}');
const r2 = E.apply(sara, 'setAgreementRate', payload);
T.check('Sara saves it', r2.ok);
const ica2 = Set.setup(r2.state).agreements.find((a) => a.id === 'ICA-01');
T.eq('version 2 in the history, current', ica2.history.map((h) => 'v' + h.version + (h.current ? '*' : '') + ' ' + h.note).join(' | '), 'v2* EXC: 800/3500 → 850/3700 | v1 Market rate card 2026 (OD-04)');
T.eq('…the rate', ica2.rates.find((r) => r.cls === 'EXC').dayText + ' ' + ica2.rates.find((r) => r.cls === 'EXC').weekText, 'AED 850.00 AED 3,700.00');
T.eq('…the drafts of that rate go once saved, others stay', JSON.stringify(Set.dropDrafts(Object.assign({ 'setting|cutoffDay|': '6' }, drafts), 'rate|ICA-01|EXC|')), '{"setting|cutoffDay|":"6"}');
T.check('Priya cannot (the engine refuses too)', !E.apply(as(settled, 'p-pm'), 'setAgreementRate', payload).ok);

T.section('decisions');
const cut = sv.settings.find((x) => x.key === 'cutoffDay');
T.eq('a number: what saving changes', Set.settingChange({ 'setting|cutoffDay|': '6' }, cut).text,
  'Saving changes “IC cut-off: day of the next month” from 4 to 6. Day of the next month by which the invoice pair must exist; whatever is not invoiced then is accrued in both ledgers.');
T.eq('…out of range: why not', [Set.settingChange({ 'setting|cutoffDay|': '40' }, cut).error, Set.settingChange({ 'setting|cutoffDay|': '4.5' }, cut).error, Set.settingChange({ 'setting|cutoffDay|': 'x' }, cut).error].join(' | '),
  'At most 28. | Give a whole number. | Give a number.');
T.eq('…the payload', JSON.stringify(Set.settingPayload({ 'setting|cutoffDay|': '6' }, { key: 'cutoffDay', value: '4' })), '{"key":"cutoffDay","value":"6"}');
T.eq('a switch: what turning it off does', sv.settings.find((x) => x.key === 'netting').flipText, 'Turning it off: the next settlement is a payment and a receipt through the bank (1100).');
T.eq('a choice: what each means', sv.settings.find((x) => x.key === 'onHire').choices.map((c) => c.value + (c.on ? '*' : '') + ': ' + c.why).join(' | '),
  'RECEIPT*: On hire when the site confirms receipt (recommended). | DISPATCH: On hire from the day the yard ships it.');
T.check('every decision says what it does and what Fusion does', sv.settings.every((x) => x.does && /^Fusion/.test(x.fusion)));
T.eq('FDD v2.0\'s other decisions, decided', sv.fixed.map((f) => f.ref).join(' '), 'OD-01 OD-02 OD-03 OD-04 OD-06 OD-08 OD-09 OD-13 OD-14 OD-15');

T.section('a relationship stopped: the owner leaves New request\'s sourcing');
const owners = (s, bu, cls) => E.sourcing(s, { requestingBu: bu, cls }).map((o) => o.owner).filter((x, i, a) => a.indexOf(x) === i).join();
T.eq('before: ProjectCo Projects sources generators from itself and FleetCo', owners(sara, 'BU-PC', 'GEN'), 'BU-PC,BU-FC');
const stopped = E.apply(sara, 'setRelation', { id: 'R1', allowed: false }).state;
T.eq('after: FleetCo is gone for ProjectCo Projects, still there for KSA', [owners(stopped, 'BU-PC', 'GEN'), owners(stopped, 'BU-PK', 'GEN')].join(' | '), 'BU-PC | BU-FC');
T.eq('…the setup says so, with what allowing does', [Set.setup(stopped).relations[0].state, Set.setup(stopped).relations[0].allowText].join(' | '),
  'Stopped | Allow: ProjectCo Projects may request FleetCo Fleet\'s units again, priced on ICA-FC-PC-2026. Fusion: nothing.');

T.section('setup exports');
const setupEmpty = ['companies', 'bus', 'orgs', 'people', 'relations', 'agreements', 'decisions'].filter((k) => { const sp = Set.exportOf(k, sv); return !sp.columns.length || !sp.rows.length; });
T.eq('every Setup list has columns and rows', setupEmpty.join(), '');
T.eq('the rates: one row per agreement and class, numbers as numbers', (() => { const sp = Set.exportOf('agreements', sv); return sp.rows.length + ' ' + exportKit.csv(sp.rows, sp.columns).split('\r\n')[1]; })(),
  '22 ICA-FC-PC-2026,Intercompany,FleetCo Fleet → ProjectCo Projects,AED,1,Domestic VAT,Excavators,800,3500,Domestic: VAT at the owner\'s country rate.');

T.report();
