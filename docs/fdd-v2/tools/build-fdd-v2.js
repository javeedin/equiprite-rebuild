'use strict';
/**
 * Builds EquipRite FDD v2.0 (draft): many companies, many countries, intercompany hire.
 *   docs/fdd-v2/EquipRite-FDD-v2-Multi-Company.html   (with the journal explorer)
 *   docs/fdd-v2/EquipRite-FDD-v2-Multi-Company.pdf
 * It extends FDD v1.7 (RITE-FDD-EQUIPRITE-001; summary in docs/redesign/tools/build-fdd-summary.js). The content is
 * data in this file; the flows are tools/flows.js (drawn by EquipRite Next's own renderer, tools/diagrams.js); the
 * worked accounting example is tools/journals.js. Rerun after editing:  node docs/fdd-v2/tools/build-fdd-v2.js
 */
const fs = require('fs');
const path = require('path');
const journals = require('./journals');
const { svgs, FLOWS } = require('./diagrams');

const ROOT = path.resolve(__dirname, '..');
const HTML_OUT = path.join(ROOT, 'EquipRite-FDD-v2-Multi-Company.html');
const PDF_OUT = path.join(ROOT, 'EquipRite-FDD-v2-Multi-Company.pdf');
const DATE = '31 Oct 2026';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const table = (head, rows, cls = '') => `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
  .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const chip = (s, kind) => `<span class="chip ${kind || ''}">${s}</span>`;
const note = (s) => `<div class="note">${s}</div>`;
const tip = (s) => `<div class="tip">${s}</div>`;

// ── Journal rendering: browser-safe, embedded in the HTML for the explorer ───────────────────────────────────────
function fmt(n) {
  var v = Math.round(Number(n) * 100) / 100;
  var s = Math.abs(v).toFixed(v % 1 === 0 ? 0 : 2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '−' : '') + s;
}
function jTable(entries) {
  var LEDGER = { FleetCo: 'l-fc', ProjectCo: 'l-pc', Group: 'l-gr' };
  var VAR = { asset: 'asset only', stock: 'stock only', xb: 'cross-border', accrual: 'if not invoiced by the cut-off', loss: 'if lost', alt: 'alternative' };
  var h = ['<table class="jt"><thead><tr><th>Entry</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>'];
  entries.forEach(function (e) {
    h.push('<tbody class="je">');
    h.push('<tr class="je-h"><td><span class="jid">' + e.id + '</span></td><td colspan="3"><span class="lchip ' + LEDGER[e.ledger] + '">' + e.ledger + '</span> <b>'
      + e.when.replace(/</g, '&lt;') + '</b>' + (VAR[e.variant] ? ' <span class="vchip">' + VAR[e.variant] + '</span>' : '') + '<span class="src">' + e.source.replace(/</g, '&lt;') + '</span></td></tr>');
    e.lines.forEach(function (l) {
      h.push('<tr class="je-l"><td></td><td class="' + (l[0] === 'Dr' ? 'dr' : 'cr') + '">' + (l[0] === 'Dr' ? 'Dr ' : 'Cr ') + l[1].replace(/</g, '&lt;') + '</td><td class="num">'
        + (l[0] === 'Dr' ? fmt(l[2]) : '') + '</td><td class="num">' + (l[0] === 'Cr' ? fmt(l[2]) : '') + '</td></tr>');
    });
    if (e.note) h.push('<tr class="je-n"><td></td><td colspan="3">' + e.note.replace(/</g, '&lt;') + '</td></tr>');
    h.push('</tbody>');
  });
  h.push('</table>');
  return h.join('');
}

const J = journals({});
const T = J.totals;
const P = J.p;
const pick = (ids) => ids.map((id) => J.entries.filter((e) => e.id === id)[0]).filter(Boolean);
const D = svgs();
const diagram = (id) => `<figure class="diagram"><div class="scroll">${D[id]}</div><figcaption>${esc(FLOWS.filter((f) => f.id === id)[0].title)}. Boxes with a brown code make the journal entries of that code (section 7). Purple: Fusion or OIC; dashed red: back or refused.</figcaption></figure>`;
const steps = (id) => {
  const f = FLOWS.filter((x) => x.id === id)[0];
  const LN = require('./flows').LANES;
  return table(['#', 'Who', 'Step', 'What happens', 'Entries'], f.steps.map((s, i) => [String(i + 1), esc(LN[s.lane].label), esc(s.label.join(' ')), esc(s.what), s.dp ? s.dp.split(' ').map((x) => chip(x, 'je')).join(' ') : '']), 'wrap steps');
};

// ── The at-a-glance picture ──────────────────────────────────────────────────────────────────────────────────────
function glance() {
  const W = 980;
  const row = (y, title, boxes, flows) => {
    let s = `<text class="g-title" x="12" y="${y + 16}">${esc(title)}</text>`;
    boxes.forEach((b) => {
      s += `<rect class="g-box ${b.cls}" x="${b.x}" y="${y + 28}" width="${b.w}" height="58" rx="10"/>`
        + `<text class="g-name" x="${b.x + b.w / 2}" y="${y + 52}" text-anchor="middle">${esc(b.name)}</text>`
        + `<text class="g-sub" x="${b.x + b.w / 2}" y="${y + 70}" text-anchor="middle">${esc(b.sub)}</text>`;
    });
    flows.forEach((f) => {
      const yy = y + 28 + (f.kind === 'eq' ? 18 : 42);
      const x1 = f.x1;
      const x2 = f.x2;
      s += `<line class="g-${f.kind}" x1="${x1}" y1="${yy}" x2="${x2}" y2="${yy}" marker-end="url(#g-${f.kind})"/>`
        + `<text class="g-lab g-lab-${f.kind}" x="${(x1 + x2) / 2}" y="${yy - 5}" text-anchor="middle">${esc(f.label)}</text>`;
    });
    return s;
  };
  const fc = (x) => ({ x, w: 210, name: 'FleetCo · Company 2', sub: 'owns it: asset or stock', cls: 'g-fc' });
  let body = '';
  body += row(0, 'Scenario 1 · internal project', [fc(150), { x: 640, w: 230, name: 'ProjectCo · Company 1', sub: 'internal project P-INT', cls: 'g-pc' }],
    [{ kind: 'eq', x1: 362, x2: 636, label: 'equipment: custody only, ownership stays' }, { kind: 'mo', x1: 636, x2: 364, label: 'pays the IC invoice ' + fmt(T.icGross) + ' (cost on P-INT)' }]);
  body += row(112, 'Scenario 2 · customer project', [fc(40), { x: 410, w: 220, name: 'ProjectCo · Company 1', sub: 'customer project P-EXT', cls: 'g-pc' },
    { x: 760, w: 190, name: 'Customer X', sub: 'ProjectCo\'s client', cls: 'g-cu' }],
  [{ kind: 'eq', x1: 252, x2: 406, label: 'equipment' }, { kind: 'mo', x1: 406, x2: 254, label: 'IC ' + fmt(T.icGross) },
    { kind: 'eq', x1: 632, x2: 756, label: 'works on site' }, { kind: 'mo', x1: 756, x2: 634, label: 'pays ' + fmt(T.custGross) }]);
  body += row(224, 'Scenario 3 · FleetCo rents to its customer', [fc(150), { x: 640, w: 230, name: 'Customer Y', sub: 'FleetCo\'s rental customer', cls: 'g-cu' }],
    [{ kind: 'eq', x1: 362, x2: 636, label: 'equipment on hire (still FleetCo\'s)' }, { kind: 'mo', x1: 636, x2: 364, label: 'pays the rental invoice ' + fmt(T.gross3) }]);
  return `<svg class="glance" viewBox="0 0 ${W} 330" width="${W}" height="330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The three scenarios: who owns, who uses, who pays">
<defs><marker id="g-eq" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#1f6fb2"/></marker>
<marker id="g-mo" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#047857"/></marker></defs>${body}</svg>`;
}

// ── Content ──────────────────────────────────────────────────────────────────────────────────────────────────────
const RULES = [
  ['GR-1', 'Ownership never moves', 'FleetCo keeps the unit on its books (Fixed Assets or Inventory) for its whole life. A hire moves custody, location and money, never ownership: no intercompany sale for a rental.'],
  ['GR-2', 'Every request has a requesting business unit', 'Everything else is derived from it and from the unit chosen: the legal entity and country of the requester, the project\'s BU, the owner\'s BU and legal entity, and the relationship between them.'],
  ['GR-3', 'The cost lands where the work is', 'On the user company\'s project, in its ledger and currency, through its own Payables. The owner never posts into the user\'s PPM.'],
  ['GR-4', 'Group prices come from intercompany agreements', 'Transfer prices are approved, versioned and kept apart from customer rates; a customer price is never used between group companies, nor the reverse.'],
  ['GR-5', 'One charge, one id, everywhere', 'Each charge line has one id that appears on the owner\'s AR invoice line, the user\'s AP invoice line and the project cost. Reconciliation is by construction, not by search.'],
  ['GR-6', 'Stock moves stay inside the owner', 'Transfer orders run only between orgs of the owner\'s legal entity (its yard → its own deployment org at the site). A transfer into another company\'s org would make Fusion treat it as an intercompany sale.'],
  ['GR-7', 'Country rules are data', 'Currency, tax, withholding, customs, calendars, time zones, certificates and languages are set per country and legal entity, never coded.']
];

const WHO = [
  ['Requesting BU', 'The business unit that asks (from the user\'s BU access; chosen when the user has more than one).', 'ProjectCo BU (S1, S2), FleetCo BU (S3)'],
  ['Project BU', 'The BU that owns the project (usually the requesting BU).', 'ProjectCo BU'],
  ['Owner (provider) BU / LE', 'Who owns the unit: from its asset book or its inventory org. Read from Fusion, never typed.', 'FleetCo'],
  ['Home yard', 'The owner\'s inventory org (or location, for an asset) where the unit lives.', 'FleetCo Yard B1'],
  ['Deployment org', 'The owner\'s own org (and locator per project or customer site) where its stock sits while on hire.', 'FleetCo · deployed in Country A'],
  ['Contracting BU', 'The company that has the contract with an outside customer and invoices them.', 'ProjectCo (S2), FleetCo (S3)'],
  ['Relationship', 'Computed per line from requesting and owner: see the next table.', 'IC domestic / IC cross-border']
];

const RELS = [
  ['SAME_BU', 'Own fleet: the requester owns the unit.', 'Equipment Manager of the BU', 'None: cost straight to the project (INT-08, as v1.7)', 'No'],
  ['SAME_LE', 'Two BUs of one legal entity.', 'Both BUs\' managers', 'PPM cross-charge (borrowed and lent); no invoices, no tax', 'No'],
  ['IC_DOMESTIC', 'Two legal entities in one country.', 'Requester above threshold; owner always', 'Invoice pair AR/AP (INT-10), domestic tax', 'Yes, eliminated'],
  ['IC_CROSS_BORDER', 'Two legal entities in two countries.', 'As above, plus customs and certificates checked', 'Invoice pair, currency conversion, reverse charge, withholding', 'Yes, eliminated']
];

const HOLD = [
  ['Where it is recorded', 'Fixed Assets book of the owner (capitalised); EquipRite and Fusion Maintenance know where it is', 'An inventory item (serial-controlled) in the owner\'s inventory org; on hand by org, subinventory and locator'],
  ['How it moves', 'Custody events in EquipRite (dispatch, receipt, return); optional asset location update in Fusion (INT-23)', 'Transfer orders between the owner\'s orgs: yard → deployment org → yard (INT-04/05/06)'],
  ['Accounting when it moves', 'None', 'In-transit and inventory entries inside the owner (F3, F4): no profit, no intercompany'],
  ['Depreciation', 'Monthly in the owner\'s book, hired out or not (F1)', 'None in Inventory: decision OD-03 (hold the fleet as assets, or accept no depreciation)'],
  ['Lost or destroyed', 'Retired in the owner\'s book; the user pays the agreed loss value (R6)', 'Issued out of inventory (cost of sales); the user pays the agreed loss value'],
  ['In today\'s code', 'Fulfilment class F&amp;M (fixed asset)', 'Fulfilment class S&amp;T (stock, transfer orders)']
];

const SCEN_LIST = [
  ['MC-S01', 'ProjectCo internal project uses a FleetCo asset (same country)', 'S1', 'IC_DOMESTIC, asset', 'F1 F2 F6 F7 P2 P4 G1'],
  ['MC-S02', 'ProjectCo internal project uses FleetCo stock (other country)', 'S1', 'IC_CROSS_BORDER, stock', 'F2 F3 F4 XF6 XF7 XP2 XP4 G1; customs record'],
  ['MC-S03', 'Capital internal project (the cost becomes part of an asset)', 'S1', 'any IC', 'P2 P3; G1 eliminates the margin from CIP'],
  ['MC-S04', 'ProjectCo customer project; PPM bills the customer', 'S2', 'any IC', 'F6 P2 P5 P6 P7 G1'],
  ['MC-S05', 'ProjectCo customer project; EquipRite invoices the hire from ProjectCo', 'S2', 'any IC', 'F6 P2 P8 G1 (contract lines non-billable)'],
  ['MC-S06', 'FleetCo rents to its customer, same country', 'S3', 'no IC', 'F1 F2 R1 R2 R3'],
  ['MC-S07', 'FleetCo rents to a customer in another country', 'S3', 'no IC, cross-border', 'R2 without VAT where exported; customs; customer withholding'],
  ['MC-S08', 'Own fleet: ProjectCo uses its own equipment', 'baseline', 'SAME_BU', 'v1.7: cost to the project (INT-08), no invoices'],
  ['MC-S09', 'Two BUs of the same legal entity', 'baseline', 'SAME_LE', 'PPM cross-charge, no invoices, no tax'],
  ['MC-S10', 'Redeploy from one ProjectCo project to another while on hire', 'S1/S2', 'same IC agreement', 'Charges continue; project coding switches at the transfer date'],
  ['MC-S11', 'Move from ProjectCo to a third group company while on site', 'S1/S2', 'two IC agreements', 'Off-hire for ProjectCo, on-hire for the other, both billed by FleetCo (no sub-lending, OD-13)'],
  ['MC-S12', 'Damage found at the return', 'all', 'IC or customer', 'IC: damage on the next statement; customer: R4 R5'],
  ['MC-S13', 'Unit lost or destroyed at the site', 'all', 'IC or customer', 'R6; IC: ProjectCo books it as project cost or an insurance claim'],
  ['MC-S14', 'ProjectCo disputes a statement line', 'S1/S2', 'IC', 'Line held; credit or re-rate; the rest invoiced'],
  ['MC-S15', 'Month end before the invoices', 'S1/S2', 'IC', 'F5 P1 (both reverse on day 1)'],
  ['MC-S16', 'Temporary import about to expire', 'cross-border', 'any', 'Alerts at 30, 14 and 7 days; extend, re-export or regularise']
];

const CHARGES = [
  ['Rental', 'Per on-hire unit and period, by the v1.7 rate engine (six periods, thresholds, complete period or utilised duration) on the IC rate schedule', 'IC agreement'],
  ['Standby / idle', 'Standby hours at the agreed % of the rate; idle billed only if the agreement says so (v1.7 BILL_IDLE_TIME)', 'Timesheets'],
  ['Minimum hire', 'A minimum number of days or weeks per hire', 'IC agreement'],
  ['Transport', 'Out and back (mobilization, demobilization): a lump sum or the carrier\'s cost plus the agreed %', 'Shipments'],
  ['Operator, fuel', 'Only when FleetCo supplies them: hours of its operators, fuel at cost plus %', 'Timesheets, issues'],
  ['Breakdown credit', 'Downtime the owner caused (its maintenance or a fault) above the agreed hours is not charged', 'Breakdown records'],
  ['Damage', 'Repair cost found at the return inspection, with photos and the repair estimate; approval rule OD-11', 'Inspections'],
  ['Loss', 'The agreed loss value (e.g. net book value plus %) when a unit is lost or destroyed', 'Loss record'],
  ['Credits and corrections', 'From disputes: a credit line on the next statement, never an edit of an invoiced line', 'Disputes']
];

const CALENDAR = [
  ['Day 1 (after the period)', 'Charge run; statements per company pair; accruals of the previous run reverse', 'EquipRite'],
  ['Days 1–3', 'FleetCo releases; ProjectCo reviews: accept, or dispute lines with a reason (silence = accepted)', 'Both'],
  ['Day 4', 'Invoice pair created for everything agreed (INT-10); invoice numbers back on each charge', 'OIC, Fusion'],
  ['IC cut-off', 'Whatever is not invoiced is accrued in both ledgers with the same amounts (INT-24)', 'EquipRite, Fusion GL'],
  ['Day 5', 'IC reconciliation: EquipRite charges = FleetCo AR = ProjectCo AP, by charge id', 'Finance'],
  ['Day 6', 'Consolidation and elimination', 'Group finance'],
  ['Netting date', 'Monthly netting of intercompany balances (or payment); withholding on cross-border payments', 'Treasury']
];

const OPTIONS = [
  ['A · Invoice pair from EquipRite (recommended across legal entities)', 'EquipRite\'s statement → OIC creates the AR invoice in FleetCo and the mirror AP invoice in ProjectCo, project-coded; PPM imports the AP cost',
    'Full control of the rental rules; works across ledgers, currencies and countries; tax and e-invoicing by Fusion; 1:1 with EquipRite\'s charges', 'EquipRite owns the mirroring; needs the IC customer and supplier set up per pair'],
  ['B · Fusion PPM intercompany billing', 'Equipment usage costed on a FleetCo provider project; a PPM intercompany contract bills ProjectCo\'s project at transfer prices',
    'Native PPM cross-charge rules and reports', 'Needs a provider project and costs there first; the rental rules move into PPM; heavier setup'],
  ['C · Fusion Intercompany transactions', 'IC transactions between the two IC organizations; invoices only where the pair requires them',
    'Light; good for non-project charges', 'The cost does not reach ProjectCo\'s project by itself; weak for tax across borders'],
  ['D · PPM cross-charge (borrowed and lent)', 'Only for two BUs of the same legal entity', 'No invoices, no tax', 'Not possible across legal entities']
];

const COUNTRY = [
  ['Currency', 'Each agreement has a currency (default: the owner\'s ledger currency, OD-08). Catalog prices show an estimate in the requester\'s currency at the daily corporate rate (INT-22). Invoices are converted by Fusion at the invoice date; payments at their date (FX gain or loss, XP4). Reports in each ledger\'s currency and in the group currency.'],
  ['Tax (VAT / GST)', 'Determined by Fusion Tax from the ship-from, ship-to and bill-to parties and the tax registrations of both legal entities. Across borders the service is often taxed in the user\'s country by reverse charge (XP2). EquipRite stores a tax treatment code per agreement and never calculates tax itself.'],
  ['E-invoicing', 'Where a country mandates electronic invoices (clearance or reporting models), the AR invoice must be issued through Fusion\'s localisation for that country. EquipRite never prints its own tax invoices; it shows Fusion\'s.'],
  ['Withholding tax', 'Some countries withhold tax on rental paid to a non-resident. ProjectCo withholds at payment (XP4); FleetCo records a tax credit where a treaty allows (XF7). Rates and certificates are set per country pair in Fusion.'],
  ['Transfer pricing', 'Intercompany rates must be at arm\'s length and documented: the agreement keeps its method (market rate card or cost plus, OD-04), its evidence and its version history.'],
  ['Customs', 'A unit crossing a border needs export and import papers (pro-forma invoice with a customs value, packing list, certificates) and usually a temporary import regime (permit or carnet) with a re-export date. EquipRite keeps the customs record per unit and border crossing and alerts before expiry.'],
  ['Country compliance', 'Some equipment needs certificates issued or recognised in the country of use (lifting, pressure, emissions). Allocation to a site in a country is blocked when a mandatory certificate for that country is missing or expires during the hire.'],
  ['Calendars and time zones', 'Hours are recorded in the site\'s time zone; daily rates and utilisation use the site\'s work calendar (weekends differ by country; public holidays). Month-end cut-offs use each legal entity\'s accounting calendar.'],
  ['Language and formats', 'Each user sees their language, number and date formats; documents in the language of the country where required; right-to-left support when a language needs it.'],
  ['Data security', 'Users see their BUs only; owners see the lines that use their fleet; finance sees by legal entity; customers see only their own.']
];

const BR = [
  ['MC-BR-01', 'Many companies in one EquipRite', 'Every request, unit, agreement, charge and document belongs to a business unit and a legal entity; any number of companies and countries share one EquipRite.'],
  ['MC-BR-02', 'Requests tied to a business unit', 'A request is raised for a requesting BU; its projects, customers, approvals, currency and accounting follow from it.'],
  ['MC-BR-03', 'Group fleet sharing', 'A company can use equipment owned by another group company (intercompany hire), with the owner\'s approval and at the agreed transfer price.'],
  ['MC-BR-04', 'Three request types, plus own fleet', 'Internal project (S1), customer project (S2), customer rental (S3); own fleet stays as v1.7.'],
  ['MC-BR-05', 'Ownership stays with the owner', 'No intercompany sale for a hire. Custody and location are tracked apart from ownership (GR-1, GR-6).'],
  ['MC-BR-06', 'Assets and stock', 'Both holding types work in every scenario, with their own movements and accounting.'],
  ['MC-BR-07', 'Intercompany billing', 'The owner bills the user for each period of hire and its extras, with matching documents in both ledgers, coded to the user\'s project.'],
  ['MC-BR-08', 'Customer billing by the contracting company', 'ProjectCo bills its customer through its project contract (S2); FleetCo bills its rental customer through its agreement (S3).'],
  ['MC-BR-09', 'Multi-country', 'Currency, tax, e-invoicing, withholding, customs, certificates, calendars, time zones and languages per country.'],
  ['MC-BR-10', 'Transfer pricing', 'Intercompany prices only from approved, versioned intercompany agreements, at arm\'s length.'],
  ['MC-BR-11', 'Reconciliation and consolidation', 'Intercompany charges reconcile to the cent between both ledgers and are marked for elimination.'],
  ['MC-BR-12', 'Security by company', 'Users act only in their BUs; owners see the requests that use their fleet; customers see only theirs.']
];

const FR = [
  ['A · Companies and master data', [
    ['MC-FR-01', 'Legal entities, BUs and countries from Fusion (INT-21): country, ledger currency, BU roles (projects, fleet owner, rental to customers), IC organization, time zone, work calendar, tax registration.', 'A new BU in Fusion appears in EquipRite after the next sync, with its legal entity and country.'],
    ['MC-FR-02', 'Ownership on every unit: owner legal entity and BU (from its asset book or inventory org), holding type (asset or stock), home yard, current custody (org, site or customer) and current country. Read-only in EquipRite.', 'A unit shows its owner and where it is now; an edit of the owner is not possible.'],
    ['MC-FR-03', 'Deployment orgs: for each owner and each country where its fleet can sit at other parties\' sites, an own org (or subinventory) with a locator per project or customer site.', 'A stock unit at ProjectCo\'s site is on hand in FleetCo\'s deployment org, locator = the project.'],
    ['MC-FR-04', 'Intercompany relationships: for each provider BU and receiver BU: allowed or not, relationship type, billing mechanism (OD-01), priority, lead time, cross-border allowed, netting.', 'A request cannot source from a provider the matrix does not allow.']
  ]],
  ['B · Agreements and prices', [
    ['MC-FR-05', 'Intercompany agreements (type INTERCOMPANY): provider and receiver BU, currency, IC rate schedule, billing frequency, on-hire and off-hire events, minimum hire, standby %, breakdown credit, transport, operator and fuel terms, damage and loss terms, tax treatment code, payment terms, netting, dates; versioned; approved by both finance teams.', 'A change creates a new version; charges keep the version they were priced with.'],
    ['MC-FR-06', 'Customer agreements for the contracting BU (S3, and S2 when EquipRite invoices): customer, currency, rates, deposit, credit terms.', 'A customer agreement cannot be used by another BU.'],
    ['MC-FR-07', 'Prices in the catalog: the group fleet shows the IC price and an estimate in the requester\'s currency; customer prices only on customer requests.', 'The estimate says "estimate at today\'s rate".']
  ]],
  ['C · The request', [
    ['MC-FR-08', 'A requesting BU on every request: defaulted from the user\'s BU access, changeable among the user\'s BUs until submit, then locked.', 'A user with one BU never sees the choice; with two, the request header shows it.'],
    ['MC-FR-09', 'Request type: internal project, customer project, customer rental; derived from the project (internal vs contract) or chosen (customer rental, no project).', 'The type decides the flow and who bills whom.'],
    ['MC-FR-10', 'Projects limited to those the requesting BU can charge; customers to the BU\'s customers.', 'ProjectCo\'s user cannot pick a FleetCo project.'],
    ['MC-FR-11', 'Sourcing: own fleet first, then the providers allowed, each unit with its owner, country, lead time and price; the line keeps the chosen provider (or "any allowed", settled at allocation).', 'Availability shows "FleetCo · Country B · 5 days · 1,000/week".'],
    ['MC-FR-12', 'Relationship type per line computed (SAME_BU, SAME_LE, IC_DOMESTIC, IC_CROSS_BORDER); it drives approvals, documents and accounting.', 'Shown on the line and in the request\'s history.']
  ]],
  ['D · Approval and allocation', [
    ['MC-FR-13', 'Requester-side approval by threshold in the requester\'s currency; owner-side approval always for IC lines (the owner\'s Equipment Manager), with an SLA and escalation.', 'An IC line is never allocated before the owner approves.'],
    ['MC-FR-14', 'Allocation only from the owner\'s fleet; the owner\'s Equipment Manager sees only lines that use its fleet; a line can be split across providers (one line per provider).', 'FleetCo\'s manager never sees ProjectCo\'s other lines.']
  ]],
  ['E · Logistics', [
    ['MC-FR-15', 'Stock: transfer orders only between orgs of the owner\'s legal entity; EquipRite checks source and destination before creating one and refuses otherwise.', 'A transfer order into a ProjectCo org is refused with the reason (GR-6).'],
    ['MC-FR-16', 'Assets: dispatch and receipt recorded in EquipRite, with the asset location updated in Fusion where configured (INT-23).', 'The asset\'s location in Fusion follows the custody.'],
    ['MC-FR-17', 'Cross-border: export and import pack (pro-forma invoice with customs value, packing list, certificates), regime, permit or carnet number, entry date, re-export deadline, alerts at 30, 14 and 7 days.', 'A unit under temporary import cannot be sent to a third country without its customs record.'],
    ['MC-FR-18', 'Country compliance: certificates per unit per country; allocation blocked when a mandatory certificate for the destination country is missing or expires during the hire.', 'The allocation shows which certificate blocks it.'],
    ['MC-FR-19', 'On-hire and off-hire events per agreement (default: on hire at receipt on site, off hire at the site\'s release date), seen by both companies; transport charged apart.', 'Both companies see the same dates on the statement.']
  ]],
  ['F · Use on site', [
    ['MC-FR-20', 'Hours in the site\'s time zone and work calendar; standby and idle per agreement; approved by the user company, visible to the owner.', 'A Friday counts as a weekend day at a site whose calendar says so.'],
    ['MC-FR-21', 'Breakdowns: owner-caused downtime with start and end; the breakdown credit is applied by the charge run.', 'The credit line names the breakdown record.']
  ]],
  ['G · Charges', [
    ['MC-FR-22', 'Charge run per period and company pair: rental, standby, transport, operator, fuel, damage, loss, credits; each line with a unique id, currency, rate source and the receiver\'s project, task and expenditure type.', 'Rerunning a period adds only what changed; an invoiced line is never edited.'],
    ['MC-FR-23', 'Intercompany statement per pair and period, with evidence; the receiver accepts or disputes lines within N days; the owner resolves (credit or re-rate); full audit trail.', 'A disputed line is held; the rest goes on.'],
    ['MC-FR-24', 'Accruals at the IC cut-off for agreed charges not yet invoiced: mirrored journals in both ledgers (INT-24), reversing on day 1.', 'Both ledgers show the same accrued amount.']
  ]],
  ['H · Invoices and settlement', [
    ['MC-FR-25', 'Invoice pair (INT-10 v2): AR invoice in the owner\'s BU (customer = the user\'s IC account) and AP invoice in the user\'s BU (supplier = the owner\'s IC supplier), same number and amounts, project-coded AP lines, tax by Fusion, safe to retry by statement id; numbers and statuses back on each charge.', 'Every charge line shows both invoice numbers.'],
    ['MC-FR-26', 'Same legal entity, two BUs: PPM cross-charge without invoices when the relationship says so.', 'No invoice is created for a SAME_LE line.'],
    ['MC-FR-27', 'Customer invoices: S3 by FleetCo (INT-11) at the agreement\'s frequency; S2 by ProjectCo\'s project contract (recommended) or by EquipRite from ProjectCo (OD-07), never both.', 'When EquipRite invoices, the IC cost lines are non-billable on the contract.'],
    ['MC-FR-28', 'Settlement by monthly netting (OD-10) or payment; EquipRite shows the paid status.', 'A statement shows "settled" after netting.']
  ]],
  ['I · Return, damage, loss, moves', [
    ['MC-FR-29', 'Return: off-hire, the return transfer order (stock) or custody back (asset), inspection; damage charged to the user company (IC) or the customer, with photos and the repair estimate; approval of damage charges (OD-11).', 'A damage charge without photos cannot be released.'],
    ['MC-FR-30', 'Loss: charged at the agreed loss value; the owner retires the asset or issues the stock in Fusion; insurance claim reference kept.', 'The unit leaves the fleet only after the owner\'s retirement.'],
    ['MC-FR-31', 'Moves while on hire: project to project in the same company (charges continue, coding switches at the date); to another group company (off hire for one, on hire for the other, both billed by the owner).', 'No company bills another for equipment it does not own (OD-13).']
  ]],
  ['J · Reports and control', [
    ['MC-FR-32', 'Reports: utilisation by owner company and country; IC charges by pair and month; IC reconciliation (charges vs AR vs AP); margin by scenario; fleet by country with customs and certificate expiry; accrued; disputes by age; in each ledger\'s currency and the group currency.', 'The reconciliation report shows zero differences after day 5.'],
    ['MC-FR-33', 'Security by BU and legal entity: the requester\'s BU, the owner\'s BU for its fleet, finance by legal entity, customers their own (INT-20 extended to BUs).', 'A user of ProjectCo cannot open FleetCo\'s rental customers.'],
    ['MC-FR-34', 'Notifications: owner approval needed, statement ready, dispute raised or resolved, invoice pair failed, customs expiry, certificate expiry, credit hold.', 'Each goes to the role named in the setup.'],
    ['MC-FR-35', 'Language, formats and the site\'s time zone per user and document; right-to-left where needed.', 'Dates on a statement follow the reader\'s format.'],
    ['MC-FR-36', 'Audit: every price, exchange rate and charge traces back to its agreement version, rate, hours and events; agreement changes keep who approved them.', 'Any charge opens its full trail.']
  ]]
];

const DATA = [
  ['Legal entities (new)', 'id, Fusion LE id, name, country, ledger, currency, tax registration, IC organization, calendar, time zone', 'From Fusion (INT-21)'],
  ['Business units (extend)', '+ legal entity, country, roles (projects / fleet owner / rental to customers), default currency', 'Today: id and name only, settings per BU'],
  ['Requests (extend)', '+ requesting LE, request type, project BU, currency; requesting BU = today\'s businessUnitId, now shown and chosen', 'businessUnitId and orgId exist'],
  ['Request lines (extend)', '+ owner BU and LE, relationship type, IC agreement and version, deployment org, transfer price and currency, customer price', 'Lines know their fulfilment class (F&amp;M or S&amp;T)'],
  ['Units (extend)', '+ owner LE and BU, holding type, asset book and number, custody status, current country', 'Units know their yard org'],
  ['IC relationships (new)', 'provider BU, receiver BU, type, mechanism, invoicing required, priority, lead time, cross-border allowed, netting', ''],
  ['Agreements (extend)', 'type INTERCOMPANY with provider and receiver BU, terms of section 6, tax treatment, version', 'agreementType and currency exist'],
  ['Charge lines (extend billing transactions)', 'charge id, type, provider, receiver, line, unit, period, quantity, rate, amount, currency, rate and date of exchange, project / task / expenditure type, status, statement, AR and AP invoice numbers, PPM reference', 'EQR_BILLING_PKG and billing-transactions exist'],
  ['IC statements (new)', 'provider, receiver, period, status (draft, released, disputed, agreed, invoiced, accrued, settled), totals, dispute lines', ''],
  ['Customs records (new)', 'unit, from and to country, regime, permit or carnet, entry date, re-export deadline, closed date, documents', ''],
  ['Country certificates (new)', 'unit, country, certificate type, number, issuer, expiry, document', 'Today: certificates per unit, no country']
];

const INTS = [
  ['INT-10 (redefined)', 'Intercompany invoice pair', 'OIC → Fusion AR (owner) and AP (user)', 'Out', 'Per statement', 'AR and mirror AP invoices, project-coded; idempotent by statement id'],
  ['INT-11 (changed)', 'Customer AR invoice', 'OIC / REST → Fusion AR', 'Out', 'Per period', 'Now from the contracting BU (FleetCo in S3, ProjectCo when it invoices in S2)'],
  ['INT-04/05/06 (changed)', 'Transfer order, reservation, release', 'OIC → Fusion Inventory', 'Out', 'At picking', 'Source and destination must belong to the owner\'s legal entity'],
  ['INT-21 (new)', 'Companies and countries', 'Fusion → EquipRite', 'In', 'Daily', 'Legal entities, ledgers, BUs, IC organizations, countries'],
  ['INT-22 (new)', 'Exchange rates', 'Fusion GL daily rates → EquipRite', 'In', 'Daily', 'Estimates in the catalog, reports in the group currency'],
  ['INT-23 (new)', 'Asset custody and location', 'EquipRite → Fusion Assets / Maintenance', 'Out', 'On dispatch and receipt', 'Asset-held units: where they are'],
  ['INT-24 (new)', 'Intercompany accruals', 'EquipRite → Fusion GL (both ledgers)', 'Out', 'At the IC cut-off', 'Mirrored, reversing journals'],
  ['INT-25 (new)', 'Settlement status', 'Fusion AR / AP / netting → EquipRite', 'In', 'Daily', 'Paid or netted status per statement'],
  ['INT-26 (new)', 'Customer credit', 'Fusion AR → EquipRite', 'In', 'On request', 'Account status and credit limit before release (S3)']
];

const SETUP = [
  ['Fusion: enterprise', 'Legal entities, ledgers, BUs and their IC organizations; intercompany balancing rules (IC receivable and payable accounts per pair)'],
  ['Fusion: parties', 'For each pair: the user company as an IC customer in the owner\'s AR, the owner as an IC supplier in the user\'s AP'],
  ['Fusion: tax', 'Tax registrations of each legal entity; rules for domestic and cross-border equipment hire; withholding by country pair; e-invoicing localisation'],
  ['Fusion: inventory', 'Each owner\'s yards and deployment orgs per country (stock), subinventories and locators; inter-org parameters inside each legal entity only'],
  ['Fusion: PPM', 'Expenditure types (IC equipment rental, IC transport, IC damage); billable or not per contract (OD-07); AP-to-PPM cost import'],
  ['EquipRite', 'IC relationships, IC agreements and their rate schedules, deployment org per owner and country, customs and certificate rules per country, notification roles']
];

const DECISIONS = [
  ['OD-01', 'How FleetCo bills ProjectCo', 'A: invoice pair from EquipRite through OIC (section 6)', 'Finance, Fusion lead'],
  ['OD-02', 'Stock at another company\'s site', 'The owner\'s own deployment orgs; never a transfer into the user\'s org (GR-6)', 'Supply chain, Finance'],
  ['OD-03', 'Depreciation of stock-held fleet', 'Hold rental fleet as assets (tracked in inventory where needed); stock only for low-value or bulk items', 'Finance'],
  ['OD-04', 'Transfer price basis', 'Market rate card (arm\'s length), reviewed yearly; cost plus where no market rate exists', 'Tax, Finance'],
  ['OD-05', 'On-hire and off-hire; in-transit ownership (v1.7 OI-01, OI-05)', 'On hire at receipt on site, off hire at release; transport charged apart; FOB receipt inside the owner', 'Functional owner'],
  ['OD-06', 'Billing frequency and IC cut-off (v1.7 OI-03)', 'Monthly, calendar month; statements day 1, invoices day 4', 'Group finance'],
  ['OD-07', 'Who bills Customer X in S2', 'a: ProjectCo\'s project contract in PPM; b (EquipRite invoice) only for pure equipment hire', 'Finance, Projects'],
  ['OD-08', 'Agreement currency and FX (v1.7 OI-06)', 'The owner\'s ledger currency; the user bears FX', 'Treasury'],
  ['OD-09', 'Tax per country pair', 'Confirmed by the tax team; configured in Fusion Tax', 'Tax'],
  ['OD-10', 'Settlement', 'Monthly netting between group companies', 'Treasury'],
  ['OD-11', 'Damage and loss (v1.7 OI-04)', 'Damage above a threshold needs the user\'s acceptance; loss value = net book value + %', 'Functional owner, Finance'],
  ['OD-12', 'Approvals', 'Owner always for IC lines; requester above its threshold', 'Functional owner'],
  ['OD-13', 'Sub-lending', 'Not allowed: only the owner bills, every leg has its own IC agreement', 'Finance'],
  ['OD-14', 'Same legal entity, two BUs', 'PPM cross-charge, no invoices', 'Finance'],
  ['OD-15', 'Operators and fuel supplied with equipment', 'Separate charge types on the same statement', 'Functional owner']
];

const GAPS = [
  ['Requesting BU', 'The request record has businessUnitId and orgId; Next\'s New request neither asks for nor shows it. Settings (rate source, costing) are per BU.', 'Choose and show it; filter projects and customers by it; derive the legal entity and country'],
  ['Ownership', 'Units know their yard org; lines know their fulfilment class (F&amp;M asset, S&amp;T stock).', 'Owner LE and BU, custody and country on every unit'],
  ['Intercompany', 'v1.7 has one case, S10: a customer that is another legal entity, billed by INT-10 (not built). Customers carry a legalEntityId.', 'IC relationships, IC agreements, sourcing across companies, owner approval'],
  ['Agreements and rates', 'Agreements have a type and a currency; rate schedules a currency and a yard.', 'Provider and receiver BU, IC terms, versions, tax treatment'],
  ['Logistics', 'Transfer orders have a source and destination org; Next creates none (they are in New and Old). BU-to-org mapping has roles and subinventories.', 'Deployment orgs per owner and country; the same-LE check; asset custody; customs'],
  ['Money', 'EQR_BILLING_PKG and billing transactions exist; Next posts usage cost to PPM; INT-10 not started, INT-11 partly.', 'Charge lines with ids, statements, disputes, invoice pair, accruals, reconciliation'],
  ['Countries', 'Nothing yet: no FX, withholding, customs, country certificates or site calendars.', 'Everything in section 9']
];

const PHASES = [
  ['A · Companies', 'Legal entities and countries (INT-21), owner on units, requesting BU on requests, IC relationships, sourcing across companies, owner approval', 'Requests can use another company\'s fleet; nothing is billed yet'],
  ['B · Movement', 'Deployment orgs, transfer orders inside the owner (bring Next\'s picking to transfer orders), asset custody (INT-23), customs and country certificates', 'Equipment can cross companies and borders correctly'],
  ['C · Money', 'IC agreements, the charge run, statements and disputes, the invoice pair (INT-10), accruals (INT-24), customer billing per OD-07, settlement status', 'FleetCo bills ProjectCo every month, reconciled'],
  ['D · Control', 'Reports, consolidation support, netting, security by BU and LE, notifications, languages', 'Group finance closes with zero IC differences']
];

const GLOSSARY = [
  ['Business unit (BU)', 'A unit of a company in Fusion that runs processes (projects, payables, receivables).'],
  ['Legal entity (LE)', 'A company in law, with its own ledger, tax registration and country.'],
  ['Intercompany (IC)', 'Between two legal entities of the same group.'],
  ['Transfer price', 'The price one group company charges another.'],
  ['Invoice pair', 'The owner\'s AR invoice and the user\'s mirror AP invoice, with the same number and lines.'],
  ['Cross-charge', 'Moving a cost between two BUs of one legal entity, without invoices (PPM borrowed and lent).'],
  ['Netting', 'Settling what group companies owe each other by the difference, instead of paying both ways.'],
  ['Elimination', 'Removing intercompany revenue, cost and balances when the group\'s accounts are consolidated.'],
  ['CIP', 'Construction in progress: cost of an asset being built, before it goes into service.'],
  ['Reverse charge', 'VAT accounted by the buyer instead of the seller, common for cross-border services.'],
  ['Withholding tax', 'Tax a payer keeps back from a payment to a non-resident and pays to its own tax authority.'],
  ['Temporary import', 'Bringing equipment into a country for a limited time without paying duties, under a permit or carnet.'],
  ['On hire / off hire', 'The dates a hire starts and ends for charging.'],
  ['Custody', 'Who has the unit now (which company, site or customer), as opposed to who owns it.'],
  ['Deployment org', 'The owner\'s own inventory org where its stock sits while at another party\'s site.'],
  ['Holding type', 'Asset (capitalised, in Fixed Assets) or stock (an inventory item).']
];

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────
const CHAPTERS = ['Why version 2', 'The model in one page', 'Scenario 1: internal project', 'Scenario 2: customer project', 'Scenario 3: FleetCo rents to its customer',
  'How FleetCo bills ProjectCo', 'Accounting entries', 'More scenarios', 'Many countries', 'Requirements', 'Data model', 'Integrations and setup', 'Decisions needed',
  'Today and the plan', 'Glossary'];
const chapter = (n, body) => `<section class="chapter" id="c${n}"><h2><span class="n">${n}</span>${esc(CHAPTERS[n - 1])}</h2>${body}</section>`;
const frCount = FR.reduce((a, g) => a + g[1].length, 0);

function render() {
  const scenarioJournals = (sc, ids) => jTable(pick(ids));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EquipRite FDD v2.0: many companies, many countries</title>
<style>
  :root { --ink:#111827; --muted:#475569; --line:#e5e7eb; --band:#2e5468; --soft:#f8fafc; --fc:#1f6fb2; --pc:#7c3aed; --gr:#047857;
    --nx-ink:#111827; --nx-muted:#5b6b7b; --nx-accent:#2e5468; --nx-accent-soft:#e6eef2; --nx-line:#e5e7eb; --nx-font:'Source Sans 3', system-ui, sans-serif; --fdd-int:#6d28d9; --fdd-int-soft:#f1ebfd; }
  @page { size: A4 landscape; margin: 12mm 12mm 14mm; }
  * { box-sizing: border-box; }
  body { margin:0; color:var(--ink); font-family:'Source Sans 3', system-ui, 'Segoe UI', sans-serif; font-size:10.5pt; line-height:1.45; font-variant-numeric: tabular-nums; }
  main { max-width: 273mm; margin: 0 auto; }
  p, .prose li { max-width: 205mm; }
  h1 { font-size: 30pt; line-height:1.1; margin: 0 0 8px; }
  h2 { font-size: 17pt; margin: 0 0 10px; padding-top: 4px; border-top: 3px solid var(--band); }
  h2 .n { color: var(--band); margin-right: 8px; }
  h3 { font-size: 12.5pt; margin: 16px 0 6px; color: var(--band); }
  h4 { font-size: 11pt; margin: 8px 0 4px; }
  h2, h3, h4 { break-after: avoid; }
  table.ids td:first-child { white-space: nowrap; }
  p { margin: 0 0 8px; }
  ul { margin: 4px 0 8px; padding-left: 18px; } li { margin: 2px 0; }
  .chapter { break-before: page; }
  .cover .band { background: var(--band); color: #fff; padding: 20px 22px 16px; border-radius: 6px 6px 0 0; }
  .cover h1 { font-size: 25pt; }
  .cover table { font-size: 9pt; margin-bottom: 6px; } .cover th, .cover td { padding: 3px 7px; }
  .cover h3 { margin-top: 8px; }
  .cover .band p { color: #e2edf2; font-size: 12.5pt; margin: 0; max-width: none; }
  .strip { display:flex; height:7px; } .strip i { flex:1; } .strip i:nth-child(1){background:#c74634}.strip i:nth-child(2){background:#e5a22f}.strip i:nth-child(3){background:#6f9a3a}.strip i:nth-child(4){background:#2b83c4}.strip i:nth-child(5){background:#7a4fb5}
  .kicker { font-size: 9pt; letter-spacing: .08em; text-transform: uppercase; color: #cfe0e8; font-weight: 700; margin-bottom: 10px; display:block; }
  .meta { display:grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 10px 0; }
  .meta div { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
  .meta b { display:block; font-size: 15pt; } .meta span { color: var(--muted); font-size: 9.5pt; }
  .toc { columns: 5; column-gap: 18px; margin: 0; padding: 0; list-style: none; font-size: 9.5pt; }
  .toc li { padding: 2px 0; border-bottom: 1px dotted #cbd5e1; break-inside: avoid; }
  .toc b { color: var(--band); display:inline-block; width: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 9.5pt; }
  th, td { text-align: left; vertical-align: top; padding: 5px 7px; border-bottom: 1px solid var(--line); }
  th { background: #f1f5f9; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  tr { break-inside: avoid; }
  td:first-child { font-weight: 600; white-space: nowrap; }
  table.wrap td:first-child { white-space: normal; }
  table.steps td:nth-child(2), table.steps td:nth-child(3) { white-space: nowrap; font-weight: 600; }
  .chip { display:inline-block; padding: 0 7px; border-radius: 999px; font-size: 8.5pt; font-weight: 700; background:#f1f5f9; color:#334155; white-space: nowrap; }
  .chip.je { background:#fdf0d8; color:#92400e; }
  .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 10px; color: #78350f; margin: 8px 0 12px; max-width: 230mm; }
  .tip { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 8px 10px; color: #065f46; margin: 8px 0 12px; max-width: 230mm; }
  .cols { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; } .cols3 { display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .card { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; background: var(--soft); break-inside: avoid; }
  .card h4 { margin: 0 0 4px; }
  .rule { display:grid; grid-template-columns: 56px 1fr; gap: 4px 10px; border-left: 4px solid var(--band); background: var(--soft); padding: 7px 10px; margin: 6px 0; break-inside: avoid; }
  .rule b.id { color: var(--band); }
  figure.diagram { margin: 10px 0 12px; break-inside: avoid; }
  figure.diagram .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
  figure.diagram svg { display:block; }
  figcaption { color: var(--muted); font-size: 9pt; margin-top: 4px; }
  .glance { display:block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background:#fff; padding: 8px; }
  .g-title { font-size: 13px; font-weight: 700; fill: var(--band); }
  .g-box { fill:#fff; stroke:#5a6876; stroke-width:1.5; } .g-fc { fill:#eaf2fb; stroke: var(--fc); } .g-pc { fill:#f3edff; stroke: var(--pc); } .g-cu { fill:#fff7ed; stroke:#c2410c; }
  .g-name { font-size: 13px; font-weight: 700; fill: var(--ink); } .g-sub { font-size: 11px; fill: var(--muted); }
  .g-eq { stroke: var(--fc); stroke-width: 2.2; } .g-mo { stroke: var(--gr); stroke-width: 2.2; stroke-dasharray: 6 4; }
  .g-lab { font-size: 11px; font-weight: 600; } .g-lab-eq { fill: var(--fc); } .g-lab-mo { fill: var(--gr); }
  /* the flow diagrams: EquipRite Next's FDD page styles */
  .fdd-lane { fill: #fbfcfd; } .fdd-lane--alt { fill: #f4f7fa; } .fdd-lane--system { fill: #eef6f8; } .fdd-lane--fusion { fill: #f7f4ff; }
  .fdd-lane-line { stroke: #e2e7ed; stroke-width: 1; } .fdd-lane-edge { stroke: #cfd7e0; stroke-width: 1; }
  .fdd-lane-label { font-size: 12.5px; font-weight: 700; fill: var(--nx-ink); } .fdd-lane-sub { font-size: 10.5px; fill: var(--nx-muted); }
  .fdd-edge { fill: none; stroke: #7b8794; stroke-width: 1.6; } .fdd-edge--int { stroke: var(--fdd-int); } .fdd-edge--back { stroke: #b42318; stroke-dasharray: 5 4; }
  .fdd-head { fill: #7b8794; } .fdd-head--int { fill: var(--fdd-int); } .fdd-head--back { fill: #b42318; }
  .fdd-tag rect { fill: #fff; stroke: #cfd7e0; } .fdd-tag text { font-size: 10.5px; font-weight: 600; fill: #3d4a57; }
  .fdd-tag--int rect { fill: var(--fdd-int-soft); stroke: #c4b5fd; } .fdd-tag--int text { fill: #4c1d95; }
  .fdd-tag--back rect { fill: #fff5f4; stroke: #f1b8b2; } .fdd-tag--back text { fill: #8f1d14; }
  .fdd-shape { fill: #fff; stroke: #5a6876; stroke-width: 1.5; }
  .fdd-node--decision .fdd-shape { fill: #fffbeb; stroke: #b45309; } .fdd-node--system .fdd-shape { fill: #faf7ff; stroke: var(--fdd-int); stroke-dasharray: 4 3; }
  .fdd-node--end .fdd-shape { fill: #ecfdf5; stroke: #047857; }
  .fdd-label { font-size: 12px; font-weight: 600; fill: var(--nx-ink); } .fdd-label--sm { font-size: 11px; }
  .fdd-dp { font-size: 10.5px; font-weight: 800; fill: #92400e; }
  /* journals */
  table.jt { font-size: 9.3pt; }
  table.jt td.num, table.jt th.num { text-align: right; white-space: nowrap; width: 90px; }
  table.jt tbody.je { break-inside: avoid; }
  table.jt tr.je-h td { background: #f8fafc; border-top: 1px solid #cbd5e1; border-bottom: 0; padding-top: 6px; }
  table.jt tr.je-l td { border-bottom: 0; padding-top: 1px; padding-bottom: 1px; }
  table.jt tr.je-n td { color: var(--muted); font-size: 8.8pt; border-bottom: 0; padding-bottom: 7px; }
  td.cr { padding-left: 34px; } .jid { display:inline-block; background:#fdf0d8; color:#92400e; border-radius: 4px; padding: 0 6px; font-weight: 800; }
  .lchip { display:inline-block; border-radius: 999px; padding: 0 8px; font-size: 8.5pt; font-weight: 700; color:#fff; }
  .l-fc { background: var(--fc); } .l-pc { background: var(--pc); } .l-gr { background: var(--gr); }
  .vchip { display:inline-block; border: 1px solid #cbd5e1; border-radius: 999px; padding: 0 7px; font-size: 8.3pt; color: var(--muted); margin-left: 4px; }
  .src { float: right; color: var(--muted); font-size: 8.6pt; }
  .kpis { display:grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 8px 0 12px; }
  .kpis div { border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; background: var(--soft); } .kpis b { display:block; font-size: 15pt; } .kpis span { color: var(--muted); font-size: 9pt; }
  .explorer { border: 2px solid var(--band); border-radius: 8px; padding: 12px 14px; margin: 10px 0; }
  .explorer .inputs { display:grid; grid-template-columns: repeat(6, 1fr); gap: 8px 12px; margin-bottom: 8px; }
  .explorer label { display:flex; flex-direction: column; font-size: 9pt; color: var(--muted); font-weight: 600; }
  .explorer input[type=number] { font: inherit; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 4px; color: var(--ink); width: 100%; min-width: 0; }
  .explorer .inputs label { min-width: 0; }
  .explorer .filters label { flex-direction: row; align-items: center; gap: 4px; font-weight: 400; color: var(--ink); }
  @media (max-width: 800px) { .explorer .inputs { grid-template-columns: repeat(2, 1fr); } .kpis, .meta { grid-template-columns: repeat(2, 1fr); } .cols, .cols3 { grid-template-columns: 1fr; } }
  .explorer .filters { display:flex; flex-wrap: wrap; gap: 6px 14px; margin: 6px 0 10px; font-size: 9.5pt; }
  .print-only { display: none; }
  @media print { .screen-only { display: none !important; } .print-only { display: block; } figure.diagram .scroll { overflow: visible; } figure.diagram svg { width: 100%; height: auto; max-height: 126mm; } }
  @media screen { body { background: #e2e8f0; } main { background: #fff; padding: 24px 28px; margin: 16px auto; border-radius: 8px; max-width: 1240px; } }
</style></head><body><main>

<section class="cover">
  <div class="band"><span class="kicker">Functional Design Document · version 2.0 · draft for review</span><h1>EquipRite: many companies, many countries</h1>
    <p>Requests tied to business units, equipment shared between group companies, intercompany billing and the accounting of each case. Extends FDD v1.7 (RITE-FDD-EQUIPRITE-001).</p></div>
  <div class="strip"><i></i><i></i><i></i><i></i><i></i></div>
  <div class="meta">
    <div><b>3</b><span>scenarios, ${SCEN_LIST.length} cases</span></div>
    <div><b>4</b><span>flow diagrams</span></div>
    <div><b>${J.entries.length}</b><span>journal entries, worked</span></div>
    <div><b>${BR.length} + ${frCount}</b><span>business + functional requirements</span></div>
    <div><b>${INTS.length}</b><span>integrations new or changed</span></div>
    <div><b>${DECISIONS.length}</b><span>decisions for the business</span></div>
  </div>
  ${table(['Document', 'Value'], [
    ['Title', 'EquipRite FDD v2.0: multi-company, multi-country and intercompany'],
    ['Status', 'Draft for review by Finance, Tax, Treasury, Supply chain, Projects and the EquipRite team. Nothing here is built yet.'],
    ['Date', DATE],
    ['Based on', 'FDD v1.7 (its summary in this repo), the EquipRite data model (services/eqp-v1), the code of the four apps, and the business scenarios given by the product owner on ' + DATE + '.'],
    ['Names used', 'Company 1 = <b>ProjectCo</b> (does projects); Company 2 = <b>FleetCo</b> (holds the equipment); Customer X = ProjectCo\'s client; Customer Y = FleetCo\'s rental customer. Amounts are an example only.'],
    ['Not decided here', 'The ' + DECISIONS.length + ' decisions in section 13 need their owners. The accounting follows common Oracle Fusion practice and must be confirmed against your chart of accounts, tax rules and Fusion setup.']
  ], 'wrap')}
  <h3>Contents</h3>
  <ol class="toc">${CHAPTERS.map((c, i) => `<li><b>${i + 1}</b>${esc(c)}</li>`).join('')}</ol>
</section>

${chapter(1, `
<p>FDD v1.7 assumes one company: the equipment, the projects, the money and the customer all sit in the same legal entity. Its only intercompany case (S10) treats another group company as a <i>customer</i>. Real groups work differently:</p>
${list(['<b>Company 1 does projects</b> and <b>Company 2 holds the equipment</b>; Company 1 takes Company 2\'s equipment to its own projects.',
  'Company 1\'s projects can be <b>internal</b> (its own) or <b>for a customer</b>, and the equipment cost must land on the right project either way.',
  'Company 2 also <b>rents directly to its own customers</b>.',
  'Company 2 holds equipment either as <b>stock</b> (inventory items) or as <b>assets</b> only.',
  'The companies can be in <b>different countries</b>: currencies, tax, customs, calendars and languages differ.',
  'So <b>every request belongs to a business unit</b>, and the money must move between companies correctly: Company 2 bills Company 1.'])}
<h3>What v2 changes in v1.7</h3>
${table(['v1.7', 'Becomes in v2'], [
  ['S10 Internal customer rental (IC billing)', 'Replaced by scenarios 1 and 2: the user company is not a customer; it uses the owner\'s fleet on its projects'],
  ['INT-10 IC billing ("Cost Management, OIC scheduled")', 'The intercompany invoice pair: AR in the owner, project-coded AP in the user (section 6)'],
  ['INT-11 AR invoice', 'Issued by the contracting BU: FleetCo in S3, ProjectCo when it invoices the hire in S2'],
  ['Equipment Yard → Project Site virtual org (7.17.2D)', 'Deployment orgs belong to the owner; a transfer order never crosses legal entities (GR-6)'],
  ['Region / Inventory Org filter (INT-20)', 'Security and filters by business unit and legal entity, plus orgs'],
  ['OI-01 billing start, OI-03 IC frequency, OI-04 damage, OI-05 FOB point, OI-06 multi-currency', 'Answered as recommendations in decisions OD-05, OD-06, OD-11, OD-05 and OD-08'],
  ['DEC-02 External = third party via AR', 'Kept; the AR invoice comes from the contracting BU']
], 'wrap')}
`)}

${chapter(2, `
<h3>Seven rules everything else follows</h3>
${RULES.map((r) => `<div class="rule"><b class="id">${r[0]}</b><div><b>${esc(r[1])}.</b> ${esc(r[2])}</div></div>`).join('')}
<h3>The three scenarios at a glance</h3>
${glance()}
<p style="margin-top:6px">Blue: the equipment moves (custody). Green, dashed: the money moves. Ownership stays with FleetCo in all three.</p>
<h3>Who is who on a request</h3>
${table(['Role', 'Meaning', 'In the example'], WHO, 'wrap')}
<h3>The relationship decides the flow</h3>
${table(['Relationship', 'When', 'Approvals', 'Money', 'Intercompany'], RELS, 'wrap')}
<h3>Asset or stock</h3>
${table(['', 'Asset (not stockable)', 'Stock (inventory item)'], HOLD, 'wrap')}
`)}

${chapter(3, `
<p>ProjectCo raises a request under its own business unit for an <b>internal project</b> (overhead or capital) and uses FleetCo\'s equipment. FleetCo approves the loan, ships, and bills ProjectCo every month; the cost lands on ProjectCo\'s project; the group eliminates the intercompany part.</p>
${diagram('sc1')}
${steps('sc1')}
<h3>Accounting: same country, an asset</h3>
${scenarioJournals('S1', ['F1', 'F2', 'F6', 'P2', 'P3', 'F7', 'P4', 'G1', 'G2'])}
<h3>If the unit is stock</h3>
${scenarioJournals('S1', ['F3', 'F4'])}
<h3>If the companies are in two countries</h3>
<p>FleetCo invoices in its currency; ProjectCo converts at the invoice date, self-assesses VAT, withholds tax at payment and books the exchange difference. Rates in the example: ${P.fx} at the invoice, ${P.fxPay} at payment; withholding ${Math.round(P.wht * 100)} %.</p>
${scenarioJournals('S1', ['XF6', 'XP2', 'XP4', 'XF7'])}
${note('Capital project (MC-S03): the IC charge becomes part of an asset ProjectCo builds (P3). At consolidation the group removes FleetCo\'s margin from that asset, not only from the profit and loss.')}
`)}

${chapter(4, `
<p>ProjectCo works for <b>Customer X</b> on a contract project and uses FleetCo\'s equipment. Two flows of money: FleetCo bills ProjectCo (intercompany, as scenario 1), and ProjectCo bills Customer X under its contract. ProjectCo\'s margin is the difference; in the group, only Customer X\'s revenue remains.</p>
${diagram('sc2')}
${steps('sc2')}
<h3>Accounting</h3>
<p>The intercompany part is scenario 1\'s (F2, F6, P2, F7, P4, G1, G2) on project P-EXT. What scenario 2 adds:</p>
${scenarioJournals('S2', ['P5', 'P6', 'P7', 'P8'])}
<div class="kpis">
  <div><b>${fmt(T.custNet)}</b><span>billed to Customer X (before VAT)</span></div>
  <div><b>${fmt(T.icNet)}</b><span>IC cost from FleetCo</span></div>
  <div><b>${fmt(T.margin2)}</b><span>ProjectCo\'s margin</span></div>
  <div><b>≈ ${fmt(T.groupMargin2)}</b><span>group margin (less FleetCo\'s carrier and a share of depreciation)</span></div>
  <div><b>0</b><span>intercompany left after elimination</span></div>
</div>
${tip('Never bill the customer twice: if EquipRite invoices the hire from ProjectCo (P8), the IC equipment expenditure types are non-billable on the contract; if the contract bills them (P5, P6), EquipRite issues no customer invoice (OD-07).')}
`)}

${chapter(5, `
<p>FleetCo rents its own equipment to <b>Customer Y</b>. No intercompany: FleetCo is the requesting and contracting BU, quotes, checks credit, delivers, invoices through Fusion AR, inspects the return, and settles the deposit.</p>
${diagram('sc3')}
${steps('sc3')}
<h3>Accounting</h3>
${scenarioJournals('S3', ['R1', 'F2', 'R2', 'R3', 'R4', 'R5', 'R6'])}
<p>FleetCo\'s monthly depreciation (F1) and, for stock, the moves inside FleetCo (F3, F4) are as scenario 1. Revenue ${fmt(T.net3)} against the carrier and about a month of depreciation: ≈ ${fmt(T.margin3)}.</p>
`)}

${chapter(6, `
<p>The answer to "how does Company 2 bill Company 1": one statement per company pair per month from EquipRite, agreed by both, turned into an <b>invoice pair</b> (FleetCo\'s AR invoice and ProjectCo\'s mirror AP invoice, project-coded), accrued if late, settled by netting, reconciled by charge id and eliminated.</p>
${diagram('icb')}
${steps('icb')}
<h3>What is charged</h3>
${table(['Charge', 'Rule', 'From'], CHARGES, 'wrap')}
<h3>The month</h3>
${table(['When', 'What', 'Who'], CALENDAR, 'wrap')}
<h3>The mechanism: four ways, one recommended (OD-01)</h3>
${table(['Option', 'How', 'For', 'Against'], OPTIONS, 'wrap')}
${tip('Why A: the hire\'s rules (rate periods, standby, breakdown credits, minimum hire) already live in EquipRite\'s rate engine, the user\'s cost must reach a PPM project in another ledger and currency, and cross-border tax and e-invoicing must run in Fusion. A keeps one charge id from EquipRite to both invoices and the project.')}
`)}

${chapter(7, `
<p>Every entry of the worked example, by company. Assumptions: a hire of ${P.weeks} weeks at ${fmt(P.icRate)}/week between the companies, transport ${fmt(P.transport)} (carrier ${fmt(P.carrier)}), Customer X billed ${fmt(P.custRate)}/week plus ${fmt(P.custTransport)}, Customer Y ${fmt(P.rentRate)}/week plus ${fmt(P.delivery)}, VAT ${Math.round(P.vat * 100)} %, the unit\'s cost ${fmt(P.assetCost)} with ${fmt(P.accDep)} depreciated, depreciation ${fmt(P.dep)} a month, stock book value ${fmt(P.bookValue)}. Account names are generic: map them to your chart of accounts.</p>
<div class="kpis">
  <div><b>${fmt(T.icGross)}</b><span>IC invoice FleetCo → ProjectCo (with VAT)</span></div>
  <div><b>${fmt(T.custGross)}</b><span>ProjectCo → Customer X (S2)</span></div>
  <div><b>${fmt(T.gross3)}</b><span>FleetCo → Customer Y (S3)</span></div>
  <div><b>${fmt(T.xbCost)}</b><span>cross-border IC cost in ProjectCo\'s currency</span></div>
  <div><b>${fmt(T.xbFx)}</b><span>exchange loss at payment (cross-border)</span></div>
</div>
<div class="explorer screen-only" id="jx">
  <b>Journal explorer</b> <span style="color:var(--muted)">Change the assumptions or narrow the entries; the tables below recompute.</span>
  <div class="inputs">
    ${[['weeks', 'Weeks on hire'], ['icRate', 'IC rate / week'], ['transport', 'IC transport'], ['custRate', 'Customer X rate / week'], ['rentRate', 'Customer Y rate / week'], ['vat', 'VAT (0.05 = 5 %)'],
    ['fx', 'FX at invoice'], ['fxPay', 'FX at payment'], ['wht', 'Withholding (0.05)'], ['damage', 'Damage charge'], ['lossValue', 'Loss value'], ['dep', 'Depreciation / month']]
    .map((x) => `<label>${x[1]}<input type="number" step="any" data-k="${x[0]}" value="${P[x[0]]}"></label>`).join('')}
  </div>
  <div class="filters">
    <b>Scenario</b> ${['S1', 'S2', 'S3'].map((s) => `<label><input type="checkbox" data-sc="${s}" checked> ${s}</label>`).join('')}
    <b>Show</b> ${[['asset', 'asset'], ['stock', 'stock'], ['xb', 'cross-border'], ['accrual', 'accruals'], ['loss', 'loss'], ['alt', 'alternatives']].map((v) => `<label><input type="checkbox" data-v="${v[0]}" checked> ${v[1]}</label>`).join('')}
    <b>Company</b> ${['FleetCo', 'ProjectCo', 'Group'].map((l) => `<label><input type="checkbox" data-l="${l}" checked> ${l}</label>`).join('')}
  </div>
  <div id="jx-out"></div>
</div>
<div class="print-only">
  <h3>FleetCo (Company 2)</h3>${jTable(J.entries.filter((e) => e.ledger === 'FleetCo'))}
  <h3>ProjectCo (Company 1)</h3>${jTable(J.entries.filter((e) => e.ledger === 'ProjectCo'))}
  <h3>Group consolidation</h3>${jTable(J.entries.filter((e) => e.ledger === 'Group'))}
</div>
`)}

${chapter(8, `
<p>The cases EquipRite must handle, each tied to a scenario and its entries.</p>
${table(['Case', 'What', 'Scenario', 'Relationship', 'Entries and effect'], SCEN_LIST, 'wrap ids')}
`)}

${chapter(9, `
<p>What changes when the companies, sites or customers are in different countries. Each is data per country or legal entity (GR-7).</p>
${table(['Topic', 'Requirement'], COUNTRY, 'wrap')}
${note('Tax and customs are specialist areas: the tax team confirms the treatment per country pair (OD-09) before go-live. EquipRite stores the codes and dates; Fusion calculates tax and issues tax invoices.')}
`)}

${chapter(10, `
<h3>Business requirements</h3>
${table(['ID', 'Requirement', 'What it means'], BR, 'wrap ids')}
<h3>Functional requirements</h3>
${FR.map((g) => `<h4>${esc(g[0])}</h4>${table(['ID', 'Requirement', 'Accepted when'], g[1], 'wrap ids')}`).join('')}
`)}

${chapter(11, `
<p>Changes to EquipRite\'s data. "Today" is what the data model (services/eqp-v1) already has.</p>
${table(['Entity', 'Fields', 'Today'], DATA, 'wrap')}
`)}

${chapter(12, `
<h3>Integrations</h3>
${table(['ID', 'Name', 'Between', 'Dir.', 'When', 'What'], INTS, 'wrap ids')}
<h3>Setup for each pair of companies</h3>
${table(['Where', 'What'], SETUP, 'wrap')}
`)}

${chapter(13, `
<p>Decisions the business takes before build. Each has a recommendation; none is settled until its owner agrees.</p>
${table(['ID', 'Decision', 'Recommendation', 'Owner'], DECISIONS, 'wrap ids')}
`)}

${chapter(14, `
<h3>What EquipRite has today, and what v2 needs</h3>
${table(['Area', 'Today (from the code)', 'v2 needs'], GAPS, 'wrap')}
<h3>Build in four steps</h3>
${table(['Step', 'Content', 'Result'], PHASES, 'wrap')}
${tip('Step B starts with what Next lacks anyway: transfer orders (create, reserve, release) are built in New and Old but not in Next. Building them in Next with the same-legal-entity check serves v1.7 and v2 at once.')}
`)}

${chapter(15, table(['Term', 'Meaning'], GLOSSARY, 'wrap'))}

</main>
<script>
${journals.toString()}
${fmt.toString()}
${jTable.toString()}
(function () {
  var box = document.getElementById('jx');
  if (!box) return;
  function draw() {
    var p = {};
    box.querySelectorAll('input[data-k]').forEach(function (i) { p[i.getAttribute('data-k')] = i.value; });
    var sc = {}, v = {}, l = {};
    box.querySelectorAll('input[data-sc]').forEach(function (i) { sc[i.getAttribute('data-sc')] = i.checked; });
    box.querySelectorAll('input[data-v]').forEach(function (i) { v[i.getAttribute('data-v')] = i.checked; });
    box.querySelectorAll('input[data-l]').forEach(function (i) { l[i.getAttribute('data-l')] = i.checked; });
    var r = journals(p);
    var list = r.entries.filter(function (e) {
      return l[e.ledger] && e.sc.some(function (s) { return sc[s]; }) && (e.variant === 'all' || v[e.variant]);
    });
    var t = r.totals;
    document.getElementById('jx-out').innerHTML = '<div class="kpis"><div><b>' + fmt(t.icGross) + '</b><span>IC invoice</span></div><div><b>' + fmt(t.custGross)
      + '</b><span>to Customer X</span></div><div><b>' + fmt(t.margin2) + '</b><span>ProjectCo margin (S2)</span></div><div><b>' + fmt(t.gross3)
      + '</b><span>to Customer Y</span></div><div><b>' + fmt(t.xbFx) + '</b><span>FX at payment</span></div></div>'
      + (list.length ? jTable(list) : '<p>No entries match.</p>');
  }
  box.addEventListener('input', draw);
  box.addEventListener('change', draw);
  draw();
})();
</script>
</body></html>`;
}

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(HTML_OUT, render());
  console.log('wrote', path.relative(process.cwd(), HTML_OUT));
  if (process.argv.includes('--no-pdf')) return;
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_OUT, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: PDF_OUT, format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:8px;color:#64748b;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span>EquipRite FDD v2.0 draft · many companies, many countries</span><span class="pageNumber"></span></div>' });
    console.log('wrote', path.relative(process.cwd(), PDF_OUT));
  } finally {
    await browser.close();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { render, journals, BR, FR, DECISIONS, SCEN_LIST };
