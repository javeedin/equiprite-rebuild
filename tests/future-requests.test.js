/*
 * EquipRite Future · Requests (resources/js/future/fxRequests.js): My requests (scoped by the requesting BU, chips,
 * search, relationship chips, money progress), New request (who it is for, the sourcing cards own fleet first with
 * price, estimate and why not, what will happen per owner, the payload createRequest takes) and a request's tab (lines,
 * the finance checklist with where each step is done, totals per company, the accounting shown for this request only).
 * Plays the story with the real engine (tests/e2e/future-fixture.js) and reads it back through the module.
 *
 * Run:  node tests/future-requests.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');
const F = require('./e2e/future-fixture');

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
const R = load('resources/js/future/fxRequests');
const E = load('resources/js/future/fxEngine');
const as = (s, id) => Object.assign({}, s, { personaId: id });

T.section('My requests: the requests of the persona\'s requesting BUs');
let s = as(F.state('invoiced'), 'p-pm');
const ids = F.ids(s);
let l = R.list(s, {});
T.eq('Priya: the requests of ProjectCo Projects', l.scope, 'Requests of ProjectCo Projects');
T.eq('…newest first, never the KSA one', l.rows.map((r) => r.number).join(), 'FR-1005,FR-1002,FR-1001');
T.eq('chips with counts', l.chips.map((c) => c.key + ':' + c.count + (c.on ? '*' : '')).join(' '), 'all:3* open:3 unfinished:3');
const r1 = l.rows.find((r) => r.id === ids.r1);
T.eq('a row: type, project, BU and company, owners', [r1.typeText, r1.party, r1.buCompany, r1.ownersText].join(' | '),
  'Internal project | PC-INT-014 · ProjectCo head office fit-out | ProjectCo Projects · ProjectCo | FleetCo Fleet · FleetCo');
T.eq('…relationship chips with their tones', l.rows.map((r) => r.relChips.map((c) => c.label + '/' + c.tone).join()).join(' ; '),
  'Same company · cross-charge/info ; Intercompany · domestic/ic ; Intercompany · domestic/ic');
T.eq('…money progress: done of total and what is next, who does it', r1.moneyLine, '4 of 7 · Next: Equipment back and inspected · Owner\'s yard');
T.eq('…cost so far, on the project', [r1.costSoFar, r1.costNote].join(' '), 'AED 15,000.00 on the project');
T.eq('search: by unit serial', R.list(s, { text: 'cr-2001' }).rows.map((r) => r.number).join(), 'FR-1002');
T.eq('…nothing matches: said in words', R.list(s, { text: 'nothing like this' }).empty, 'Nothing matches. Try another chip or clear the search.');
T.eq('Faisal sees only ProjectCo KSA\'s', [R.list(as(s, 'p-pk'), {}).scope, R.list(as(s, 'p-pk'), {}).rows.map((r) => r.number).join()].join(' | '), 'Requests of ProjectCo KSA Projects | FR-1003');
T.eq('…its relationship: cross-border', R.list(as(s, 'p-pk'), {}).rows[0].relChips.map((c) => c.label + '/' + c.tone).join(), 'Intercompany · cross-border/xb');
T.eq('Lena (rental desk) sees FleetCo\'s customer rental', R.list(as(s, 'p-desk'), {}).rows.map((r) => r.number + ' ' + r.typeText + ' ' + r.relText).join(), 'FR-1004 Customer rental Customer rental');
const ret = as(F.state('closed'), 'p-pm');
const done = R.list(ret, { chip: 'unfinished' });
T.check('returned: r1 is financially complete, off the "Money not complete" chip', R.list(ret, {}).rows.find((r) => r.id === ids.r1).finComplete && !done.rows.some((r) => r.id === ids.r1));
T.eq('…and the list says so', R.list(ret, {}).rows.find((r) => r.id === ids.r1).moneyLine, '7 of 7 · Financially complete');

T.section('New request: step 1, who and what it is for');
const fresh = F.state('fresh');
let f = R.form(as(fresh, 'p-pm'), {});
T.eq('Priya requests for one BU only (no chooser)', [f.bus.map((b) => b.id).join(), f.multiBu].join(), 'BU-PC,false');
T.eq('…for its projects; the type follows the project', f.options.map((o) => o.key + ':' + o.typeText).join(' '), 'P:P-INT:Internal project P:P-EXT:Customer project');
T.eq('…nothing chosen yet: said in words', f.forError, 'Choose what the equipment is for: one of ProjectCo Projects’ projects.');
T.eq('…dates default a week ahead, four weeks long', f.daysText, '28 days: 9 Nov 2026 to 6 Dec 2026');
f = R.form(as(fresh, 'p-pm'), R.change({}, 'from', '2026-10-30'));
T.check('a start before the demo\'s today is refused in words', f.dateErrors.join() === 'The start cannot be before the demo\'s today, 2 Nov 2026.' && !f.step1Ok, f.dateErrors.join());
const admin = R.form(as(fresh, 'p-admin'), {});
T.eq('Admin requests for every BU: chosen, the first by default', [admin.bus.map((b) => b.id).join(), admin.multiBu, admin.form.bu].join(' | '), 'BU-FC,BU-PC,BU-PF,BU-PK | true | BU-FC');
const desk = R.form(as(fresh, 'p-desk'), {});
T.eq('Lena (rental desk): FleetCo\'s customers, the one on hold flagged', desk.options.map((o) => o.title + (o.onHold ? ' (hold)' : '')).join('; '),
  'Customer Y · Gulf Builders; Customer W · Oman Roads (credit hold) (hold)');
T.eq('Mark (finance) does not raise requests', R.form(as(fresh, 'p-pcfin'), {}).canRaise, false);

T.section('New request: step 2, every unit sourcing offers, own fleet first');
let raw = R.change(R.change(R.change({}, 'forKey', 'P:P-INT'), 'from', '2026-11-03'), 'to', '2026-12-20');
f = R.form(as(fresh, 'p-pm'), R.change(raw, 'cls', 'GEN'));
T.eq('site and its country', [f.siteText, f.countryText].join(' | '), 'Business Bay, Dubai · United Arab Emirates | United Arab Emirates: AED, VAT 5 %, weekend Sat–Sun');
T.eq('generators: own fleet first, then FleetCo', f.groups.map((g) => g.title + ' (' + g.relLabel + ')').join(' ; '), 'Your own fleet · ProjectCo Projects (Own fleet) ; FleetCo Fleet · FleetCo (Intercompany · domestic)');
f = R.form(as(fresh, 'p-pm'), R.change(raw, 'cls', 'EXC'));
const ex1 = f.cards.find((c) => c.serial === 'EX-1001');
T.eq('an excavator card: owner, relationship, asset, where, lead time', [ex1.ownerName, ex1.ownerShort, ex1.relLabel, ex1.holdText, ex1.where, ex1.countryName, ex1.lead].join(' | '),
  'FleetCo Fleet | FleetCo | Intercompany · domestic | Asset · FA-10021 | FleetCo Jebel Ali Yard | United Arab Emirates | Lead time 2 days: on site from 4 Nov 2026');
T.eq('…the IC agreement\'s price, and the estimate for the dates', [ex1.price, ex1.priceBasis, ex1.estimateText, ex1.estimateFor].join(' | '),
  'AED 3,500.00 a week · AED 800.00 a day | Intercompany agreement ICA-FC-PC-2026 v1 | AED 24,500.00 | for 48 days');
T.check('…lead time later than the start: said, not blocked', ex1.usable && ex1.leadLate && /after the start, 3 Nov 2026/.test(ex1.leadNote), ex1.leadNote);
const pk = R.form(as(fresh, 'p-pk'), R.change(R.change(R.change({}, 'from', '2026-11-09'), 'to', '2026-12-31'), 'cls', 'EXC'));
T.eq('Faisal: his one project, chosen for him; Riyadh in Saudi Arabia', [pk.form.forKey, pk.siteText].join(' | '), 'P:P-KSA | Riyadh · Saudi Arabia');
T.eq('…each excavator: usable, or exactly why not (certificates for KSA)', pk.cards.map((c) => c.serial + ': ' + (c.usable ? 'usable' : c.why)).join(' ; '),
  'EX-1001: usable ; EX-1002: No certificate for Saudi Arabia (MC-FR-18) ; EX-1003: Its SASO conformity for Saudi Arabia expires 20 Nov 2026, before the hire ends on 31 Dec 2026 (MC-FR-18)');
T.check('…priced in AED, estimated in SAR at today\'s rate', pk.cards.every((c) => /^AED /.test(c.price) && /^SAR /.test(c.estimateText) && /estimate at today's rate/.test(c.estimateFor)));
T.eq('…cross-border', pk.groups.map((g) => g.relLabel).join(), 'Intercompany · cross-border');

T.section('New request: step 3, what will happen, and the payload');
raw = R.change(R.change(raw, 'cls', 'EXC'), 'add', 'U-EX1|EXC');
raw = R.change(raw, 'add', 'U-TW1|TWR');
raw = R.change(raw, 'step', '3');
f = R.form(as(fresh, 'p-pm'), raw);
T.eq('two units, two owners: grouped by owner', f.review.map((g) => g.ownerName + ' (' + g.relLabel + '): ' + g.cards.map((c) => c.serial).join()).join(' ; '),
  'FleetCo Fleet (Intercompany · domestic): EX-1001 ; ProjectCo Facilities (Same company · cross-charge): TW-5001');
T.eq('…what will happen: FleetCo', f.review[0].happen.map((h) => h.key).join(), 'approve,move,bill,tax,terms');
T.check('…who approves (the owner\'s BU), and the invoice pair coded to the project', /FleetCo Fleet, the owner, approves .*Ana Costa/.test(f.review[0].happen[0].text)
  && /an AR invoice in FleetCo and an AP invoice in ProjectCo coded to PC-INT-014/.test(f.review[0].happen[2].text), f.review[0].happen[2].text);
T.check('…the same company: a cross-charge, no invoice', /PPM cross-charge from ProjectCo Facilities to PC-INT-014: no invoices and no tax/.test(f.review[1].happen.find((h) => h.key === 'bill').text));
T.eq('…the estimated total', [f.totalText, f.totalNote, f.step].join(' | '), 'AED 27,650.00 | estimate | 3');
const xb = R.form(as(fresh, 'p-pk'), R.change(R.change(R.change(R.change(R.change({}, 'from', '2026-11-09'), 'to', '2026-12-31'), 'cls', 'EXC'), 'add', 'U-EX1|EXC'), 'step', '3'));
T.check('cross-border: customs and the reverse charge in words', /temporary import permit/.test((xb.review[0].happen.find((h) => h.key === 'customs') || {}).text)
  && /self-assesses 15 % \(reverse charge\) and withholds 5 % at payment; booked in SAR/.test(xb.review[0].happen.find((h) => h.key === 'tax').text));
T.check('…and the customer project\'s billing', xb.reqNotes.some((n) => /ProjectCo KSA bills Customer Z/.test(n)), xb.reqNotes.join());
const pay = R.payload(as(fresh, 'p-pm'), raw);
T.eq('the payload createRequest takes', JSON.stringify(pay),
  '{"requestingBu":"BU-PC","from":"2026-11-03","to":"2026-12-20","note":"","lines":[{"cls":"EXC","unitId":"U-EX1"},{"cls":"TWR","unitId":"U-TW1"}],"projectId":"P-INT","task":"1.1 Site works"}');
const made = E.apply(as(fresh, 'p-pm'), 'createRequest', pay);
T.eq('…and the engine raises it', [made.ok, made.result && made.result.number, made.state && made.state.requests[0].lines.map((x) => x.relation).join()].join(' | '), 'true | FR-1001 | IC_DOMESTIC,SAME_LE');
const hold = R.payload(as(fresh, 'p-desk'), R.change(R.change({}, 'forKey', 'C:C-W'), 'add', 'U-GN1|GEN'));
const refused = E.apply(as(fresh, 'p-desk'), 'createRequest', hold);
T.check('a customer on credit hold: the engine refuses, in words', !refused.ok && /credit hold/.test(refused.error), refused.error);
const blocked = R.form(as(fresh, 'p-pk'), R.change(R.change(R.change({}, 'from', '2026-11-09'), 'to', '2026-12-31'), 'add', 'U-EX2|EXC'));
T.eq('a unit not usable stays out of the review', [blocked.lineCount, blocked.step2Ok, blocked.blocked.join()].join(' | '), '1 | false | EX-1002: No certificate for Saudi Arabia (MC-FR-18)');

T.section('A request\'s tab');
let v = R.request(s, ids.r1);
T.eq('head', [v.number, v.typeText, v.buText, v.party, v.siteText, v.datesText, v.words].join(' | '),
  'FR-1001 | Internal project | ProjectCo Projects · ProjectCo Contracting LLC | PC-INT-014 · ProjectCo head office fit-out | Business Bay, Dubai · United Arab Emirates | 3 Nov 2026 to 20 Dec 2026 | On hire');
T.eq('…money badge: what is next', v.finBadge, 'Next: Equipment back and inspected · Owner\'s yard');
const ln = v.lines[0];
T.eq('a line: unit, owner, agreement, events in order', [ln.unitTitle, ln.ownerText, ln.agreementText, ln.eventList.map((e) => e.label + ' ' + e.date).join(', ')].join(' | '),
  'EX-1001 · CAT 320 Excavator | FleetCo Fleet · FleetCo Equipment LLC | ICA-FC-PC-2026 v1 (intercompany agreement) | Requested 2 Nov 2026, Approved and allocated 2 Nov 2026, Shipped 2 Nov 2026, On hire 7 Nov 2026');
T.eq('…hours and its next step (Priya opens the site screen)', [ln.hoursText, ln.next.navId, ln.next.mine].join(' | '), '16 days of hours: 116 h worked, 12 h standby, all approved | site | true');
T.eq('Money: the IC AR and AP done, settlement to do', v.items.map((i) => i.key + ':' + i.state).join(' '), 'ops:running charges:running agreed:done ar:done ap:done cost:done settled:pending');
const settle = v.items.find((i) => i.key === 'settled');
T.eq('…settlement: where and by whom (Priya plays Sara there)', [settle.go.navId, settle.go.persona, settle.go.action].join(' | '), 'ic-workbench | p-fin | Play as Sara and open Intercompany workbench');
T.eq('charges', v.charges.map((c) => c.kindText + ' ' + c.amountText + ' ' + c.statusText + ' ' + c.invoiceText).join(' ; '),
  'Rental AED 12,900.00 Invoiced AR FL-ICAR-000101 · AP FL-ICAR-000101 ; Standby AED 600.00 Invoiced AR FL-ICAR-000101 · AP FL-ICAR-000101 ; Transport AED 1,500.00 Invoiced AR FL-ICAR-000101 · AP FL-ICAR-000101');
T.eq('totals per company', v.companies.map((c) => c.company + ': ' + c.facts.map((x) => x.label + ' ' + x.value).join(', ')).join(' ; '),
  'FleetCo: Charged AED 15,000.00, Invoiced (AR, net) AED 15,000.00, ICS-2026-11-001 Not settled yet ; ProjectCo: Invoiced to it (AP, net) AED 15,000.00, Cost on the project AED 15,000.00, ICS-2026-11-001 Not settled yet');
T.eq('accounting: per company, this request\'s transactions only (not FR-1002\'s project cost)', v.acc.map((a) => a.company + ': ' + a.txs.map((t) => t.number).join()).join(' ; '),
  'FleetCo: FC-JE-000003,FL-ICAR-000101 ; ProjectCo: FL-ICAR-000101,PC-JE-000009');
T.eq('…an invoice shared with another request says so, and this request\'s part', v.acc[0].txs[1].sharedText, 'Covers other requests too (FR-1002): this request\'s part is AED 15,000.00 net');
T.eq('history, newest first', v.history.map((h) => h.what).slice(-1)[0], 'Raised FR-1001 for ProjectCo Projects · PC-INT-014');
T.eq('another BU\'s request is hidden', JSON.stringify([R.request(s, ids.rk).hidden, R.request(s, 'R9999').missing]), '[true,true]');
const settled = as(F.state('settled'), 'p-admin');
v = R.request(settled, ids.rk);
T.eq('cross-border, settled (Admin): both companies\' entries', v.acc.map((a) => a.company + ': ' + a.txs.map((t) => t.kindText).join(', ')).join(' ; '),
  'FleetCo: Transfer order shipped, Transfer order received, Intercompany AR invoice, Settlement / netting ; ProjectCo KSA: Intercompany AP invoice, Project cost (PPM), Settlement / netting');
T.check('…the AP entered in AED and booked in SAR at a rate', /^Entered AED 6,825.00 · rate 1\.\d+ · booked in SAR$/.test(v.acc[1].txs[0].enteredText), v.acc[1].txs[0].enteredText);
T.check('…customs in words', /^Temporary import TI-SA-00001: United Arab Emirates → Saudi Arabia, entered 2 Nov 2026, re-export by 30 Jan 2027 · open/.test(v.lines[0].customsText), v.lines[0].customsText);
T.check('…every entry balances', v.acc.every((a) => a.txs.every((t) => !t.lines.length || t.balanced)));
v = R.request(ret, ids.r1);
T.eq('returned: r1 financially complete, inspected', [v.finBadge, v.finance.complete, v.lines[0].inspectionText].join(' | '), 'Financially complete | true | Inspected 30 Nov 2026 by Ravi Kumar: pass');
const r3 = R.request(as(F.state('returned'), 'p-desk'), ids.r3);
T.check('a customer rental: deposit, invoice, damage', r3.items.map((i) => i.key).join() === 'ops,charges,deposit,invoiced,paid,depositSettled,damage'
  && /AED 1,500.00 · Cracked panel · 3 photos/.test(r3.lines[0].damageText), r3.items.map((i) => i.key).join() + ' ' + r3.lines[0].damageText);

T.section('the requesting BU\'s approval above its threshold (OD-12)');
const th = as(F.state('fresh'), 'p-pm');
th.settings = Object.assign({}, th.settings, { requesterApproval: true });
const big = R.change(R.change(R.change(R.change(R.change({}, 'forKey', 'P:P-EXT'), 'from', '2026-11-03'), 'to', '2027-01-31'), 'add', 'U-CR1|CRN'), 'step', '3');
f = R.form(th, big);
T.check('the review says it needs ProjectCo Projects\' approval first', f.reqNotes.some((n) => /Over AED 50,000.00: ProjectCo Projects approves it first/.test(n)), f.reqNotes.join());
const raised = E.apply(th, 'createRequest', R.payload(th, big));
v = R.request(raised.state, raised.result.id);
T.check('…the tab shows Priya\'s approve button, saying what it does', v.needsMyApproval && /agrees to this request above its threshold of AED 50,000.00/.test(v.approveText), v.approveText);

T.section('exports');
T.eq('My requests', [R.exportOf('requests', l).name, R.exportOf('requests', l).rows.length, R.exportOf('requests', l).columns.length].join(), 'requests,3,17');
v = R.request(s, ids.r1);
T.eq('a request\'s tabs', ['equipment', 'money', 'accounting', 'history'].map((k) => k + ':' + R.exportOf(k, v).rows.length).join(' '), 'equipment:1 money:3 accounting:12 history:6');
T.eq('…the accounting lines as numbers', JSON.stringify(R.exportOf('accounting', v).rows.filter((x) => x.number === 'PC-JE-000009').map((x) => [x.dr, x.cr])), '[["",""]]');
T.eq('the units offered', R.exportOf('options', pk).rows.length, 3);

T.report();
