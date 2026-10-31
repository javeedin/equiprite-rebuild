'use strict';
/**
 * EquipRite FDD v2.0: the swimlane flows (the three scenarios and how FleetCo bills ProjectCo), in the format of
 * EquipRite Next's FDD page (webApps/equiprite-next/resources/js/fddCatalog.js FLOWS), so its renderer
 * (fddModel.svg) draws them. `dp` carries the journal entries a step makes (see journals.js), shown on the box.
 */

const LANES = {
  pcpm: { label: 'ProjectCo PM', sub: 'Company 1 · requester' },
  pcsite: { label: 'ProjectCo site', sub: 'receives, records hours' },
  pcrev: { label: 'ProjectCo review', sub: 'PM and finance' },
  eq: { label: 'EquipRite', sub: 'the system', system: true },
  oic: { label: 'OIC', sub: 'Oracle Integration', system: true },
  fcem: { label: 'FleetCo EM', sub: 'Company 2 · owns fleet' },
  fcyard: { label: 'FleetCo yard', sub: 'picks, ships, receives' },
  fcdesk: { label: 'FleetCo desk', sub: 'quotes, agreements' },
  fcfin: { label: 'FleetCo finance', sub: 'Company 2' },
  fcfus: { label: 'FleetCo Fusion', sub: 'Assets, Inventory, AR', fusion: true },
  pcfus: { label: 'ProjectCo Fusion', sub: 'PPM, AP, AR', fusion: true },
  custx: { label: 'Customer X', sub: 'ProjectCo\'s client' },
  custy: { label: 'Customer Y', sub: 'FleetCo\'s customer' },
  group: { label: 'Group', sub: 'consolidation', system: true }
};

const TO = ['INT-04', 'INT-05', 'INT-06'];
const W = { colW: 118, nodeW: 106 };

const FLOWS = [
  Object.assign({ id: 'sc1', title: 'Scenario 1: ProjectCo uses FleetCo\'s equipment on an internal project', short: 'Scenario 1',
    lanes: ['pcpm', 'pcsite', 'eq', 'fcem', 'fcyard', 'fcfus', 'pcfus', 'group'],
    steps: [
      { key: 'raise', lane: 'pcpm', col: 0, label: ['Raise, submit', '(BU ProjectCo)'], what: 'Requesting BU ProjectCo, internal project P-INT, task, dates, the site in Country A. ProjectCo\'s own approval only above its threshold.' },
      { key: 'source', lane: 'eq', col: 1, kind: 'decision', label: ['Group fleet', 'free? Price?'], what: 'Own fleet first, then the providers the IC matrix allows; FleetCo\'s unit, its location and the transfer price from the IC agreement.' },
      { key: 'lend', lane: 'fcem', col: 2, kind: 'decision', label: ['Lend and', 'allocate?'], what: 'The owner\'s Equipment Manager approves the loan and picks the unit(s); only FleetCo\'s fleet is offered.' },
      { key: 'ship', lane: 'fcyard', col: 3, label: ['Pick, inspect,', 'ship'], dp: 'F2', what: 'Out of FleetCo\'s yard; cross-border: export and temporary-import papers.' },
      { key: 'to', lane: 'fcfus', col: 3, kind: 'system', label: ['Stock: TO to', 'own deploy org'], dp: 'F3', ints: TO, what: 'Stock only: the transfer order stays inside FleetCo (yard → FleetCo\'s deployment org). Asset: custody only, no Fusion move.' },
      { key: 'onhire', lane: 'pcsite', col: 4, label: ['Receive:', 'on hire'], dp: 'F4', what: 'Receipt at the site starts the hire (agreement default).' },
      { key: 'hours', lane: 'pcsite', col: 5, label: ['Hours, standby', 'approved'], what: 'ProjectCo records and approves the hours in the site\'s time zone and calendar; FleetCo can see them.' },
      { key: 'charge', lane: 'eq', col: 6, label: ['Month end:', 'IC charges'], what: 'Rental, standby, transport and credits per the IC agreement, one statement for the company pair.' },
      { key: 'agree', lane: 'pcpm', col: 7, kind: 'decision', label: ['Statement', 'agreed?'], what: 'ProjectCo reviews the statement within the dispute window.' },
      { key: 'ar', lane: 'fcfus', col: 8, kind: 'system', label: ['AR invoice', 'to ProjectCo'], dp: 'F6', what: 'FleetCo\'s intercompany receivable and revenue.' },
      { key: 'ap', lane: 'pcfus', col: 8, kind: 'system', label: ['AP invoice →', 'cost on P-INT'], dp: 'P2', what: 'The mirror invoice, coded to the project; PPM imports the cost.' },
      { key: 'offhire', lane: 'pcsite', col: 9, label: ['Off-hire,', 'send back'], what: 'The site releases the unit: the hire ends on the off-hire date.' },
      { key: 'back', lane: 'fcyard', col: 10, label: ['Receive back,', 'inspect'], what: 'Stock: the return transfer order (F3/F4 backwards). Damage is charged to ProjectCo like any IC charge.' },
      { key: 'settle', lane: 'group', col: 11, kind: 'end', label: ['Settled,', 'eliminated'], dp: 'F7 P4 G1', what: 'Netting or payment; at consolidation the IC revenue and cost cancel out.' }
    ],
    edges: [{ from: 'raise', to: 'source' }, { from: 'source', to: 'lend', label: 'yes' }, { from: 'source', to: 'raise', label: 'no', back: true },
      { from: 'lend', to: 'ship', label: 'yes' }, { from: 'lend', to: 'raise', label: 'refused', back: true }, { from: 'ship', to: 'to', ints: TO, arrow: 'start' },
      { from: 'ship', to: 'onhire' }, { from: 'onhire', to: 'hours' }, { from: 'hours', to: 'charge', label: 'monthly' }, { from: 'charge', to: 'agree' },
      { from: 'agree', to: 'ar', ints: ['INT-10'] }, { from: 'agree', to: 'ap', ints: ['INT-10'] }, { from: 'agree', to: 'charge', label: 'no: credit or re-rate', back: true },
      { from: 'hours', to: 'offhire', label: 'job done' }, { from: 'offhire', to: 'back' }, { from: 'back', to: 'settle' }, { from: 'ar', to: 'settle' }, { from: 'ap', to: 'settle' }] }, W),

  Object.assign({ id: 'sc2', title: 'Scenario 2: ProjectCo uses FleetCo\'s equipment on a project for its customer', short: 'Scenario 2',
    lanes: ['pcpm', 'pcsite', 'eq', 'fcem', 'fcyard', 'fcfus', 'pcfus', 'custx', 'group'],
    steps: [
      { key: 'raise', lane: 'pcpm', col: 0, label: ['Raise: P-EXT', 'for Customer X'], what: 'Requesting BU ProjectCo; the project is a contract project with Customer X.' },
      { key: 'source', lane: 'eq', col: 1, kind: 'decision', label: ['Group fleet', 'free? Price?'], what: 'As scenario 1. The catalog shows the IC price; the customer\'s price is on the project contract.' },
      { key: 'lend', lane: 'fcem', col: 2, kind: 'decision', label: ['Lend and', 'allocate?'], what: 'FleetCo approves and allocates.' },
      { key: 'ship', lane: 'fcyard', col: 3, label: ['Pick, inspect,', 'ship'], dp: 'F2', what: 'To Customer X\'s site, where ProjectCo works.' },
      { key: 'to', lane: 'fcfus', col: 3, kind: 'system', label: ['Stock: TO to', 'own deploy org'], dp: 'F3', ints: TO, what: 'Stock only, inside FleetCo.' },
      { key: 'onhire', lane: 'pcsite', col: 4, label: ['Receive:', 'on hire'], dp: 'F4', what: 'The hire starts.' },
      { key: 'hours', lane: 'pcsite', col: 5, label: ['Hours, standby', 'approved'], what: 'The same hours drive the IC charge and the customer billing.' },
      { key: 'charge', lane: 'eq', col: 6, label: ['Month end:', 'IC charges'], what: 'One IC statement FleetCo → ProjectCo.' },
      { key: 'agree', lane: 'pcpm', col: 7, kind: 'decision', label: ['Statement', 'agreed?'], what: 'Dispute window as scenario 1.' },
      { key: 'ar', lane: 'fcfus', col: 8, kind: 'system', label: ['AR invoice', 'to ProjectCo'], dp: 'F6', what: 'FleetCo\'s IC revenue.' },
      { key: 'ap', lane: 'pcfus', col: 8, kind: 'system', label: ['AP invoice →', 'cost on P-EXT'], dp: 'P2', what: 'Billable cost on the customer project.' },
      { key: 'bill', lane: 'pcfus', col: 9, kind: 'system', label: ['PPM revenue,', 'customer invoice'], dp: 'P5 P6', what: 'ProjectCo bills Customer X under its contract (OD-07 a), or EquipRite invoices the hire (OD-07 b, P8): never both.' },
      { key: 'pays', lane: 'custx', col: 10, kind: 'end', label: ['Customer X', 'pays ProjectCo'], dp: 'P7', what: 'Customer revenue stays in the group.' },
      { key: 'offhire', lane: 'pcsite', col: 9, label: ['Off-hire,', 'send back'], what: 'The hire ends.' },
      { key: 'back', lane: 'fcyard', col: 10, label: ['Receive back,', 'inspect'], what: 'Damage: charged to ProjectCo (IC), which may recover it from Customer X under its contract.' },
      { key: 'settle', lane: 'group', col: 11, kind: 'end', label: ['Settled,', 'eliminated'], dp: 'F7 P4 G1', what: 'The IC part cancels out; ProjectCo\'s margin is customer revenue less the IC cost.' }
    ],
    edges: [{ from: 'raise', to: 'source' }, { from: 'source', to: 'lend', label: 'yes' }, { from: 'source', to: 'raise', label: 'no', back: true },
      { from: 'lend', to: 'ship', label: 'yes' }, { from: 'ship', to: 'to', ints: TO, arrow: 'start' }, { from: 'ship', to: 'onhire' }, { from: 'onhire', to: 'hours' },
      { from: 'hours', to: 'charge', label: 'monthly' }, { from: 'charge', to: 'agree' }, { from: 'agree', to: 'ar', ints: ['INT-10'] }, { from: 'agree', to: 'ap', ints: ['INT-10'] },
      { from: 'agree', to: 'charge', label: 'no: credit or re-rate', back: true }, { from: 'ap', to: 'bill' }, { from: 'bill', to: 'pays' },
      { from: 'hours', to: 'offhire', label: 'job done' }, { from: 'offhire', to: 'back' }, { from: 'back', to: 'settle' }, { from: 'ar', to: 'settle' }] }, W),

  Object.assign({ id: 'sc3', title: 'Scenario 3: FleetCo rents its equipment to its own customer', short: 'Scenario 3',
    lanes: ['custy', 'fcdesk', 'eq', 'fcem', 'fcyard', 'fcfus'],
    steps: [
      { key: 'ask', lane: 'custy', col: 0, label: ['Asks for', 'equipment'], what: 'By the portal or through FleetCo\'s rental desk.' },
      { key: 'quote', lane: 'fcdesk', col: 1, label: ['Quote and', 'agreement'], what: 'Requesting (contracting) BU FleetCo, customer rates, deposit, credit terms.' },
      { key: 'credit', lane: 'eq', col: 2, kind: 'decision', label: ['Credit OK,', 'deposit in?'], dp: 'R1', ints: ['INT-26'], what: 'Customer account and credit limit from Fusion AR; the deposit if the agreement asks.' },
      { key: 'alloc', lane: 'fcem', col: 3, label: ['Allocate', 'units'], what: 'From FleetCo\'s own fleet.' },
      { key: 'ship', lane: 'fcyard', col: 4, label: ['Pick, inspect,', 'deliver'], dp: 'F2', what: 'Delivery to Customer Y\'s site (cross-border: export and import papers).' },
      { key: 'to', lane: 'fcfus', col: 4, kind: 'system', label: ['Stock: TO to', 'customer-site org'], dp: 'F3', ints: TO, what: 'Stock only: FleetCo\'s own customer-site org; the customer never owns it.' },
      { key: 'onhire', lane: 'custy', col: 5, label: ['Receives:', 'on hire'], dp: 'F4', what: 'The hire starts.' },
      { key: 'charge', lane: 'eq', col: 6, label: ['Period end:', 'rental charges'], what: 'Rates from the customer agreement; meters or hours where the agreement bills by use.' },
      { key: 'inv', lane: 'fcfus', col: 7, kind: 'system', label: ['AR invoice', 'to Customer Y'], dp: 'R2', ints: ['INT-11'], what: 'Through Fusion Receivables, so country e-invoicing applies.' },
      { key: 'pays', lane: 'custy', col: 8, label: ['Pays'], dp: 'R3', what: 'Receipt in Fusion.' },
      { key: 'offhire', lane: 'custy', col: 9, label: ['Off-hire,', 'return'], what: 'The hire ends.' },
      { key: 'inspect', lane: 'fcyard', col: 10, kind: 'decision', label: ['Damaged?'], what: 'Return inspection with photos.' },
      { key: 'done', lane: 'fcfus', col: 11, kind: 'end', label: ['Damage billed,', 'deposit settled'], dp: 'R4 R5', what: 'Damage charged and repaired; the deposit offsets it, the rest is refunded.' }
    ],
    edges: [{ from: 'ask', to: 'quote' }, { from: 'quote', to: 'credit' }, { from: 'credit', to: 'alloc', label: 'yes' }, { from: 'credit', to: 'quote', label: 'no: hold', back: true },
      { from: 'alloc', to: 'ship' }, { from: 'ship', to: 'to', ints: TO, arrow: 'start' }, { from: 'ship', to: 'onhire' }, { from: 'onhire', to: 'charge' },
      { from: 'charge', to: 'inv', ints: ['INT-11'] }, { from: 'inv', to: 'pays' }, { from: 'pays', to: 'offhire' }, { from: 'offhire', to: 'inspect' },
      { from: 'inspect', to: 'done', label: 'yes or no' }] }, W),

  Object.assign({ id: 'icb', title: 'How FleetCo bills ProjectCo: the intercompany billing cycle', short: 'IC billing',
    lanes: ['eq', 'pcrev', 'fcfin', 'oic', 'fcfus', 'pcfus', 'group'],
    steps: [
      { key: 'run', lane: 'eq', col: 0, label: ['Charge run', '(period end)'], what: 'Every on-hire unit of every IC agreement: rental by the rate engine, standby, transport, operator, damage, credits.' },
      { key: 'stmt', lane: 'eq', col: 1, label: ['IC statement', 'per pair'], what: 'One statement per provider–receiver pair and period, with the evidence (on/off-hire, hours).' },
      { key: 'check', lane: 'fcfin', col: 2, label: ['Checks,', 'releases'], what: 'FleetCo releases its statement.' },
      { key: 'agree', lane: 'pcrev', col: 3, kind: 'decision', label: ['Agreed in', '3 days?'], what: 'ProjectCo accepts or disputes lines with a reason. Silence = accepted at the end of the window.' },
      { key: 'cut', lane: 'eq', col: 4, kind: 'decision', label: ['Before the', 'IC cut-off?'], what: 'Invoices must exist in both ledgers before the group\'s IC cut-off.' },
      { key: 'accf', lane: 'fcfus', col: 5, label: ['Accrue', 'revenue'], dp: 'F5', ints: ['INT-24'], what: 'Reverses on day 1; the invoice follows next period.' },
      { key: 'accp', lane: 'pcfus', col: 5, label: ['Accrue', 'cost'], dp: 'P1', ints: ['INT-24'], what: 'Same amount, same charge ids.' },
      { key: 'pair', lane: 'oic', col: 6, kind: 'system', label: ['Invoice pair,', 'one number'], ints: ['INT-10'], what: 'One call creates both invoices; retried safely by the statement id.' },
      { key: 'ar', lane: 'fcfus', col: 7, kind: 'system', label: ['AR invoice', '(FleetCo)'], dp: 'F6', what: 'Customer = ProjectCo\'s IC customer account.' },
      { key: 'ap', lane: 'pcfus', col: 7, kind: 'system', label: ['AP invoice,', 'project-coded'], dp: 'P2', what: 'Supplier = FleetCo\'s IC supplier; distributions carry project, task, expenditure type and org.' },
      { key: 'ppm', lane: 'pcfus', col: 8, kind: 'system', label: ['PPM: cost on', 'the project'], what: 'Supplier cost imported from AP.' },
      { key: 'refs', lane: 'eq', col: 8, label: ['Invoice numbers', 'on each charge'], what: 'Both invoice numbers come back to every charge line.' },
      { key: 'netf', lane: 'fcfin', col: 9, label: ['Netting or', 'receipt'], dp: 'F7', what: 'Monthly netting between group companies (OD-10).' },
      { key: 'netp', lane: 'pcrev', col: 9, label: ['Netting or', 'payment'], dp: 'P4', what: 'Cross-border: withholding tax and FX (XP4).' },
      { key: 'recon', lane: 'group', col: 10, kind: 'end', label: ['Reconciled,', 'eliminated'], dp: 'G1 G2', what: 'EquipRite charges = FleetCo AR = ProjectCo AP, line by line; then eliminated.' }
    ],
    edges: [{ from: 'run', to: 'stmt' }, { from: 'stmt', to: 'check' }, { from: 'check', to: 'agree' }, { from: 'agree', to: 'cut', label: 'yes' },
      { from: 'agree', to: 'run', label: 'no: credit or re-rate', back: true }, { from: 'cut', to: 'pair', label: 'yes' }, { from: 'cut', to: 'accf', label: 'no' },
      { from: 'cut', to: 'accp', label: 'no' }, { from: 'accp', to: 'pair', label: 'next period' }, { from: 'pair', to: 'ar', ints: ['INT-10'] }, { from: 'pair', to: 'ap', ints: ['INT-10'] },
      { from: 'ap', to: 'ppm' }, { from: 'ar', to: 'refs' }, { from: 'ar', to: 'netf' }, { from: 'ppm', to: 'netp' }, { from: 'netf', to: 'recon' }, { from: 'netp', to: 'recon' }] }, W)
];

module.exports = { LANES, FLOWS };
