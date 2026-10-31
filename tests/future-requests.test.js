/*
 * EquipRite Future · Requests (resources/js/future/fxRequests.js): My requests (scoped by the requesting BU, chips,
 * search, relationship chips, money progress), New request (who it is for; Source from, the sourcing business units the
 * requesting BU may borrow from, and step 2 filtered to the one chosen; the sourcing cards own fleet first with price,
 * estimate and why not; "Requested by … → sourced from …"; what will happen per owner; the payload createRequest takes,
 * each line naming its provider) and a request's tab (Approval & flow: the approver, every step of each line and of the
 * money in order with its BU, its people and its state, the current step and who plays it, at every point of the
 * story, the requesting BU's approval when OD-12 asks for it, the journey as swimlanes; the head's next step; lines,
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
T.eq('…money progress: done of total and the next money step, who does it', r1.moneyLine, '4 of 7 · Money next: Settled · Treasury');
T.eq('…and where the request is now, with its person', r1.flowNext, 'Here now: off hire · Omar Haddad (ProjectCo Projects)');
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

T.section('New request: step 1, Source from (the sourcing business unit that lends the equipment)');
const srcList = (x) => x.sources.map((c) => c.title + (c.any ? '' : ' (' + c.relLabel + ')') + (c.on ? '*' : '')).join(' ; ');
f = R.form(as(fresh, 'p-pm'), {});
T.eq('Priya: Any (the default), then own fleet, ProjectCo Facilities (cross-charge), FleetCo Fleet (intercompany, domestic)', srcList(f),
  'Any company in the group* ; ProjectCo Projects (Own fleet) ; ProjectCo Facilities (Same company · cross-charge) ; FleetCo Fleet (Intercompany · domestic)');
const card = (x, key) => { const c = x.sources.find((y) => y.key === key); return [c.title, c.sub, c.relLabel, c.money, c.lead, c.agreement, c.unitsText].join(' | '); };
T.eq('…FleetCo: BU and company, country, relationship, the money, lead time, agreement and version, units', card(f, 'BU-FC'),
  'FleetCo Fleet | FleetCo Equipment LLC · United Arab Emirates | Intercompany · domestic | Invoice pair: AR in FleetCo, AP in ProjectCo coded to the project; VAT 5 % | Lead time 2 days | ICA-FC-PC-2026 v1 (intercompany agreement) | 8 units · 8 free for the dates');
T.eq('…own fleet: cost straight to the project, no invoice', card(f, 'BU-PC'),
  'ProjectCo Projects | ProjectCo Contracting LLC · United Arab Emirates | Own fleet | Cost straight to the project, no invoice | On hand: no lead time | No agreement: own equipment at its internal cost rate | 1 unit · 1 free for the dates');
T.eq('…ProjectCo Facilities: a cross-charge, its rates', card(f, 'BU-PF'),
  'ProjectCo Facilities | ProjectCo Contracting LLC · United Arab Emirates | Same company · cross-charge | PPM cross-charge to the project: no invoices, no tax (one legal entity) | Lead time 1 day | XC-PF-PC-2026 v1 (cross-charge rates) | 1 unit · 1 free for the dates');
T.eq('…Any company in the group: everything, own fleet first', card(f, 'any'),
  'Any company in the group | Step 2 shows every unit you may use, own fleet first | Every allowed owner | Each owner approves and bills its own lines, as its card says | On hand to 2 days, by owner | Each owner’s own agreement | 10 units · 10 free for the dates');
T.eq('…the route before a choice', f.routeText, 'Requested by ProjectCo Projects (ProjectCo) → sourced from any company in the group');
const pkSrc = R.form(as(fresh, 'p-pk'), {});
T.eq('Faisal: FleetCo Fleet across the border, plus Any', srcList(pkSrc), 'Any company in the group* ; FleetCo Fleet (Intercompany · cross-border)');
T.eq('…the money and the lead time across the border', card(pkSrc, 'BU-FC'),
  'FleetCo Fleet | FleetCo Equipment LLC · United Arab Emirates | Intercompany · cross-border | Invoice pair in AED without VAT: ProjectCo KSA self-assesses 15 % and withholds 5 %; customs at the border | Lead time 7 days | ICA-FC-PK-2026 v1 (intercompany agreement) | 8 units · 8 free for the dates');
const deskSrc = R.form(as(fresh, 'p-desk'), R.change({}, 'forKey', 'C:C-Y'));
T.eq('Lena (customer rental): her own fleet only, chosen', srcList(deskSrc), 'FleetCo Fleet (Customer rental)*');
T.eq('…the customer\'s rental agreement, and why only the owner', [card(deskSrc, 'BU-FC'), deskSrc.sourceNote].join(' | '),
  'FleetCo Fleet | FleetCo Equipment LLC · United Arab Emirates | Customer rental | FleetCo invoices the customer in Fusion Receivables: no intercompany | On hand: no lead time | Rental agreement RA-FC-Y-2026 v1 | 8 units · 8 free for the dates'
  + ' | A customer rental always comes from the owner itself: FleetCo Fleet rents out its own units, never another company’s.');
T.eq('…even before a customer is chosen; no other company can be asked for', [srcList(R.form(as(fresh, 'p-desk'), R.change({}, 'source', 'any'))), R.form(as(fresh, 'p-desk'), {}).form.source].join(' | '),
  'FleetCo Fleet (Customer rental)* | BU-FC');
const onHire = as(F.state('onHire'), 'p-pm');
T.eq('free for the dates: units on hire are not', R.form(onHire, {}).sources.map((c) => c.key + ': ' + c.unitsText).join(' ; '),
  'any: 10 units · 5 free for the dates ; BU-PC: 1 unit · 1 free for the dates ; BU-PF: 1 unit · 0 free for the dates ; BU-FC: 8 units · 4 free for the dates');
T.eq('…dates not right: said, not counted', R.form(onHire, R.change(R.change({}, 'from', '2026-12-25'), 'to', '2026-12-01')).sources[3].unitsText, '8 units · give the dates to see how many are free');
T.eq('a BU the matrix does not allow is not offered (and forgotten)', R.form(as(fresh, 'p-pm'), R.change({}, 'source', 'BU-PK')).form.source, '');

T.section('New request: choosing FleetCo on step 1 filters step 2');
let src = R.change(R.change(R.change(R.change({}, 'forKey', 'P:P-INT'), 'from', '2026-11-03'), 'to', '2026-12-20'), 'source', 'BU-FC');
f = R.form(as(fresh, 'p-pm'), R.change(R.change(src, 'cls', 'GEN'), 'step', '2'));
T.eq('the choice is kept in the form, its card on', [f.form.source, f.sources.filter((c) => c.on).map((c) => c.title).join()].join(' | '), 'BU-FC | FleetCo Fleet');
T.eq('…step 2: FleetCo\'s generators only, and it says so', [f.step, f.groups.map((g) => g.title).join(' ; '), f.cards.map((c) => c.serial).join(), f.shownText, f.canShowAll].join(' | '),
  '2 | FleetCo Fleet · FleetCo | GN-3001,GN-3002 | Units of FleetCo Fleet (FleetCo) | true');
T.eq('…the head: requested by → sourced from', f.routeText, 'Requested by ProjectCo Projects (ProjectCo) → sourced from FleetCo Fleet (FleetCo)');
T.eq('…the class chips count FleetCo\'s units only', f.classes.map((c) => c.id + ' ' + c.count + '/' + c.total).join(', '), 'EXC 3/3, CRN 1/1, GEN 2/2, LFT 2/2, TWR 0/0');
T.eq('…a class FleetCo has none of: said in words', R.form(as(fresh, 'p-pm'), R.change(R.change(src, 'cls', 'TWR'), 'step', '2')).emptyText,
  'FleetCo Fleet has no Light towers for you. Try another class, or show every company.');
const every = R.form(as(fresh, 'p-pm'), R.change(R.change(f.form, 'source', 'any'), 'step', '2'));
T.eq('Show every company: own fleet first again', [every.form.source, every.groups.map((g) => g.title).join(' ; '), every.shownText, every.canShowAll, every.routeText].join(' | '),
  ' | Your own fleet · ProjectCo Projects ; FleetCo Fleet · FleetCo | Units of every company you may source from, own fleet first | false | Requested by ProjectCo Projects (ProjectCo) → sourced from any company in the group');
const own = R.form(as(fresh, 'p-pm'), R.change(src, 'source', 'BU-PC'));
T.eq('own fleet chosen: the head says so', own.routeText, 'Requested by ProjectCo Projects (ProjectCo) → sourced from ProjectCo Projects (ProjectCo), its own fleet');
let mixed = R.change(R.change(R.change(src, 'source', 'any'), 'add', 'U-EX1|EXC'), 'add', 'U-TW1|TWR');
T.eq('with units of two owners on the request, step 1 says what choosing one does', R.form(as(fresh, 'p-pm'), mixed).sourceHint,
  'On the request so far: EX-1001 (FleetCo Fleet), TW-5001 (ProjectCo Facilities). Choosing one company keeps only its units on the request.');
mixed = R.form(as(fresh, 'p-pm'), R.change(mixed, 'source', 'BU-FC'));
T.eq('…choosing FleetCo keeps only FleetCo\'s', mixed.lines.map((c) => c.serial).join(), 'EX-1001');
const lena = R.form(as(fresh, 'p-desk'), R.change(R.change(R.change({}, 'forKey', 'C:C-Y'), 'cls', 'GEN'), 'step', '2'));
T.eq('a customer rental: its own units, no "Show every company"', [lena.routeText, lena.shownText, lena.canShowAll].join(' | '),
  'Requested by FleetCo Fleet (FleetCo) → sourced from FleetCo Fleet (FleetCo), its own fleet | Units of FleetCo Fleet (FleetCo), your own fleet: a customer rental always comes from the owner itself | false');

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
T.eq('…each group: requested by → sourced from', f.review.map((g) => g.routeText).join(' ; '),
  'Requested by ProjectCo Projects (ProjectCo) → Sourced from FleetCo Fleet (FleetCo) ; Requested by ProjectCo Projects (ProjectCo) → Sourced from ProjectCo Facilities (ProjectCo)');
T.eq('…the head (any company) and the sourcing BUs of the lines', [f.routeText, f.sourcingText].join(' | '),
  'Requested by ProjectCo Projects (ProjectCo) → sourced from any company in the group | FleetCo Fleet · FleetCo; ProjectCo Facilities · ProjectCo');
T.eq('…the estimated total', [f.totalText, f.totalNote, f.step].join(' | '), 'AED 27,650.00 | estimate | 3');
const xb = R.form(as(fresh, 'p-pk'), R.change(R.change(R.change(R.change(R.change({}, 'from', '2026-11-09'), 'to', '2026-12-31'), 'cls', 'EXC'), 'add', 'U-EX1|EXC'), 'step', '3'));
T.check('cross-border: customs and the reverse charge in words', /temporary import permit/.test((xb.review[0].happen.find((h) => h.key === 'customs') || {}).text)
  && /self-assesses 15 % \(reverse charge\) and withholds 5 % at payment; booked in SAR/.test(xb.review[0].happen.find((h) => h.key === 'tax').text));
T.check('…and the customer project\'s billing', xb.reqNotes.some((n) => /ProjectCo KSA bills Customer Z/.test(n)), xb.reqNotes.join());
const pay = R.payload(as(fresh, 'p-pm'), raw);
T.eq('the payload createRequest takes', JSON.stringify(pay),
  '{"requestingBu":"BU-PC","from":"2026-11-03","to":"2026-12-20","note":"","lines":[{"cls":"EXC","unitId":"U-EX1","provider":"BU-FC"},{"cls":"TWR","unitId":"U-TW1","provider":"BU-PF"}],"projectId":"P-INT","task":"1.1 Site works"}');
const made = E.apply(as(fresh, 'p-pm'), 'createRequest', pay);
T.eq('…and the engine raises it', [made.ok, made.result && made.result.number, made.state && made.state.requests[0].lines.map((x) => x.relation).join()].join(' | '), 'true | FR-1001 | IC_DOMESTIC,SAME_LE');
const fromFc = R.change(R.change(R.change(src, 'cls', 'EXC'), 'add', 'U-EX1|EXC'), 'step', '3');
f = R.form(as(fresh, 'p-pm'), fromFc);
T.eq('sourced from FleetCo: the review\'s head and its one group', [f.routeText, f.review.map((g) => g.routeText).join(' ; ')].join(' | '),
  'Requested by ProjectCo Projects (ProjectCo) → sourced from FleetCo Fleet (FleetCo) | Requested by ProjectCo Projects (ProjectCo) → Sourced from FleetCo Fleet (FleetCo)');
T.check('…who approves stays FleetCo\'s Equipment Manager, by name', /^FleetCo Fleet, the owner, approves and allocates each unit in Approve & allocate \(Ana Costa, Equipment Manager · FleetCo\)\.$/.test(f.review[0].happen[0].text), f.review[0].happen[0].text);
const fcMade = E.apply(as(fresh, 'p-pm'), 'createRequest', R.payload(as(fresh, 'p-pm'), f.form));
T.eq('…raised: the line\'s provider is BU-FC', [fcMade.ok, fcMade.state.requests[0].lines.map((x) => x.preferredUnit + ' ' + x.provider + ' ' + x.relation).join()].join(' | '), 'true | U-EX1 BU-FC IC_DOMESTIC');
const hold = R.payload(as(fresh, 'p-desk'), R.change(R.change({}, 'forKey', 'C:C-W'), 'add', 'U-GN1|GEN'));
const refused = E.apply(as(fresh, 'p-desk'), 'createRequest', hold);
T.check('a customer on credit hold: the engine refuses, in words', !refused.ok && /credit hold/.test(refused.error), refused.error);
const blocked = R.form(as(fresh, 'p-pk'), R.change(R.change(R.change({}, 'from', '2026-11-09'), 'to', '2026-12-31'), 'add', 'U-EX2|EXC'));
T.eq('a unit not usable stays out of the review', [blocked.lineCount, blocked.step2Ok, blocked.blocked.join()].join(' | '), '1 | false | EX-1002: No certificate for Saudi Arabia (MC-FR-18)');

T.section('A request\'s tab');
let v = R.request(s, ids.r1);
T.eq('head', [v.number, v.typeText, v.buText, v.party, v.siteText, v.datesText, v.words].join(' | '),
  'FR-1001 | Internal project | ProjectCo Projects · ProjectCo Contracting LLC | PC-INT-014 · ProjectCo head office fit-out | Business Bay, Dubai · United Arab Emirates | 3 Nov 2026 to 20 Dec 2026 | On hire');
T.eq('…the badge: the real next step and who does it (not the money checklist\'s first item)', v.finBadge, 'Next: off hire · Omar Haddad, site supervisor');
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

T.section('Approval & flow: the approver and the current step, at every point of the story');
// The own-fleet case: Priya asks for ProjectCo Projects' own GN-3901 at each point (from the next day).
const withOwn = (st) => {
  const made = E.apply(as(st, 'p-pm'), 'createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: E.util.addDays(st.today, 1), to: E.util.addDays(st.today, 10), lines: [{ cls: 'GEN', unitId: 'U-GN9' }] });
  return { s: made.state, id: made.result && made.result.id };
};
const nowOf = (fl) => (fl.next ? fl.next.key + ' ' + (fl.next.people[0] || {}).name + ' (' + fl.next.buName + ')' : 'none');
const approverOf = (fl) => fl.approvers.map((a) => a.name + ', ' + a.buName).join('; ');
const STORY = {
  fresh: { own: 'approve Yusuf Rahman (ProjectCo Projects)' },
  raised: { r1: 'approve Ana Costa (FleetCo Fleet)', rl: 'approve Huda Saleh (ProjectCo Facilities)', r3: 'deposit Lena Novak (FleetCo Fleet)' },
  onHire: { r1: 'hours Priya Raman (ProjectCo Projects)', rl: 'hours Priya Raman (ProjectCo Projects)', r3: 'offHire Lena Novak (FleetCo Fleet)' },
  monthEnd: { r1: 'offHire Omar Haddad (ProjectCo Projects)', rl: 'offHire Omar Haddad (ProjectCo Projects)', r3: 'offHire Lena Novak (FleetCo Fleet)' },
  released: { r1: 'offHire Omar Haddad (ProjectCo Projects)', rl: 'offHire Omar Haddad (ProjectCo Projects)', r3: 'offHire Lena Novak (FleetCo Fleet)' },
  agreed: { r1: 'offHire Omar Haddad (ProjectCo Projects)', rl: 'offHire Omar Haddad (ProjectCo Projects)', r3: 'offHire Lena Novak (FleetCo Fleet)' },
  invoiced: { r1: 'offHire Omar Haddad (ProjectCo Projects)', rl: 'offHire Omar Haddad (ProjectCo Projects)', r3: 'offHire Lena Novak (FleetCo Fleet)' },
  settled: { r1: 'offHire Omar Haddad (ProjectCo Projects)', rl: 'offHire Omar Haddad (ProjectCo Projects)', r3: 'offHire Lena Novak (FleetCo Fleet)' },
  returned: { r1: 'm-charges Sara Ahmed (FleetCo Fleet)', rl: 'offHire Omar Haddad (ProjectCo Projects)', r3: 'm-charges Sara Ahmed (FleetCo Fleet)' },
  closed: { r1: 'none', rl: 'offHire Omar Haddad (ProjectCo Projects)', r3: 'm-depositSettled Lena Novak (FleetCo Fleet)' }
};
const APPROVER = { r1: 'Ana Costa, FleetCo Fleet', rl: 'Huda Saleh, ProjectCo Facilities', r3: 'Ana Costa, FleetCo Fleet', own: 'Yusuf Rahman, ProjectCo Projects' };
F.STEPS.forEach((point) => {
  const o = withOwn(as(F.state(point), 'p-admin'));
  const st = as(o.s, 'p-admin');
  const fid = F.ids(st);
  const want = Object.assign({ own: 'approve Yusuf Rahman (ProjectCo Projects)' }, STORY[point]);
  const got = {};
  Object.keys(want).forEach((k) => { const fl = R.flow(st, k === 'own' ? o.id : fid[k]); got[k] = nowOf(fl) + ' | ' + approverOf(fl); });
  T.eq(point + ': the current step and the approver of ' + Object.keys(want).join(', '), Object.keys(want).map((k) => k + ': ' + got[k]).join(' ; '),
    Object.keys(want).map((k) => k + ': ' + want[k] + ' | ' + APPROVER[k]).join(' ; '));
});

T.section('Approval & flow: the steps of a line, who does each, and what the state knows');
const raisedPm = as(F.state('raised'), 'p-pm');
let fl = R.request(raisedPm, ids.r1).flow;
const keys = (f) => f.lines[0].steps.map((x) => x.key + ':' + x.state).join(' ');
T.eq('r1 raised: the steps in order, the owner\'s approval current', keys(fl), 'raised:done requester:na approve:current ship:waiting receive:waiting hours:waiting offHire:waiting back:waiting');
T.eq('…the approver in words, and why ProjectCo does not approve', [fl.approverText, fl.alsoText].join(' '),
  'Approver: Ana Costa (Equipment Manager, FleetCo Fleet), the owner of EX-1001. ProjectCo does not approve: only the owner approves (OD-12 off).');
const step = (f, k) => f.lines[0].steps.find((x) => x.key === k);
let ap = step(fl, 'approve');
T.eq('…the approval: the sourcing BU, its people, the approver', [ap.side, ap.buText, ap.peopleText, ap.approver].join(' | '), 'Sourcing BU | FleetCo Fleet · FleetCo | Ana Costa · Equipment Manager · FleetCo | true');
T.eq('…Priya plays Ana there', [ap.go.mine, ap.go.persona, ap.go.navId, ap.go.action].join(' | '), 'false | p-em | approvals | Play as Ana and open Approve & allocate');
T.eq('…raised: by whom and when', step(fl, 'raised').doneText, '2 Nov 2026 by Priya Raman');
T.eq('…the requesting BU\'s approval: not needed', step(fl, 'requester').note, 'Not needed: only the owner approves (OD-12)');
T.eq('…shipping and receiving: the owner\'s yard, then the site', [step(fl, 'ship').buText + ' ' + step(fl, 'ship').people.map((p) => p.name).join('/'), step(fl, 'receive').buText + ' ' + step(fl, 'receive').people.map((p) => p.name).join('/')].join(' | '),
  'FleetCo Fleet · FleetCo Ravi Kumar/Ana Costa | ProjectCo Projects · ProjectCo Omar Haddad/Priya Raman');
T.eq('…the money waits until it is on hire', [fl.money.map((x) => x.key + ':' + x.state).join(' '), fl.sections[1].sub].join(' | '),
  'm-charges:waiting m-agreed:waiting m-ar:waiting m-ap:waiting m-cost:waiting m-settled:waiting | Starts when the equipment is on hire');
T.eq('…the head badge, and My requests', [R.request(raisedPm, ids.r1).finBadge, R.list(raisedPm, {}).rows.find((r) => r.id === ids.r1).flowNext].join(' | '),
  'Next: approval · Ana Costa, Equipment Manager | Here now: approval · Ana Costa (FleetCo)');
T.eq('…opens on Approval & flow while not on hire; on Equipment once it is', [R.request(raisedPm, ids.r1).defaultTab, R.request(as(F.state('onHire'), 'p-pm'), ids.r1).defaultTab].join(), 'flow,equipment');
const onHirePm = as(F.state('onHire'), 'p-pm');
fl = R.request(onHirePm, ids.r1).flow;
T.eq('r1 on hire: approved by Ana with the date, shipped by Ravi, received by Omar', ['approve', 'ship', 'receive'].map((k) => k + ' ' + step(fl, k).state + ' ' + step(fl, k).doneText).join(' | '),
  'approve done 2 Nov 2026 by Ana Costa | ship done 2 Nov 2026 by Ravi Kumar | receive done 7 Nov 2026 by Omar Haddad');
T.eq('…now the hours, and it\'s Priya', [fl.next.key, fl.next.go.mine, fl.next.go.youText].join(' | '), 'hours | true | It\'s you: Priya Raman does it in Receive, hours, moves');
T.eq('…the money: the charge run at the month end, nothing to press yet', [fl.money[0].state, fl.money[0].stateText, fl.money[0].note, fl.money[0].go].join(' | '),
  'current | Now: running | This month is charged at its month end (30 Nov 2026) | ');
fl = R.request(as(F.state('invoiced'), 'p-pm'), ids.r1).flow;
T.eq('r1 invoiced: the hours approved so far, the money steps done by whom', [step(fl, 'hours').doneText, step(fl, 'hours').note, fl.money.filter((x) => x.state === 'done').map((x) => x.key + ' ' + x.doneText).join('; ')].join(' | '),
  '30 Nov 2026 by Priya Raman | 16 days approved so far; more come while it is on hire | m-agreed 30 Nov 2026 by Mark Lee; m-ar 30 Nov 2026 by Sara Ahmed; m-ap 30 Nov 2026 by Sara Ahmed; m-cost 30 Nov 2026 by Sara Ahmed');
T.eq('…the charge run runs alongside; settlement is the money\'s current step', fl.money.map((x) => x.key + ':' + x.state).join(' '), 'm-charges:running m-agreed:done m-ar:done m-ap:done m-cost:done m-settled:current');
T.eq('…and the inner tab counts the steps done', R.request(as(F.state('invoiced'), 'p-pm'), ids.r1).flow.countText, '5 of 7');
fl = R.flow(as(F.state('closed'), 'p-pm'), ids.r1);
T.eq('r1 closed: every step done, back and inspected by Ravi; nothing next', [step(fl, 'back').doneText, step(fl, 'back').note, fl.next, fl.badge].join(' | '),
  '30 Nov 2026 by Ravi Kumar | Passed |  | Financially complete');

T.section('Approval & flow: a customer rental, the deposit before the owner approves');
const lenaRaised = as(F.state('raised'), 'p-desk');
fl = R.request(lenaRaised, ids.r3).flow;
T.eq('r3: the deposit is current (Lena, rental desk), the owner\'s approval waits for it', keys(fl), 'raised:done requester:na deposit:current approve:waiting ship:waiting receive:waiting offHire:waiting back:waiting');
T.eq('…in words', [fl.approverText, fl.alsoText].join(' '), 'Approver: Ana Costa (Equipment Manager, FleetCo Fleet), the owner of GN-3002. First Lena Novak (rental desk) takes the deposit; only then may the owner approve.');
T.eq('…the deposit: its amount, and it\'s Lena', [step(fl, 'deposit').what, fl.next.go.youText, fl.next.go.action].join(' | '),
  'The rental desk takes Customer Y’s deposit, 25 % of four weeks (AED 2,100.00), before the owner may approve; Fusion Receivables records it | It\'s you: Lena Novak does it in Customer billing | Open Customer billing');
T.eq('…the approval waits, and says why', [step(fl, 'approve').state, step(fl, 'approve').note, step(fl, 'approve').people.map((p) => p.name).join()].join(' | '), 'waiting | Waits for the deposit: the rental desk takes it first | Ana Costa');
T.eq('…the badge', R.request(lenaRaised, ids.r3).finBadge, 'Next: the deposit · Lena Novak, rental desk');
const dep = E.apply(lenaRaised, 'takeDeposit', { requestId: ids.r3 });
fl = R.request(dep.state, ids.r3).flow;
T.eq('deposit taken: done by Lena that day; now Ana approves (Lena plays her)', [step(fl, 'deposit').doneText, fl.next.key, fl.next.go.persona, fl.next.go.action, fl.alsoText].join(' | '),
  '2 Nov 2026 by Lena Novak | approve | p-em | Play as Ana and open Approve & allocate | The rental desk took the deposit first (2 Nov 2026 by Lena Novak).');
T.eq('…the receipt and the off hire are the rental desk\'s', ['receive', 'offHire'].map((k) => step(fl, k).people.map((p) => p.name).join()).join(' | '), 'Lena Novak | Lena Novak');

T.section('Approval & flow: the own fleet, the same company, a refused line');
let o = withOwn(F.state('fresh'));
fl = R.flow(as(o.s, 'p-pm'), o.id);
T.eq('own fleet: Yusuf (ProjectCo Projects) approves; no other approval', [fl.approverText, fl.alsoText, step(fl, 'approve').side].join(' | '),
  'Approver: Yusuf Rahman (Equipment coordinator, ProjectCo Projects), the owner of GN-3901 (its own fleet). | ProjectCo Projects is the owner too: no other approval (OD-12 off). | Requesting and sourcing BU');
fl = R.flow(raisedPm, ids.rl);
T.eq('same company: Huda (ProjectCo Facilities) approves and ships; ProjectCo Projects does not approve', [fl.approverText, fl.alsoText, step(fl, 'ship').peopleText].join(' | '),
  'Approver: Huda Saleh (Facilities Manager, ProjectCo Facilities), the owner of TW-5001. | ProjectCo Projects does not approve: only the owner approves (OD-12 off). | Huda Saleh · Facilities Manager · ProjectCo');
const ref = E.apply(as(raisedPm, 'p-em'), 'rejectLine', { requestId: ids.r1, lineId: R.request(raisedPm, ids.r1).lines[0].id, reason: 'In for its annual service' });
fl = R.flow(as(ref.state, 'p-pm'), ids.r1);
T.eq('a refused line: refused by Ana, why, the rest not needed', [step(fl, 'approve').state, step(fl, 'approve').doneText, step(fl, 'approve').note, step(fl, 'ship').state, fl.badge].join(' | '),
  'refused | 2 Nov 2026 by Ana Costa | Refused: In for its annual service | na | Refused by the owner: nothing more to do');

T.section('Approval & flow: the requesting BU approves first when OD-12 asks (above its threshold)');
fl = R.request(raised.state, raised.result.id).flow;
const rq = step(fl, 'requester');
T.eq('the step is there and current: ProjectCo Projects, its receiver review', [rq.state, rq.side, rq.buText, rq.people.map((p) => p.name).join(', '), rq.note].join(' | '),
  'current | Requesting BU | ProjectCo Projects · ProjectCo | Priya Raman, Mark Lee | The estimate, AED 195,000.00, is above ProjectCo Projects’ threshold of AED 50,000.00 (OD-12)');
T.eq('…Priya approves it here', [rq.go.mine, rq.go.act, rq.go.action].join(' | '), 'true | approveRequest | Approve for my BU');
T.eq('…the owner waits for it', [step(fl, 'approve').state, step(fl, 'approve').note].join(' | '), 'waiting | Waits for ProjectCo Projects’ approval first');
T.eq('…in words, and the badge', [fl.alsoText, R.request(raised.state, raised.result.id).finBadge].join(' | '),
  'ProjectCo Projects approves first (receiver review: Priya Raman or Mark Lee), as the estimate, AED 195,000.00, is above its threshold of AED 50,000.00 (OD-12); then the owner. | Next: ProjectCo Projects’ approval · Priya Raman, Project Manager');
T.eq('…Omar (the site) plays Priya to approve it', R.flow(as(raised.state, 'p-site'), raised.result.id).next.go.action, 'Play as Priya and approve it here');
const okd = E.apply(raised.state, 'approveRequest', { requestId: raised.result.id });
fl = R.flow(okd.state, raised.result.id);
T.eq('approved: done by Priya, now the owner', [step(fl, 'requester').state, step(fl, 'requester').doneText, fl.next.key, fl.next.people[0].name].join(' | '), 'done | 2 Nov 2026 by Priya Raman | approve | Ana Costa');
T.eq('setting on, below the threshold: not needed, and why', step(R.flow(as(Object.assign({}, raisedPm, { settings: Object.assign({}, raisedPm.settings, { requesterApproval: true }) }), 'p-pm'), ids.r1), 'requester').note,
  'Not needed: the estimate, AED 24,500.00, is not above its threshold of AED 50,000.00 (OD-12)');

T.section('Approval & flow: the journey, drawn as swimlanes');
let jr = R.flow(lenaRaised, ids.r3).journey;
const nodesOf = (j) => j.all.map((n) => n.lane + ':' + n.label + ':' + n.state + (n.here ? '*' : '')).join(' ');
T.eq('the rental: the customer\'s lane, the owner\'s, the money', jr.lanes.map((x) => x.name + ' · ' + x.role).join(' | '),
  'Customer Y · rents, through FleetCo Fleet’s rental desk | FleetCo Fleet · owns, approves, ships | Money · starts when it is on hire');
T.eq('…the deposit is here now, in Lena\'s lane', nodesOf(jr),
  '1:Raised:done 1:Deposit:current* 2:Owner approves:waiting 2:Shipped:waiting 1:On hire:waiting 1:Off hire:waiting 2:Back & inspected:waiting 3:Charge run:waiting 3:Customer invoice:waiting 3:Paid:waiting 3:Deposit settled:waiting');
T.eq('…its person, and the hand-overs between the lanes', [jr.all.find((n) => n.here).personText, jr.links.map((x) => x.style.gridColumn).join()].join(' | '), 'Lena Novak · takes the deposit | 4,6,8');
T.eq('…in words (Lena plays it: her turn)', jr.sentence, 'FR-1004 is with FleetCo Fleet. It\'s your turn: take the deposit in Customer billing. Before that: Lena Novak raised it on 2 Nov 2026.');
jr = R.flow(dep.state, ids.r3).journey;
T.eq('deposit taken: the flag moves to Ana, in FleetCo\'s lane', [jr.all.filter((n) => n.here).map((n) => n.lane + ':' + n.label + ':' + n.personText).join(), jr.sentence].join(' | '),
  '2:Owner approves:Ana Costa · approves | FR-1004 is with FleetCo Fleet: Ana Costa (Equipment Manager) approves and allocates. Before that: Lena Novak took the deposit on 2 Nov 2026.');
jr = R.flow(onHirePm, ids.r1).journey;
T.eq('r1 on hire: done nodes with dates, the flag on the hours in ProjectCo\'s lane', jr.nodes.map((n) => n.lane + ':' + n.label + ':' + n.state + (n.dateText ? '(' + n.dateText + ')' : '') + (n.here ? '*' : '')).join(' '),
  '1:Raised:done(2 Nov) 2:Owner approves:done(2 Nov) 2:Shipped:done(2 Nov) 1:On hire:done(7 Nov) 1:Hours:current* 1:Off hire:waiting 2:Back & inspected:waiting');
T.eq('…the money lane from the day it went on hire', jr.money.map((n) => n.col + ':' + n.label + ':' + n.state).join(' '), '4:Charge run:current 5:Statement:waiting 6:Invoice pair:waiting 7:Settled:waiting');
T.eq('…the lanes, and the request in words', [jr.lanes.map((x) => x.name).join(' | '), jr.sentence].join(' | '),
  'ProjectCo Projects | FleetCo Fleet | Money | FR-1001 is with ProjectCo Projects. It\'s your turn: record and approve the hours in Receive, hours, moves. Before that: Omar Haddad received it on 7 Nov 2026.');
T.eq('My requests: the journey as dots', R.list(onHirePm, {}).rows.find((r) => r.id === ids.r1).flowDots.map((d) => d.cls.replace(/fx-jr-dot ?/g, '').replace(/--/g, '')).join(' '),
  'done done done done current here waiting waiting current money waiting waiting waiting');

T.section('exports');
T.eq('My requests', [R.exportOf('requests', l).name, R.exportOf('requests', l).rows.length, R.exportOf('requests', l).columns.length].join(), 'requests,3,18');
v = R.request(s, ids.r1);
T.eq('a request\'s tabs', ['flow', 'equipment', 'money', 'accounting', 'history'].map((k) => k + ':' + R.exportOf(k, v).rows.length).join(' '), 'flow:14 equipment:1 money:3 accounting:12 history:6');
T.eq('…the flow: each step with its BU, people and state', ['section', 'label', 'buText', 'peopleText', 'stateText', 'doneText'].map((c) => R.exportOf('flow', v).rows[2][c]).join(' | '),
  'EX-1001 · CAT 320 Excavator | Owner approves and allocates | FleetCo Fleet · FleetCo | Ana Costa · Equipment Manager · FleetCo | Done | 2 Nov 2026 by Ana Costa');
T.eq('…the accounting lines as numbers', JSON.stringify(R.exportOf('accounting', v).rows.filter((x) => x.number === 'PC-JE-000009').map((x) => [x.dr, x.cr])), '[["",""]]');
T.eq('the units offered', R.exportOf('options', pk).rows.length, 3);

T.report();
