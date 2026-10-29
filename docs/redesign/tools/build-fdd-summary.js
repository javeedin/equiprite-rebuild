'use strict';
/**
 * Builds the EquipRite FDD summary: docs/redesign/fdd-summary/EquipRite-FDD-Summary.html and
 * docs/redesign/EquipRite-FDD-Summary.pdf.
 *
 * Every fact here comes from EquipRite_FDD_v1.7.docx (RITE-FDD-EQUIPRITE-001); section numbers point back to it.
 * The content lives in this file as data so the flows, tables and the PDF stay in step. Rerun after editing:
 *   node docs/redesign/tools/build-fdd-summary.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML_OUT = path.join(ROOT, 'fdd-summary', 'EquipRite-FDD-Summary.html');
const PDF_OUT = path.join(ROOT, 'EquipRite-FDD-Summary.pdf');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Cells may carry a little inline markup (<b>, <br>, chips), so tables take trusted HTML strings.
const table = (head, rows, cls = '') =>
  `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const chip = (s, kind) => `<span class="chip ${kind || ''}">${s}</span>`;

// ---------------------------------------------------------------------------------------------------------------
// Flow diagrams. A flow is a list of steps; each step is [actor, text], or { q, yes, no } for a decision,
// or { end } for the outcome. Actors get a colour so a reader can follow who does what.
const ACTORS = {
  PM: 'Project Manager', EM: 'Equipment Manager', WH: 'Warehouse', SITE: 'Project site', FIN: 'Finance',
  TK: 'Timekeeper', AP: 'Time approver', CUST: 'Customer', SYS: 'EquipRite', FUS: 'Oracle Fusion', JOB: 'Scheduled job',
  ADM: 'System admin', USER: 'Any user',
};
function flow(steps) {
  const parts = steps.map((s) => {
    if (s.q) {
      return `<div class="node decision"><div class="q">${s.q}</div><div class="br"><span><b>Yes</b> ${s.yes}</span><span><b>No</b> ${s.no}</span></div></div>`;
    }
    if (s.end) {
      return `<div class="node end">${s.end}</div>`;
    }
    const [actor, text] = s;
    return `<div class="node"><span class="actor a-${actor}">${ACTORS[actor]}</span>${text}</div>`;
  });
  return `<div class="flow">${parts.join('<span class="arrow" aria-hidden="true">→</span>')}</div>`;
}

const STATUS = {
  DRAFT: ['#f3f4f6', '#4b5563'], IN_PROCESS: ['#fef3c7', '#92400e'], APPROVED: ['#e0e7ff', '#4338ca'],
  PICK_INITIATED: ['#e0f2fe', '#075985'], PICK_RELEASED: ['#e0f2fe', '#075985'], 'EQP INSPECTION COMPLETE': ['#ccfbf1', '#115e59'],
  SHIPPED: ['#ede9fe', '#5b21b6'], DEPLOYED: ['#d1fae5', '#065f46'], RETURNED: ['#f1f5f9', '#334155'],
  CLOSED: ['#dcfce7', '#166534'], REJECTED: ['#fee2e2', '#b91c1c'],
};
const st = (s) => `<span class="chip" style="background:${STATUS[s][0]};color:${STATUS[s][1]}">${s}</span>`;

// ---------------------------------------------------------------------------------------------------------------
// Scenarios: every path the FDD describes, grouped by phase.
const SCENARIOS = [
  { group: 'Request & approval (Phase 2)', items: [
    { id: 'S01', title: 'Project request, serial items allocated at approval (main path)', when: 'Projects module on. Equipment is serial or lot controlled.', refs: '5.2, 7.5, 7.8, 7.11',
      steps: [['PM', 'Builds a cart from the catalog or a template'], ['PM', 'Sets project, task and dates; submits'], ['SYS', 'Checks rate schedule, dates, project/task'], { q: 'Rate schedule found?', yes: 'status IN_PROCESS, NTF-01 to EM', no: 'blocked, stays DRAFT (DP-01)' }, ['EM', 'Opens it from the Workbench in Approve & Allocate'], ['EM', 'Auto Allocate or picks serials, with the schedule embedded'], ['SYS', 'Soft reserve (light blue)'], ['EM', 'Approves'], { end: 'APPROVED; appears on Initiate Picking' }],
      rules: ['Approve is enabled only when every serial/lot line is allocated (or deferred) and every non-serial line passes the quantity check (DEC-05).', 'Auto Allocate looks in the Available subinventory for serials not booked in the date range.', 'The schedule in Approve & Allocate is pre-filtered to the line\'s equipment (DEC-06).', 'Approve & Allocate is reached only from the Workbench; there is no separate tile.'] },
    { id: 'S02', title: 'Allocation deferred to the warehouse', when: 'The EM does not want to pick serials in advance.', refs: '5.2.1 step 2.3, 7.16.5',
      steps: [['EM', 'Approves without allocating serial lines'], ['SYS', 'Transfer Order created without serial numbers'], ['WH', 'Picks the actual serial on the Oracle mobile app'], { end: 'Serial known from the pick; flow continues as S01' }],
      rules: ['Allocation at approval is optional for serial/lot items.', 'Partial allocation is allowed: some lines pre-allocated, others left for picking.'] },
    { id: 'S03', title: 'Non-serial and bulk items (quantity check)', when: 'Consumables, scaffolding, small tools: quantity-tracked items.', refs: '5.2.2, 7.2.6',
      steps: [['PM', 'Adds quantity-based items to the cart'], ['EM', 'Opens the request'], ['SYS', 'Checks available quantity'], { q: 'Enough on hand?', yes: 'Approve enabled', no: 'flag unavailable; procurement (S06)' }, { end: 'APPROVED' }],
      rules: ['Auto Allocate does nothing for non-serial lines.', 'Mixed requests need both conditions (DEC-05).'] },
    { id: 'S04', title: 'Request linked to a rental agreement', when: 'AGREEMENTS_ENABLED = Yes (required on every request when RENTAL_AGREEMENT_MANDATORY = Yes).', refs: '7.3A.4, 7.3A.5, 7.3A.6',
      steps: [['PM', 'Selects an ACTIVE agreement in the request header'], ['PM', 'Add All from Agreement (default quantities, agreement rates)'], ['PM', 'Adjusts lines, adds non-agreement items from the catalog'], ['SYS', 'Validates class and project match the agreement scope'], { end: 'Submitted as S01; agreement rates win' }],
      rules: ['Alternative start: on the agreement lines page select lines, click Create Request, enter project, task, dates and location in the pop-up.', 'Rate precedence: agreement line rate, then schedule tagged to the agreement, customer + project + class, customer + class, project, class, default.', 'Items not on the agreement use standard schedule rates.'] },
    { id: 'S05', title: 'Request from a kit template', when: 'Recurring orders (Standard, Personal, Project-type or Industry templates).', refs: '7.5.4',
      steps: [['PM', 'Use Template, previews the kit'], ['PM', 'Add All to Cart, or ticks some lines'], ['PM', 'Can add a second template to the same cart'], ['SYS', 'Suggests templates that contain items added by hand'], { end: 'Cart fully editable, then submit as S01' }],
      rules: ['Template items append to the cart, never replace it.', 'Recently used: last 5 templates.', 'MAX_TEMPLATE_LINES (default 50); sharing a personal template org-wide may need EM approval (TEMPLATE_SHARE_REQUIRES_APPROVAL).'] },
    { id: 'S06', title: 'Equipment not available or not in the catalog: procurement requisition', when: 'Out of stock, or no such equipment.', refs: '7.5.6, 7.5.6A, TC-07',
      steps: [['PM', 'Request New Equipment: description, class, qty, needed-by date, justification'], ['SYS', 'Requisition SUBMITTED; NTF-21 to EM'], ['EM', 'Reviews it in the Workbench Procurement tab'], { q: 'EM decision', yes: 'Approve & Procure: Fusion purchase requisition, PROCUREMENT_IN_PROGRESS', no: 'Suggest Alternative (deep link) or Reject with reason' }, { end: 'Requester notified; tracked in My Requisitions' }],
      rules: ['If the item does not exist at all, the EM first creates it in the Equipment Master.'] },
    { id: 'S07', title: 'Rejection and resubmission', when: 'The EM rejects the request.', refs: '5.2.1 step 2.4, 5.6, 7.6.3',
      steps: [['EM', 'Rejects with mandatory comments'], ['SYS', 'REJECTED; NTF-03 to the requester'], ['PM', 'Edits the request (allowed in DRAFT and REJECTED only)'], { end: 'Resubmits: IN_PROCESS' }], rules: [] },
    { id: 'S08', title: 'Cancelling a request', when: 'Requester no longer needs the equipment.', refs: '7.6.3, 7.6.4',
      steps: [['PM', 'Cancel (DRAFT or IN_PROCESS only)'], ['USER', 'Confirms in the dialog'], { end: 'Cancelled; cannot be reinstated; hidden unless "Show cancelled"' }], rules: ['Bulk cancel is available from the list.'] },
    { id: 'S09', title: 'Two Equipment Managers approve the same request', when: 'Concurrent edit.', refs: 'DP-09, 13 (optimistic locking)',
      steps: [['EM', 'First EM approves or allocates'], ['EM', 'Second EM tries at the same time'], { end: '"Record locked by [user]": retry after the first finishes' }], rules: [] },
  ] },
  { group: 'Customers', items: [
    { id: 'S10', title: 'Internal customer rental (intercompany billing)', when: 'CUSTOMERS_MODULE_ENABLED = Yes; customer is another legal entity.', refs: '3.2, 7.11.2, 7.14A, INT-10',
      steps: [['PM', 'Creates the request with Customer instead of Project'], ['SYS', 'Request Source badge = Customer'], ['EM', 'Same Workbench and approve / pick flow'], ['FIN', 'Posts costs after the period'], { end: 'IC invoice (INT-10): Equipment Yard LE bills the customer LE' }],
      rules: ['Workbench shows project, customer or both lists depending on which modules are on; Request Source filter only when both are on.', 'Bulk approve / reject works across mixed project and customer requests.'] },
    { id: 'S11', title: 'External customer through the portal (AR invoice)', when: 'CUSTOMERS_MODULE + EXTERNAL_CUSTOMER + CUSTOMER_PORTAL flags all Yes.', refs: '7.18, 10.4, INT-11, INT-12',
      steps: [['CUST', 'Signs in to the portal (own login, not Fusion)'], ['CUST', 'Browses the catalog: names and classes, never serials'], ['CUST', 'Cart, dates, delivery location; agreement filled in'], ['SYS', 'IN_PROCESS; EM notified; source = Customer'], ['EM', 'Same approval and fulfilment flow'], ['FIN', 'Posts costs'], { end: 'AR invoice (INT-11); customer sees it in My Billing' }],
      rules: ['Portal login: 8+ character complex password, 90-day expiry, lock after 5 failures for 30 minutes, 30-minute idle timeout, JWT in an HTTP-only cookie.', 'Customers see only their own requests and invoices.', 'Portal can be switched off for maintenance (CUSTOMER_PORTAL_ENABLED) without affecting internal users.'] },
    { id: 'S12', title: 'Equipment Manager orders on behalf of a customer', when: 'Phone-in or walk-in orders.', refs: '7.18.5, 10.4.3',
      steps: [['EM', 'Opens the portal with Fusion sign-in'], ['EM', 'Picks the customer: "Acting on behalf of" banner'], ['EM', 'Builds and submits the request; can override rates, set priority, allocate'], { end: 'Logged as "Submitted by EM on behalf of customer"' }], rules: [] },
  ] },
  { group: 'Pick, ship & receive (Phase 3)', items: [
    { id: 'S13', title: 'Initiate Picking (manual)', when: 'Request is APPROVED and TRANSFER_ORDERS_ENABLED = Yes for the BU.', refs: '5.3, 7.16, INT-04/05/06',
      steps: [['EM', 'Selects approved requests (whole or by line)'], ['FUS', 'Transfer Order created (INT-04)'], ['FUS', 'Inventory hard-reserved (INT-05)'], ['FUS', 'Pick release (INT-06)'], ['WH', 'Picks on the Oracle mobile app'], { end: 'PICK_INITIATED, then PICK_RELEASED' }],
      rules: ['Partial (line-based) picking is supported.', 'If pick release fails after the TO exists, retry from the page or Oracle Shipping.'] },
    { id: 'S14', title: 'Allocated serial no longer available at picking', when: 'Serial consumed, damaged or reassigned outside EquipRite.', refs: 'DP-02, DEC-03, 5.3.2',
      steps: [['EM', 'Initiate Picking'], ['SYS', 'Reservation fails for one line: exception with serial and reason'], ['EM', 'Re-allocates that line manually'], { end: 'Retries; request stays APPROVED meanwhile' }],
      rules: ['No automatic substitution.', 'Partial success: TO covers all lines, only successful lines are pick-released.'] },
    { id: 'S15', title: 'Automatic picking job', when: 'Optional scheduled job.', refs: '5.3 step 3.2, DEC-08 (see also 7.16.6)',
      steps: [['JOB', 'Finds approved requests where start date − PICKING_LEAD_TIME_DAYS (default 3) ≤ today'], ['FUS', 'TO, reservation and pick release, as S13'], { q: 'All succeeded?', yes: 'done', no: 'failures logged and queued for the EM' }, { end: 'PICK_RELEASED' }], rules: [] },
    { id: 'S16', title: 'Inspection before shipping', when: 'Inspection matrix ticked for the class/subclass at "ship out of yard".', refs: '7.12, 7.17.3, DP-03, INT-13',
      steps: [['WH', 'Pick confirmed'], ['EM', 'Inspector opens the class checklist, attaches photos, logs defects'], { q: 'Result', yes: 'PASS: EQP INSPECTION COMPLETE, ship. CONDITIONAL: EM acknowledges first', no: 'FAIL: INSPECTION_FAILED' }, ['EM', 'On FAIL: substitute, create maintenance WO (INT-13) or cancel the line'], { end: 'Ship confirm' }],
      rules: ['Four inspection points per class/subclass: ship out of yard, receive at site, ship out of site, receive at yard.', 'No ticks for a class: PICK_RELEASED goes straight to SHIPPED.', 'Checklist questions: yes/no, pass/fail, numeric, text or rating; defects rated critical, major, minor or cosmetic.'] },
    { id: 'S17', title: 'Ship together or line by line', when: 'SHIP_ENTIRE_REQUEST_TOGETHER flag.', refs: 'DP-04, 7.16.1',
      steps: [{ q: 'Ship entire request together?', yes: 'all lines must be pick-confirmed before any ships', no: 'each line ships on its own' }, ['WH', 'Ship confirm in Oracle Shipping; Bill of Lading'], { end: 'SHIPPED; in transit' }], rules: [] },
    { id: 'S18', title: 'Receipt at the site, partial receipt and discrepancies', when: 'Equipment arrives at the project or customer site.', refs: '5.3 steps 3.6–3.7, DP-05, INT-07',
      steps: [['SITE', 'Receives each line (INT-07)'], ['SYS', 'Line becomes DEPLOYED; billing clock starts; NTF-05'], { q: 'Received qty = shipped qty?', yes: 'continue', no: 'line flagged; EM reships the shortage or adjusts the quantity' }, { end: 'Header DEPLOYED when all lines received' }], rules: ['Open item OI-01: does billing start at dispatch or at receipt?'] },
    { id: 'S19', title: 'Transfer orders switched off (tracking only)', when: 'TRANSFER_ORDERS_ENABLED = No for the business unit.', refs: '3.3, 7.17.2',
      steps: [['PM', 'Requests as usual'], ['EM', 'Approves'], { end: 'No TO, reservation, shipping or receiving integration: EquipRite tracks requests and usage only' }], rules: [] },
  ] },
  { group: 'Usage, costing & billing (Phase 4)', items: [
    { id: 'S20', title: 'Weekly time entry', when: 'Line is DEPLOYED.', refs: '7.13, 7.13.2',
      steps: [['TK', 'Picks the week; Add row or Copy last week (zero quantities)'], ['TK', 'Enters daily quantities by hours type'], ['SYS', 'Rate filled from schedule or agreement, read-only'], ['TK', 'Submits'], { end: 'SUBMITTED; NTF-06 to approver' }],
      rules: ['Only inside the line\'s start and end dates; 0–24 per day for hourly items.', 'Hours types: Usage, Standby, Idle (billed only if BILL_IDLE_TIME), Overtime (auto-split above the threshold, multiplier applied), Mobilization/Demobilization (flat fee).', 'Idle/Standby rows take a downtime reason (weather, crew unavailable, awaiting parts, maintenance, other).', 'Day-level notes are allowed.'] },
    { id: 'S21', title: 'Timesheet approval, adjustment and rejection', when: 'Timesheets SUBMITTED.', refs: '7.14, 7.14.3, 7.14.4',
      steps: [['AP', 'Reviews: rate variance yellow, >10 h amber, >16 h red, week-over-week'], { q: 'Correct?', yes: 'Approve (bulk allowed)', no: 'Adjust hours (audit kept, no resubmission) or Reject with comments' }, ['SYS', 'Rate engine calculates cost on approval'], { end: 'APPROVED; NTF-07. Rejected go back to DRAFT' }], rules: ['Bulk approve of 50 timesheets must finish within 10 seconds (TC-08).'] },
    { id: 'S22', title: 'Budget warning on approval', when: 'Cumulative cost would pass the budget threshold (default 90%).', refs: 'DP-06',
      steps: [['SYS', 'Warns submitter and approver'], ['AP', 'Acknowledges the budget impact'], { end: 'Approval allowed' }], rules: [] },
    { id: 'S23', title: 'Rate engine', when: 'Every approved timesheet.', refs: '7.3.6, 7.3.7',
      steps: [['SYS', 'Total duration: request dates (Complete Period) or approved hours (Utilized Duration)'], ['SYS', 'Finds the period whose threshold range holds the total'], ['SYS', 'Cost = bill rate × number of periods'], { end: 'Example: 80 h, Weekly from 40 h = 2 × weekly rate' }],
      rules: ['Six fixed periods: Hourly, Daily, Weekly, Monthly, Quarterly, Yearly; thresholds in hours or days (basis).', 'Above the last threshold the longest period applies.', 'Complete Period prorates partial periods at the next lower rate.'] },
    { id: 'S24', title: 'Posting costs and billing', when: 'Request period over and all timesheets approved.', refs: '7.14A, INT-08/09/10/11',
      steps: [['FIN', 'Opens Post Costs; previews the breakdown'], ['FIN', 'Posts (one or many)'], ['FUS', 'PPM expenditure items with the configured transaction source'], { q: 'Customer type', yes: 'internal: IC billing (INT-10)', no: 'external: AR invoice (INT-11)' }, { end: 'GL entries; not reversible in EquipRite' }], rules: ['Billing frequency WEEKLY, MONTHLY or ON_RETURN (default MONTHLY), overridable per agreement.', 'Cost source can be EquipRite rates or PPM rates (COST_SOURCE).'] },
    { id: 'S25', title: 'Direct cost and inventory consumption', when: 'Fuel, lubricants, consumables against an active request.', refs: '7.9.1A, 7.9.2A, INT-16, INT-17',
      steps: [['PM', 'Selects the request: project and task filled in'], ['PM', 'Direct cost (raw or defined) or inventory consumption lines'], ['FUS', 'Expenditure item (INT-17) or misc. issue (INT-16)'], { end: 'NTF-15 / NTF-14; failed postings can be retried' }], rules: ['Pages controlled by ENABLE_DIRECT_COST_POSTING and ENABLE_INVENTORY_CONSUMPTION.'] },
  ] },
  { group: 'Return, transfer & settlement (Phase 5)', items: [
    { id: 'S26', title: 'Return and final settlement', when: 'Work finished; line DEPLOYED.', refs: '5.5, 7.6.3, DEC-04',
      steps: [['PM', 'Initiate Return; NTF-08 to EM'], ['FUS', 'Return TO: site → yard; ship from site'], ['WH', 'Receive at yard; post-return inspection'], { q: 'Damage?', yes: 'Maintenance subinventory, WO, damage charges', no: 'Available subinventory' }, ['FIN', 'Billing stopped, usage reconciled, final charges posted'], { end: 'RETURNED, then CLOSED' }], rules: ['Open item OI-04: do damage charges need their own approval?'] },
    { id: 'S27', title: 'Overdue return', when: 'End date passed with no return started.', refs: 'DP-07, NTF-16',
      steps: [['SYS', 'NTF-16 to PM and EM; billing continues'], ['SYS', 'After OVERDUE_RETURN_GRACE_DAYS (default 7)'], { end: 'Escalates to the PM\'s manager and Finance' }], rules: [] },
    { id: 'S28', title: 'Inter-project transfer', when: 'ENABLE_INTER_PROJECT_TRANSFER = Yes; move equipment site to site.', refs: '7.16A, INT-18, NTF-12',
      steps: [['EM', 'Source request (DEPLOYED) and destination request (APPROVED)'], ['SYS', 'Checks class/name match, dates in both periods, open timesheets'], ['FUS', 'Inter-org transfer (INT-18)'], { end: 'Source line reduced or RETURNED; destination DEPLOYED; schedule and location updated; NTF-12' }], rules: ['Equipment Managers only; no extra approval.', 'Serial/lot items transfer one to one.'] },
    { id: 'S29', title: 'Agreement expires while equipment is out', when: 'Agreement end date passes during deployment.', refs: 'DP-08, NTF-09, RPT-16',
      steps: [['SYS', 'Earlier: "Agreement expiring" notice to Finance and PM'], ['SYS', 'On expiry: EM notified; line flagged "Agreement Expired"'], { end: 'Billing continues at standard schedule rates' }], rules: ['Open item OI-12: auto-renew or manual renewal?'] },
  ] },
  { group: 'Equipment master & schedule', items: [
    { id: 'S30', title: 'Syncing equipment from Fusion', when: 'New or changed items, assets, work orders.', refs: '7.2.6, 7.2.6A, INT-01, INT-15',
      steps: [{ q: 'How much?', yes: 'Cloud Import: full sync', no: 'Sync Selected (list) or Refresh from Fusion (detail)' }, ['FUS', 'Inventory, Fixed Assets and Maintenance read'], { end: 'Last Synced updated; failures shown inline with Retry, others kept' }], rules: ['Never-synced records show "Never Synced" in amber.', 'Maintenance work orders also sync every 15 minutes (MAINTENANCE_SYNC_INTERVAL_MINUTES).'] },
    { id: 'S31', title: 'Expired certificate or maintenance window', when: 'Requesting or allocating such equipment.', refs: '7.2.5A, 7.2.5B, 7.2.6',
      steps: [{ q: 'Certificate expired (RED)?', yes: 'confirmation; EM override needs a justification', no: 'continue' }, { q: 'Open maintenance work order overlaps the dates?', yes: 'cannot allocate without EM override', no: 'allocate' }, { end: 'Amber warning starts CERTIFICATION_EXPIRY_WARNING_DAYS (default 30) before expiry' }], rules: [] },
    { id: 'S32', title: 'Schedule conflict', when: 'Two bookings overlap for a serial item.', refs: '7.10.2, NTF-17, RPT-04',
      steps: [['SYS', 'Both bars get a red border and conflict icon; NTF-17 to EM'], ['EM', 'Opens the conflict panel'], { end: 'Reassign one request to a substitute, or change dates' }], rules: ['Bars: light blue soft reserve #90CAF9, dark blue hard reserve #1565C0, grey returned, orange hatched maintenance.'] },
    { id: 'S33', title: 'Watching equipment', when: 'ENABLE_EQUIPMENT_WATCH = Yes.', refs: '11.1, INT-19',
      steps: [['USER', 'Clicks Watch on an equipment record'], ['SYS', 'Status, location, certificate, maintenance and allocation events'], { end: 'Bell and email; manage in My Subscriptions' }], rules: ['Up to 50 items per user (MAX_EQUIPMENT_WATCH_COUNT).', 'EMs get all events for their inventory orgs without subscribing.'] },
  ] },
  { group: 'Integrations & errors', items: [
    { id: 'S34', title: 'A Fusion or OIC call fails', when: 'Any outbound integration.', refs: 'DP-10, 9.1–9.4',
      steps: [['SYS', 'Logged in EQR_ERROR_LOG with request and response'], ['SYS', 'Automatic retries for transient errors'], { q: 'Retries succeeded?', yes: 'resolved', no: 'Dead Letter Queue; NTF-10 to admin' }, ['ADM', 'Fixes and reprocesses from the exception dashboard'], { end: 'Daily reconciliation catches anything missed' }], rules: ['Retry: HTTP 5xx 3 times with exponential backoff; 429 per Retry-After; timeout 3 × 5 s; 409 lock 3 × 2 s.', 'Alerts: circuit breaker open, >10 errors of one code per hour, DLQ >10, exception pending >48 h, reconciliation mismatch, job failure, API >5 s.'] },
  ] },
  { group: 'New app: old and new versions', items: [
    { id: 'S35', title: 'Choosing Old or New EquipRite at sign-in (redesign)', when: 'Desktop app sign-in window.', refs: 'Redesign, not in the FDD',
      steps: [['USER', 'Signs in with the Fusion username and password'], { q: 'Which version?', yes: 'New EquipRite (redesign)', no: 'Old EquipRite (unchanged)' }, { end: 'Same backends and data; change it by signing out' }], rules: ['Both versions read and write the same data: an approval in one shows in the other.', 'In VBCS the two versions are two web apps in the same project, each with its own address.'] },
  ] },
];

// ---------------------------------------------------------------------------------------------------------------
const INTEGRATIONS = [
  ['INT-01', 'Equipment Master Sync', 'Inventory + Fixed Assets', 'REST', 'In', 'On demand', 'Items, assets, serial/lot, on-hand into the master'],
  ['INT-02', 'Project / Task LOV', 'PPM', 'REST', 'In', 'Real time', 'Active projects and tasks for requests'],
  ['INT-03', 'Serial / Lot Availability', 'Inventory', 'REST', 'In', 'On allocation', 'Available serials and lots, existing reservations'],
  ['INT-04', 'Transfer Order Create', 'Order Management', 'OIC', 'Out', 'Initiate Picking', 'Inter-org TO, yard → site'],
  ['INT-05', 'Inventory Reservation', 'Inventory', 'REST', 'Out', 'Initiate Picking', 'Hard reserve TO lines'],
  ['INT-06', 'Pick Release', 'Shipping', 'REST', 'Out', 'Initiate Picking', 'Release the TO for picking'],
  ['INT-07', 'Inventory Receipt', 'Inventory', 'REST', 'Out', 'On receive', 'Receipt at the project site org'],
  ['INT-08', 'Expense Transaction', 'PPM Costing', 'REST', 'Out', 'On submit', 'Equipment expense items to project cost'],
  ['INT-09', 'Inventory Transaction', 'PPM Costing', 'REST', 'Out', 'On submit', 'Inventory issue transactions to project'],
  ['INT-10', 'IC Billing', 'Cost Management', 'OIC scheduled', 'Out', 'Periodic', 'Intercompany invoices for internal customers'],
  ['INT-11', 'AR Invoice', 'Receivables', 'REST / OIC', 'Out', 'Periodic', 'Invoices for external customers (agreements + external flags)'],
  ['INT-12', 'Customer LOV', 'AR Customers', 'REST', 'In', 'Real time', 'External customer lookup'],
  ['INT-13', 'Maintenance WO', 'Maintenance Cloud', 'REST', 'Out', 'On inspection', 'Work orders from failed inspections'],
  ['INT-14', 'Analytics Extract', 'OTBI / BIP', 'Extract', 'Out', 'Scheduled', 'Utilization and cost KPIs'],
  ['INT-15', 'Maintenance Work Orders', 'Maintenance', 'REST', 'In', 'On demand + every 15 min', 'Maintenance light and schedule blocks'],
  ['INT-16', 'Project Misc. Issue', 'Inventory', 'REST', 'Out', 'On submit', 'Inventory consumption page'],
  ['INT-17', 'Direct Cost Posting', 'PPM', 'REST (Transaction Import)', 'Out', 'On submit', 'Raw or defined cost expenditure items'],
  ['INT-18', 'Inter-Org Transfer', 'Inventory', 'REST', 'Out', 'On submit', 'Site-to-site transfers'],
  ['INT-19', 'Fusion Notifications', 'BPM notifications', 'REST', 'Out', 'Event', 'Equipment Watch bell and email'],
  ['INT-20', 'User Inventory Org Security', 'Fusion Security', 'REST', 'In', 'On login (cached)', 'Orgs for the Region filter'],
];

const REPORTS = [
  ['RPT-01', 'Equipment Fleet', 'VBCS dashboard', 'All roles'], ['RPT-02', 'Request and Approval', 'VBCS dashboard', 'EM, Ops Lead, PM'],
  ['RPT-03', 'Equipment Utilization', 'VBCS + OTBI', 'EM, Finance, Ops Lead'], ['RPT-04', 'Schedule Conflict', 'VBCS dashboard', 'EM'],
  ['RPT-05', 'Cost Analysis', 'VBCS dashboard', 'Finance, PM, EM'], ['RPT-06', 'Cost vs. Budget', 'OTBI', 'PM, Finance'],
  ['RPT-07', 'Rate Schedule', 'BIP (monthly email)', 'Finance'], ['RPT-08', 'Timesheet Summary', 'VBCS + BIP (weekly email)', 'PM, Finance'],
  ['RPT-09', 'Intercompany Billing Summary', 'OTBI', 'Finance'], ['RPT-10', 'Maintenance History', 'BIP', 'EM'],
  ['RPT-11', 'AR Invoice', 'BIP (monthly)', 'Finance, external customers'], ['RPT-12', 'Return and Settlement', 'VBCS + BIP', 'PM, EM, Finance'],
  ['RPT-13', 'Certification Compliance', 'BIP (monthly email)', 'EM, Safety'], ['RPT-14', 'Transfer History', 'VBCS', 'EM, Ops Lead'],
  ['RPT-15', 'Overdue Equipment', 'VBCS (daily)', 'EM, PM, Finance'], ['RPT-16', 'Agreement Expiry', 'VBCS (weekly)', 'Finance, EM'],
  ['RPT-17', 'Integration Error and DLQ', 'VBCS (Integration health)', 'System admin'], ['RPT-18', 'Timesheet Detail', 'BIP', 'PM, Finance, auditors'],
  ['RPT-19', 'Equipment Downtime Analysis', 'VBCS dashboard', 'EM, Ops Lead, PM'], ['RPT-20', 'Utilization vs. Revenue', 'VBCS dashboard', 'EM, Finance, Executive'],
];

const NOTIFICATIONS = [
  ['NTF-01', 'Request submitted', 'Equipment Manager', 'Email + in-app'], ['NTF-02', 'Request approved', 'Project Manager', 'Email + in-app'],
  ['NTF-03', 'Request rejected (with reason)', 'Project Manager', 'Email + in-app'], ['NTF-04', 'Inspection complete', 'Equipment Manager', 'In-app'],
  ['NTF-05', 'Received at site, billing started', 'Project Manager', 'Email + in-app'], ['NTF-06', 'Timesheets submitted', 'Approver', 'Email + in-app'],
  ['NTF-07', 'Timesheets approved', 'Project Manager', 'In-app'], ['NTF-08 *', 'Return initiated / certificate expiring (30 and 7 days)', 'EM / EM + watchers', 'Email + in-app'],
  ['NTF-09 *', 'Agreement expiring / certificate expired', 'Finance + PM / EM + watchers', 'Email'], ['NTF-10 *', 'Integration failure / maintenance WO created', 'Admin / watchers', 'Email'],
  ['NTF-11', 'Maintenance WO completed', 'Watchers', 'Bell + email'], ['NTF-12', 'Inter-project transfer completed', 'Both PMs + EM', 'Bell + email'],
  ['NTF-13', 'Watched equipment status change', 'Watchers', 'Bell + email'], ['NTF-14', 'Inventory consumption posted', 'Project Manager', 'Bell + email'],
  ['NTF-15', 'Direct cost posted', 'PM + Finance', 'Bell + email'], ['NTF-16', 'Overdue return', 'PM + EM', 'Bell + email'],
  ['NTF-17', 'Schedule conflict detected', 'Equipment Manager', 'Bell + email'], ['NTF-21 *', 'Procurement requisition submitted', 'Equipment Manager', 'Not specified'],
];

const PAGES = [
  ['7.1', 'APPS launcher dashboard', 'All', 'Role-based tiles with live counts; KPI bar (active requests, deployed, pending approvals, overdue returns, utilization %); global Region / Inventory Org filter in the header'],
  ['7.2', 'Equipment master', 'EM full; others view', 'Smart search, cascading filters, grid and map view, certifications (green/amber/red), maintenance light, attributes, long description, saved searches, full and selective sync, substitutes and bundles, TCO'],
  ['7.3', 'Rate management', 'Finance full', 'Six rate periods with thresholds, spreadsheet-style grid, inline edit, negative-margin highlight, tags (customer, class, agreement, project, task, location), basis and method'],
  ['7.3A', 'Rental agreements', 'Finance, EM', 'Internal or external customer, optional project/class scope, ACTIVE/DRAFT/EXPIRED/CANCELLED, 1,000+ lines on their own page, rate overrides by rate type, Create Request from lines'],
  ['7.4', 'Equipment dashboard', 'PM, Ops Lead', 'Project-level KPI cards with drill-down'],
  ['7.5', 'Equipment request cart', 'PM full', 'Catalog cards with availability, class/subclass menu, templates, frequently ordered together, cart review with line overrides, estimated cost, procurement requisition'],
  ['7.6', 'Equipment request list', 'Own / all', 'Filters, soft/hard reserve colours, Edit, View, Cancel, Initiate Return, export, bulk cancel, My Requisitions'],
  ['7.8', 'Approve & allocate', 'EM only', 'Header, lines, Auto Allocate, manual serial pick, embedded schedule, approve / reject'],
  ['7.9', 'Project transactions', 'PM, Finance', 'Direct cost posting (7.9.1A) and project inventory consumption (7.9.2A)'],
  ['7.10', 'Equipment schedule', 'EM, Ops Lead full', 'Gantt (day/week/month), reserve colours, maintenance blocks, certificate warnings, conflict detection, map view'],
  ['7.11', 'Request workbench', 'EM, Ops Lead', 'Project and customer requests in one list, source filter, bulk approve/reject, procurement tab'],
  ['7.12', 'Inspection & ship-out', 'EM', 'Check in/out, class checklists, photos, defects, PASS / CONDITIONAL / FAIL, work order'],
  ['7.13', 'Time entry', 'PM / Timekeeper', 'Weekly grid, hours types, copy week, notes, downtime reasons, submit'],
  ['7.14', 'Timesheet approval', 'PM own, Finance all', 'Bulk approve/reject, adjust with audit, variance colours, budget panel'],
  ['7.14A', 'Post costs', 'Finance', 'Cost preview by line, bulk post to PPM, IC or AR billing'],
  ['7.15', 'Analytics', 'By role', '20 reports, shared filters, bookmarks, export, scheduled email'],
  ['7.16', 'Initiate picking', 'EM', 'Approved requests, line-based picking, TO + reserve + pick release in one action, exceptions'],
  ['7.16A', 'Inter-project transfer', 'EM', 'Source and destination requests, transfer lines, history'],
  ['7.17', 'Configuration settings', 'EM, Admin; Finance partial', 'Tabs Administration / Warehouse / Project Site; flags, inspection matrix, BU and org mapping, transaction sources, classes, rate types, role mapping'],
  ['7.18', 'External customer portal', 'Customers; EM on behalf', 'Login, dashboard, catalog, cart, my requests, my billing'],
];

const TILES = [
  ['Project Manager', 'My Equipment Requests, Equipment Catalog, Equipment Schedule, Time Entry, Request Status (pie), Project Equipment Dashboard'],
  ['Equipment Manager', 'Request Workbench, Initiate Picking, Equipment Master, Equipment Schedule, Inspection, Analytics, Inter-Project Transfer (if on), Configuration Settings'],
  ['Warehouse Operator', 'Initiate Picking, Inspection, Equipment Master (read only)'],
  ['Finance / Billing', 'Timesheet Approval, Post Costs, Rate Management, Rental Agreements (if on), Analytics'],
  ['System Administrator', 'Configuration Settings (all tabs), Equipment Master, Analytics, link to Fusion user management'],
];

const ACCESS = [
  ['Dashboard', 'View own', 'View all', 'View all', 'Assigned', '—'], ['Equipment Master', 'View', 'Full', 'View', 'View', '—'],
  ['Rate Management', 'View', 'View', 'Full', 'View', '—'], ['Request Cart', 'Full', 'View', 'View', 'View', '—'],
  ['Request List', 'Edit own', 'View all', 'View all', 'Edit assigned', '—'], ['Approve & Allocate', '—', 'Full', '—', '—', '—'],
  ['Workbench', '—', 'Full', 'View', 'Full', '—'], ['Initiate Picking', '—', 'Full', '—', '—', '—'], ['Inspection & Ship-out', '—', 'Full', '—', '—', '—'],
  ['Time Entry', 'Full', 'View', 'View', 'View', '—'], ['Timesheet Approval', 'Approve own', 'View', 'Approve all', '—', '—'],
  ['Schedule', 'View', 'Full', 'View', 'Full', '—'], ['Analytics', 'Own', 'All', 'All', 'Assigned', '—'], ['Settings', '—', 'Full', 'Partial', '—', '—'],
  ['Customer Portal', '—', 'On behalf', '—', '—', 'Own data'],
];

const FLAGS = [
  ['Modules', 'PROJECTS_MODULE_ENABLED (Yes), CUSTOMERS_MODULE_ENABLED (No), AGREEMENTS_ENABLED (No), EXTERNAL_CUSTOMER_ENABLED (No), CUSTOMER_PORTAL_ENABLED (No), RENTAL_AGREEMENT_MANDATORY (No)'],
  ['Fulfilment', 'TRANSFER_ORDERS_ENABLED per BU (No), SHIP_ENTIRE_REQUEST_TOGETHER (No), PICKING_LEAD_TIME_DAYS (3), SHIPPING_DOCUMENTS_ENABLED (Yes), OTM_INTEGRATION_ENABLED (No), inspection matrix per class/subclass × 4 points'],
  ['Costing & billing', 'COST_SOURCE (EquipRite rates), DEFAULT_BILLING_FREQUENCY (Monthly), WEEK_END_DAY (Friday), EXPENDITURE_BATCH_PREFIX, AD_HOC_TIMESHEETS_ENABLED (No), BILL_IDLE_TIME, ENABLE_DIRECT_COST_POSTING (Yes), ENABLE_INVENTORY_CONSUMPTION (Yes), transaction source and sequence prefix'],
  ['Approval', 'ADDITIONAL_PROJECT_APPROVAL_ENABLED (No), approval thresholds by class and value (OI-02)'],
  ['Equipment', 'MAP_LOCATION_CAPTURE_ENABLED (No), ENABLE_EQUIPMENT_WATCH (Yes), MAX_EQUIPMENT_WATCH_COUNT (50), MAINTENANCE_SYNC_INTERVAL_MINUTES (15), CERTIFICATION_EXPIRY_WARNING_DAYS (30), SOFT_RESERVE_COLOR (#90CAF9), HARD_RESERVE_COLOR (#1565C0)'],
  ['Requests & templates', 'ENABLE_INTER_PROJECT_TRANSFER (Yes), MAX_TEMPLATE_LINES (50), ENABLE_INDUSTRY_TEMPLATES (Yes), TEMPLATE_SHARE_REQUIRES_APPROVAL (Yes), OVERDUE_RETURN_GRACE_DAYS (7), budget warning threshold (90%)'],
  ['Region filter', 'DEFAULT_REGION_FILTER_BEHAVIOR (SINGLE)'],
  ['Master lists', 'Equipment classes and subclasses, rate types (Usage, Mobilization, Return, Standby + custom), role mapping to Fusion role codes, BU → yard / site / customer-site org mapping, project-site sub-inventories and locators'],
];

const OBJECTS = [
  ['EQR_EQUIPMENT_MASTER', 'Equipment with links to Fusion item, asset, maintenance asset'], ['EQR_EQUIPMENT_CLASS', 'Classes, subclasses and their inspection points'],
  ['EQR_EQUIPMENT_CERTIFICATION', 'Certificates per equipment'], ['EQR_EQUIPMENT_WATCH / EQR_NOTIFICATION_SUBSCRIPTION', 'Watches and notification preferences'],
  ['EQR_RATE_SCHEDULE / EQR_RATE_PERIOD_LINE', 'Rate headers and period lines with thresholds'], ['EQR_AGREEMENT_HEADER / EQR_AGREEMENT_LINE', 'Rental agreements and lines'],
  ['EQR_EQUIPMENT_REQUEST / EQR_REQUEST_LINE', 'Requests and lines with allocation'], ['EQR_REQUEST_TEMPLATE / EQR_TEMPLATE_LINE / EQR_TEMPLATE_VERSION', 'Kit templates and history'],
  ['EQR_PROCUREMENT_REQUISITION', 'New-equipment requests'], ['EQR_TIME_ENTRY', 'Weekly timesheets'],
  ['EQR_INSPECTION / _CHECKLIST / _RESPONSE / _DEFECT', 'Inspections, questions, answers, defects'], ['EQR_TRANSFER_HISTORY', 'Inter-project transfers'],
  ['EQR_INVENTORY_CONSUMPTION / EQR_DIRECT_COST_TXN', 'Project consumption and direct costs'], ['EQR_SAVED_SEARCH', 'Saved filters'],
  ['EQR_CUSTOMER_PORTAL_USER', 'Portal logins'], ['EQR_CONFIG_SETTINGS / EQR_BU_ORG_MAPPING', 'Settings and org mapping'],
  ['EQR_ERROR_LOG / EQR_DEAD_LETTER_QUEUE / EQR_JOB_RUN_LOG', 'Errors, failed transactions, job runs'],
];

const OLD_NEW = [
  ['Right-edge drawer menu, groups named after personas, no header bar', 'Header (region filter, search, cart, alerts) + side menu by lifecycle phase', 'New'],
  ['Persona dashboards', 'Home: Equipment Manager, Home: Project Manager (clickable work queues)', 'Kept'],
  ['project-create-request, customer-create-req, request-catalog', 'One New request cart (catalog → project or customer → review)', '3 → 1'],
  ['equipment-requests, customer-my-requests', 'My requests with a source badge', '2 → 1'],
  ['equipment-request-detail, customer-request-detail, request-detail', 'Request detail with status tracker', '3 → 1'],
  ['project-quote, customer-quote, request-quote', 'Quote tab on Request detail', '3 → 1'],
  ['Workbench (Outbound / Deployed / Inbound)', 'Workbench with To approve, To pick, Procurement added', 'Kept'],
  ['Line detail with Bryntum scheduler and Mapbox', 'Approve & allocate, Schedule', 'Kept'],
  ['Pick slip; returns scanner and Direct Return', 'Initiate picking; Receipt & returns', 'Kept'],
  ['post-cost-test, post-cost-test-detail, post-cost, post-cost-detail', 'Post costs (re-tier, split, misc charges, blackout weeks kept)', '4 → 1'],
  ['equipment-timesheets (no access check)', 'Time entry, Timesheet approval', 'Guarded'],
  ['equipment-record-cost (mock data)', 'Direct cost & inventory use (real posting)', 'Finished'],
  ['Equipment list (Map View inactive), equipment-create (Save inactive), equipment-detail (unreachable)', 'Equipment, Equipment detail', 'Finished'],
  ['customer-rental-contract (unreachable), rental-agreement-create (no access check)', 'Rental agreements', 'Finished'],
  ['configurations (2,578 lines, 81 action chains)', 'Settings in ten searchable sections', 'Split'],
  ['rbac-admin (Page Access)', 'Settings › Roles & page access', 'Kept'],
  ['equipment-analytics, equipment-reports (no access check)', 'Analytics report library by role', 'Guarded'],
  ['Not in today\'s app', 'Integration health, Transfer, Inspection, Customer portal', 'New'],
];

const ISSUES = [
  'Roles differ between sections: 2.1 names five personas (Requester, Project Manager, Equipment Manager, Timekeeper, Time Approver); 10.1 defines four roles (Project Manager, Equipment Manager, Finance/AR, Operations Lead); 7.1.2 adds Warehouse Operator and System Administrator; 10.3 adds External Customer.',
  'Notification IDs NTF-08, NTF-09 and NTF-10 are used twice (section 11 table and 11.2). NTF-21 (procurement, 7.5.6A) is not in section 11. BR-014 says 17 event types.',
  'Reports are numbered differently in section 12 (RPT-01 to RPT-07) and section 7.15 (RPT-01 to RPT-20). The 7.15 introduction says 15 reports; it defines 20.',
  'Retry timing differs: DP-10 says 3 retries at 30 s, 2 min, 10 min; 9.3.1 says 1 s, 3 s, 9 s for HTTP 5xx.',
  'Automatic picking: 5.3 step 3.2 and DEC-08 describe an EquipRite scheduled job; 7.16.6 says auto picking is handled by Oracle Fusion standard functionality.',
  'Error log integration_id and the health dashboard cards cover INT-01 to INT-10, but there are 20 integrations.',
  'Timesheets store Monday–Friday quantities (mon_qty–fri_qty), while WEEK_END_DAY allows Saturday or Sunday week endings.',
  'NTF-02 says the Transfer Order is created on approval; since v1.2 it is created at Initiate Picking.',
  'The request list status filter (7.6.1) omits PICK_INITIATED, PICK_RELEASED, SHIPPED and CLOSED, and includes CANCELLED, which is not in the status lifecycle (5.6).',
  'Performance targets differ: BR-014 says page load ≤ 2 s; section 13 says < 3 s at the 95th percentile.',
  'Document control still shows Version 1.3 while the revision history runs to 1.7.',
];

// ---------------------------------------------------------------------------------------------------------------
function scenariosHtml() {
  return SCENARIOS.map((g) => `<h3 class="group">${g.group}</h3>` + g.items.map((s) => `
    <section class="scenario">
      <div class="sc-head"><span class="sc-id">${s.id}</span><h4>${s.title}</h4></div>
      <p class="when"><b>When:</b> ${s.when} <span class="refs">FDD ${s.refs}</span></p>
      ${flow(s.steps)}
      ${s.rules.length ? list(s.rules) : ''}
    </section>`).join('')).join('');
}

function render() {
  const lifecycle = ['DRAFT', 'IN_PROCESS', 'APPROVED', 'PICK_INITIATED', 'PICK_RELEASED', 'EQP INSPECTION COMPLETE', 'SHIPPED', 'DEPLOYED', 'RETURNED', 'CLOSED'];
  const toc = [
    ['1', 'EquipRite at a glance'], ['2', 'Business requirements'], ['3', 'Roles, tiles and access'], ['4', 'Menus and pages'],
    ['5', 'End-to-end process'], ['6', 'Status lifecycles'], ['7', 'Scenarios and flows (S01–S35)'], ['8', 'Integrations'],
    ['9', 'Errors, retries and monitoring'], ['10', 'Notifications'], ['11', 'Reports'], ['12', 'Configuration settings'],
    ['13', 'Data model'], ['14', 'Quality, migration and testing'], ['15', 'Decisions and open items'], ['16', 'Old app and new app'],
    ['17', 'Inconsistencies to resolve in the FDD'],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EquipRite FDD summary</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root { --ink:#111827; --muted:#475569; --line:#e5e7eb; --band:#2e5468; --bg:#ffffff; --soft:#f8fafc; }
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:'Source Sans 3', system-ui, 'Segoe UI', sans-serif; font-size:10.5pt; line-height:1.45; font-variant-numeric: tabular-nums; }
  main { max-width: 190mm; margin: 0 auto; }
  h1 { font-size: 30pt; line-height:1.1; margin: 0 0 8px; }
  h2 { font-size: 17pt; margin: 0 0 10px; padding-top: 4px; border-top: 3px solid var(--band); }
  h2 .n { color: var(--band); margin-right: 8px; }
  h3 { font-size: 12.5pt; margin: 16px 0 6px; }
  h3.group { color: var(--band); border-bottom: 1px solid var(--line); padding-bottom: 3px; margin-top: 20px; }
  h4 { font-size: 11pt; margin: 0; }
  p { margin: 0 0 8px; }
  ul { margin: 4px 0 8px; padding-left: 18px; } li { margin: 2px 0; }
  .chapter { break-before: page; }
  .cover { min-height: 250mm; display:flex; flex-direction:column; justify-content:space-between; }
  .cover .band { background: var(--band); color: #fff; padding: 28px 26px 22px; border-radius: 6px 6px 0 0; }
  .cover .band p { color: #e2edf2; font-size: 12pt; margin: 0; }
  .strip { display:flex; height:7px; } .strip i { flex:1; } .strip i:nth-child(1){background:#c74634}.strip i:nth-child(2){background:#e5a22f}.strip i:nth-child(3){background:#6f9a3a}.strip i:nth-child(4){background:#2b8cbe}.strip i:nth-child(5){background:#6b4fa3}
  .kicker { font-size: 9pt; letter-spacing: .08em; text-transform: uppercase; color: #cfe0e8; font-weight: 700; margin-bottom: 10px; display:block; }
  .meta { display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0; }
  .meta div { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
  .meta b { display:block; font-size: 18pt; }
  .meta span { color: var(--muted); font-size: 9.5pt; }
  .toc { columns: 2; column-gap: 24px; margin: 0; padding: 0; list-style: none; }
  .toc li { padding: 4px 0; border-bottom: 1px dotted #cbd5e1; break-inside: avoid; }
  .toc b { color: var(--band); display:inline-block; width: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 9.5pt; }
  th, td { text-align: left; vertical-align: top; padding: 5px 7px; border-bottom: 1px solid var(--line); }
  th { background: #f1f5f9; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  tr { break-inside: avoid; }
  td:first-child { font-weight: 600; white-space: nowrap; }
  table.wrap td:first-child { white-space: normal; }
  .chip { display:inline-block; padding: 0 7px; border-radius: 999px; font-size: 8.5pt; font-weight: 700; background:#f1f5f9; color:#334155; white-space: nowrap; }
  .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 10px; color: #78350f; margin: 8px 0 12px; }
  .cols { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; background: var(--soft); break-inside: avoid; }
  .card h4 { margin-bottom: 4px; }
  .lifecycle { display:flex; flex-wrap: wrap; align-items:center; gap: 4px; margin: 8px 0 12px; }
  .lifecycle .arrow { color: #94a3b8; }
  .scenario { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 10px 0; break-inside: avoid; }
  .sc-head { display:flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .sc-id { background: var(--band); color:#fff; font-weight:700; font-size: 9pt; border-radius: 4px; padding: 1px 6px; }
  .when { color: #334155; font-size: 9.5pt; }
  .refs { color: var(--muted); font-size: 8.5pt; margin-left: 6px; white-space: nowrap; }
  .flow { display:flex; flex-wrap: wrap; align-items: stretch; gap: 4px 2px; margin: 6px 0; }
  .flow .arrow { align-self: center; color: #64748b; font-weight: 700; padding: 0 2px; }
  .node { flex: 0 1 auto; max-width: 44mm; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; padding: 5px 7px; font-size: 9pt; display:flex; flex-direction: column; gap: 3px; }
  .node.decision { border: 1.5px solid #d97706; background: #fffbeb; max-width: 58mm; }
  .node.decision .q { font-weight: 700; color: #78350f; }
  .node.decision .br { display:flex; flex-direction: column; gap: 2px; }
  .node.decision .br b { display:inline-block; min-width: 22px; color: #78350f; }
  .node.end { background: #ecfdf5; border-color: #6ee7b7; font-weight: 600; color: #065f46; }
  .actor { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; border-radius: 3px; padding: 0 4px; align-self: flex-start; }
  .a-PM { background:#ede9fe; color:#5b21b6 } .a-EM { background:#dbeafe; color:#1e40af } .a-WH { background:#ccfbf1; color:#115e59 }
  .a-SITE { background:#d1fae5; color:#065f46 } .a-FIN { background:#dcfce7; color:#166534 } .a-TK { background:#fae8ff; color:#86198f }
  .a-AP { background:#fce7f3; color:#9d174d } .a-CUST { background:#ffedd5; color:#9a3412 } .a-SYS { background:#e2e8f0; color:#1f2937 }
  .a-FUS { background:#fee2e2; color:#991b1b } .a-JOB { background:#f1f5f9; color:#334155 } .a-ADM { background:#e0e7ff; color:#3730a3 } .a-USER { background:#f1f5f9; color:#334155 }
  .legend { display:flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 10px; }
  @media screen { body { background: #e2e8f0; } main { background: #fff; padding: 24px 28px; margin: 16px auto; border-radius: 8px; } }
</style></head><body><main>

<section class="cover">
  <div>
    <div class="band"><span class="kicker">Summary of the Functional Design Document</span><h1>EquipRite</h1><p>Features, menus, pages, scenarios and flows, integrations, roles, reports and settings, from FDD v1.7 (RITE-FDD-EQUIPRITE-001, 08 Jun 2026)</p></div>
    <div class="strip"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="meta">
      <div><b>3</b><span>modules: Foundation, Projects, Customers</span></div>
      <div><b>5</b><span>lifecycle phases</span></div>
      <div><b>35</b><span>scenarios with flows in this summary</span></div>
      <div><b>20</b><span>integrations (INT-01–INT-20)</span></div>
      <div><b>20</b><span>reports (RPT-01–RPT-20)</span></div>
      <div><b>10</b><span>decision points (DP-01–DP-10)</span></div>
    </div>
    <h3>Contents</h3>
    <ol class="toc">${toc.map(([n, t]) => `<li><b>${n}</b>${t}</li>`).join('')}</ol>
  </div>
  <p style="color:var(--muted);font-size:9pt">Prepared 29 Oct 2026 for the EquipRite redesign. Section numbers in brackets refer to the FDD. Where the FDD contradicts itself, section 17 lists it rather than picking a side.</p>
</section>

<section class="chapter"><h2><span class="n">1</span>EquipRite at a glance</h2>
<p>EquipRite is a PaaS extension for Oracle Fusion Cloud ERP that manages the equipment lifecycle for construction, engineering and oil &amp; gas project organisations: request from a catalog, allocation and approval, picking and shipping via Transfer Orders, usage timesheets, rate-based costing, intercompany and AR billing, and return (1.1). It covers heavy equipment, small tools, bulk items and consumables.</p>
${table(['Module', 'What it contains', 'Needed'], [
  ['Equipment Foundation', 'Equipment master, rates, classes, settings, schedule, analytics, smart search, map view', 'Always'],
  ['Equipment for Projects', 'Project requests, workbench, allocation, picking, TOs, project transactions, timesheets, approval, IC billing, returns', 'Optional'],
  ['Equipment for Customers', 'Customer rentals, customer workbench, agreements (internal/external), AR invoices, customer billing', 'Optional'],
])}
${table(['Layer', 'Technology'], [['UI', 'Oracle VBCS, Redwood UX'], ['Logic', 'VBCS business objects and action chains'], ['Integration', 'Oracle Integration Cloud for orchestrations; Fusion REST APIs for direct calls'], ['Data', 'VBCS custom business objects'], ['Reporting', 'OTBI and BI Publisher'], ['Security', 'Fusion RBAC + VBCS security'], ['Notifications', 'Fusion notifications / BPM (bell and email)']])}
<div class="cols">
  <div class="card"><h4>In scope (2.1)</h4>${list(['Equipment master with Inventory and Fixed Assets', 'Optional rental agreements (internal, external, project, class)', 'Rate schedules with six tiers', 'Request cart, allocation (auto/manual), approval', 'Initiate Picking (TO + reserve + pick release), optional job', 'Gantt and map schedule', 'Oracle mobile picking and shipping', 'Optional inspections', 'Weekly time entry and approval', 'Costing, IC billing, AR invoices, PPM posting', 'Return via reverse TO and settlement', 'Analytics; role-based security'])}</div>
  <div class="card"><h4>Out of scope (2.2) and later (2.3)</h4>${list(['Fixed Assets configuration', 'IFRS 16 / ASC 842 lease accounting (later)', 'EPM CapEx planning (later)', 'Native mobile app (responsive web only); offline PWA later', 'GPS / telematics, IoT usage (later)', 'Operator HR management', 'Barcode / RFID scanning at yards', 'Predictive maintenance (later)', 'Asset retirement and disposal, BR-010 (later)'])}</div>
</div>
<h3>Inventory organisations (3.3)</h3>
<p>Equipment lives in an <b>Equipment Yard</b> inventory org (subinventories Available, Reserved, Maintenance) and moves to a <b>Project Site virtual org</b> through inter-org Transfer Orders; returns use a reverse TO. Project sites can have sub-inventories (region/state/city) and locators per project, e.g. TEXAS.PRJ-2026-001 (7.17.2D). All of this is on only when TRANSFER_ORDERS_ENABLED = Yes for the business unit. Intransit ownership is FOB Shipment or FOB Receipt (OI-05).</p>
</section>

<section class="chapter"><h2><span class="n">2</span>Business requirements (4.1)</h2>
${table(['ID', 'Requirement', 'Summary', 'FDD'], [
  ['BR-001', 'Master data', 'Equipment master with class, type, status, serial/lot; Inventory and Fixed Assets', '7.2'],
  ['BR-002', 'Rental agreements', 'Optional; internal (IC) and external (AR); by customer, project or class', '7.3A, 5.1'],
  ['BR-003', 'Rate schedules', 'Always on; six periods with thresholds; basis hourly/daily; method complete/utilized; taggable', '7.3'],
  ['BR-004', 'Request & allocation', 'Optional agreement link; serial auto/manual allocation; quantity check; Auto Allocate + Approve', '7.5, 7.8'],
  ['BR-005', 'Usage tracking', 'Daily/hourly usage, idle, downtime, utilization', '7.13'],
  ['BR-006', 'Maintenance & inspection', 'Planned/unplanned maintenance; optional inspection at ship-out', '7.12'],
  ['BR-007', 'Picking & fulfilment', 'Initiate Picking (TO + reserve + release), optional job, Oracle mobile', '7.16'],
  ['BR-008', 'Scheduling', 'Booked dates and locations; embedded in approval', '7.10, 7.8'],
  ['BR-009', 'Redeployment & transfer', 'Inter-project / inter-org transfers, audit', '7.16A'],
  ['BR-010', 'Retirement / disposal', 'Sell, return, scrap; book values (future phase)', '—'],
  ['BR-011', 'Data & integration', 'REST APIs, incremental/full loads, snapshots, audit trail', '8.1'],
  ['BR-012', 'Reporting', 'Utilization, cost vs budget, expiry alerts, ROI/TCO', '7.4, 7.15'],
  ['BR-013', 'Configuration', 'Flags for agreements, inspection, auto-picking, lead time', '7.17'],
  ['BR-014', 'Non-functional', 'Performance, migration, RBAC, 17 notification types', '10, 11, 13, 14'],
], 'wrap')}
</section>

<section class="chapter"><h2><span class="n">3</span>Roles, tiles and access</h2>
${table(['Role (10.1)', 'Can do', 'Sees'], [
  ['Project Manager', 'Create/edit requests, dashboard, timesheets, analytics, start returns', 'Own projects (PPM membership)'],
  ['Equipment Manager', 'Approve/reject, master data, schedule, inspections, settings', 'All projects, all equipment'],
  ['Finance / AR', 'Cost transactions, approve timesheets, rate schedules, reports', 'All projects (read); own org rates'],
  ['Operations Lead', 'Workbench, assignments, analytics, transfers, schedule', 'Assigned projects / regions'],
  ['External customer', 'Portal only: catalog, requests, own invoices', 'Own customer account'],
], 'wrap')}
<p>Role codes are mapped to Fusion roles in Settings (7.17.2B): EQR_REQUESTER_ROLE, EQR_PROJECT_MANAGER_ROLE, EQR_EQUIPMENT_MANAGER_ROLE, EQR_TIMEKEEPER_ROLE, EQR_TIME_APPROVER_ROLE. Data rules (10.2): project isolation, org filtering, approval thresholds by class and value, rate editing for Finance only, full audit trail.</p>
<h3>Launcher tiles by role (7.1.2)</h3>
${table(['Role', 'Tiles'], TILES, 'wrap')}
<h3>Page access (10.3)</h3>
${table(['Page', 'Project Mgr', 'Equipment Mgr', 'Finance', 'Ops Lead', 'Ext. customer'], ACCESS)}
</section>

<section class="chapter"><h2><span class="n">4</span>Menus and pages</h2>
<h3>Header (all pages)</h3>
<p>Global <b>Region / Inventory Org</b> filter (from the user's Fusion org access, INT-20; multi-select; kept for the session; EMs can widen to all orgs), search, request cart, notification bell, user menu (profile, My Subscriptions, sign out) (7.1.1, 11.1).</p>
<h3>Menu in the new app (redesign, by lifecycle phase)</h3>
${table(['Group', 'Menu items', 'FDD pages'], [
  ['Home', 'Home (by role)', '7.1, 7.4'],
  ['Request', 'New request, My requests', '7.5, 7.6'],
  ['Fulfil', 'Workbench, Equipment schedule, Initiate picking, Inspection, Receipt & returns, Transfers', '7.11, 7.8, 7.10, 7.16, 7.12, 5.3–5.5, 7.16A'],
  ['Usage & cost', 'Time entry, Timesheet approval, Post costs, Direct cost & inventory', '7.13, 7.14, 7.14A, 7.9'],
  ['Master data', 'Equipment, Rate schedules, Rental agreements', '7.2, 7.3, 7.3A'],
  ['Insights', 'Analytics', '7.15'],
  ['Settings', 'Configuration, Integration health', '7.17, 9.4'],
  ['External', 'Customer portal', '7.18'],
], 'wrap')}
<p>Items hide by role (section 3) and by module flag: customer items need CUSTOMERS_MODULE_ENABLED, agreements need AGREEMENTS_ENABLED, inspection needs at least one inspection point, transfers need ENABLE_INTER_PROJECT_TRANSFER, the portal needs CUSTOMER_PORTAL_ENABLED.</p>
<h3>Pages and their features</h3>
${table(['§', 'Page', 'Who', 'Key features'], PAGES, 'wrap')}
</section>

<section class="chapter"><h2><span class="n">5</span>End-to-end process (5.1–5.5)</h2>
<div class="cols">
  <div class="card"><h4>Phase 1 · Agreement &amp; rate setup</h4>${list(['Define categories, serial/lot control (Inventory)', 'Set up rate schedules (always on)', 'Set up agreements (optional)', 'Approve and publish rates/agreements', 'Manage equipment master, link Fixed Assets'])}</div>
  <div class="card"><h4>Phase 2 · Request, allocation &amp; approval</h4>${list(['Raise request (project/customer, optional agreement)', 'Submit: DRAFT → IN_PROCESS, NTF-01', 'Optional allocation: Auto Allocate or manual', 'Approve: IN_PROCESS → APPROVED, or REJECTED'])}</div>
  <div class="card"><h4>Phase 3 · Pick, ship &amp; receive</h4>${list(['Initiate Picking: TO + reserve + pick release', 'Optional automatic job', 'Warehouse picks on Oracle mobile', 'Optional inspection', 'Ship confirm, Bill of Lading, in transit', 'Receive per line at site; billing starts; DEPLOYED'])}</div>
  <div class="card"><h4>Phase 4 · Usage, costing &amp; billing</h4>${list(['Weekly timesheets', 'Rate engine picks the rate period', 'Timesheet approval (bulk)', 'IC invoice or AR invoice', 'Post to GL'])}</div>
  <div class="card"><h4>Phase 5 · Return &amp; settlement</h4>${list(['Return TO, site → yard', 'Ship from site, receive at yard', 'Post-return inspection, WO if needed', 'Stop billing, reconcile, damage charges', 'Final settlement, archive'])}</div>
  <div class="card"><h4>Inventory movement (8.2)</h4>${table(['#', 'Step', 'Effect'], [['1', 'Reserve', 'Yard: hard reserved'], ['2', 'Pick release', 'Pick task created'], ['3', 'Pick confirm', 'Yard on-hand deducted'], ['4', 'Ship confirm', 'In transit'], ['5', 'Receive at site', 'Site on-hand up'], ['6', 'In use', 'Timesheets'], ['7', 'Return ship', 'Site deducted, in transit'], ['8', 'Receive at yard', 'Yard restored']])}</div>
</div>
</section>

<section class="chapter"><h2><span class="n">6</span>Status lifecycles</h2>
<h3>Equipment request (5.6)</h3>
<div class="lifecycle">${lifecycle.map(st).join('<span class="arrow">→</span>')}<span class="arrow">·</span>${st('REJECTED')}<span style="font-size:9pt;color:var(--muted)">→ back to DRAFT</span></div>
${table(['Status', 'Reached when', 'What the system does'], [
  [st('DRAFT'), 'Created or saved', 'Validation, estimated cost'], [st('IN_PROCESS'), 'Submitted', 'NTF-01; availability shown'],
  [st('APPROVED'), 'Allocated or quantity-checked, approved', 'Soft allocation; listed on Initiate Picking'], [st('PICK_INITIATED'), 'Initiate Picking ran', 'TO, hard reserve, pick release'],
  [st('PICK_RELEASED'), 'Pick release succeeded', 'Warehouse picking'], [st('EQP INSPECTION COMPLETE'), 'Inspection passed (optional)', 'Cleared to ship'],
  [st('SHIPPED'), 'Ship confirmed', 'In transit'], [st('DEPLOYED'), 'Received at site (per line)', 'Billing starts; time entry opens'],
  [st('RETURNED'), 'Return completed', 'Billing stopped; settlement'], [st('CLOSED'), 'Settlement done', 'Archived; equipment Available'],
  [st('REJECTED'), 'EM rejected', 'NTF-03; can edit and resubmit'],
], 'wrap')}
<p>Line-level statuses also include INSPECTION_FAILED (DP-03). Cancelled requests (DRAFT or IN_PROCESS only) are hidden by default (7.6.3).</p>
<div class="cols">
  <div class="card"><h4>Timesheet (7.14.2)</h4><p>DRAFT → SUBMITTED → APPROVED, or REJECTED → DRAFT. Approvers may adjust hours with an audit trail.</p></div>
  <div class="card"><h4>Agreement (7.3A.2)</h4><p>DRAFT → ACTIVE → EXPIRED, or CANCELLED. Only ACTIVE agreements can be linked.</p></div>
  <div class="card"><h4>Procurement requisition (7.5.6A)</h4><p>SUBMITTED → APPROVED / PROCUREMENT_IN_PROGRESS → FULFILLED, or ALTERNATIVE_SUGGESTED, or REJECTED.</p></div>
  <div class="card"><h4>Inspection result (7.12.4)</h4><p>PASS → ship. CONDITIONAL → EM acknowledges. FAIL → INSPECTION_FAILED: substitute, work order or cancel the line.</p></div>
  <div class="card"><h4>Certification (7.2.5A)</h4><p>ACTIVE (green) → EXPIRING (amber, 30 days before) → EXPIRED (red).</p></div>
  <div class="card"><h4>Postings and transfers</h4><p>Direct cost, inventory consumption and transfers: PENDING → POSTED / COMPLETED, or FAILED (retry).</p></div>
</div>
</section>

<section class="chapter"><h2><span class="n">7</span>Scenarios and flows</h2>
<p>Every path the FDD describes, including the decision points DP-01 to DP-10. Each flow reads left to right; amber boxes are decisions, green boxes are the outcome.</p>
<div class="legend">${Object.entries(ACTORS).map(([k, v]) => `<span class="actor a-${k}">${v}</span>`).join('')}</div>
${scenariosHtml()}
</section>

<section class="chapter"><h2><span class="n">8</span>Integrations (8.1)</h2>
${table(['ID', 'Integration', 'Fusion module', 'Method', 'Dir.', 'Trigger', 'Purpose'], INTEGRATIONS, 'wrap')}
<h3>Fusion objects used (6.2)</h3>
<p>Inventory items, serial numbers, lot numbers, fixed assets, customer accounts, projects and tasks, transfer orders (supplyOrdersForOrderOrchestration), shipments, receiving receipts, project expenditure items, receivables invoices, intercompany transactions (OIC).</p>
<div class="note">In today's app these are reached through the VBCS service connections in services/catalog.json: EquipRite REST (eqpt, commonService), Fusion REST and BI Publisher reports (fusion, bipService, callPWPBIP) and OIC (ics). The new app reuses the same connections.</div>
</section>

<section class="chapter"><h2><span class="n">9</span>Errors, retries and monitoring (9)</h2>
${table(['Code group', 'Layer', 'Examples'], [
  ['EQR-VAL-001–004', 'UI validation (warning)', 'Missing field; end date before start; bill rate below cost; duplicate rate line'],
  ['EQR-BIZ-001–006', 'Business logic (error)', 'Not available; budget insufficient; agreement expired; no rate schedule; >24 h a day; duplicate timesheet'],
  ['EQR-API-001–006', 'REST API', '400, 401/403, 404, 500 (critical), 409 lock, 30 s timeout (critical)'],
  ['EQR-OIC-001–003', 'OIC flow', 'TO creation (critical), IC billing (critical), shipping'],
  ['EQR-SCH-001–002', 'Scheduled job', 'IC billing job failed; orphan records in sync'],
], 'wrap')}
<div class="cols">
  <div class="card"><h4>Severity (9.1.3)</h4>${list(['CRITICAL: blocks the process; email to admin + EM; 3 auto-retries', 'ERROR: one transaction; email + in-app; retry for API errors', 'WARNING: in-app only', 'INFO: audit only'])}</div>
  <div class="card"><h4>Recovery (9.3)</h4>${list(['Automatic retry by error type, then exception dashboard', 'Manual reprocessing by integration', 'Dead Letter Queue for permanent failures', 'Reconciliation: request ↔ TO, timesheet ↔ PPM, ship ↔ on-hand (daily); billing ↔ GL (weekly); agreement billing ↔ usage (monthly)'])}</div>
  <div class="card"><h4>Integration health page (9.4.1)</h4>${list(['A card per integration: healthy / degraded / down, last success, 24 h success rate', '30-day error trend', 'Exception queue by severity and age', 'Scheduled job monitor', 'API response times, flag above 3 s'])}</div>
  <div class="card"><h4>Targets (9.4.3)</h4>${list(['Success rate 99.5%+', 'Detect in < 5 min; resolve critical < 4 h, error < 24 h', '95% of exceptions resolved in 48 h', 'DLQ < 5 at month end', 'Reconciliation pass 98%+; auto-retry success 85%+'])}</div>
</div>
</section>

<section class="chapter"><h2><span class="n">10</span>Notifications (11)</h2>
${table(['ID', 'Event', 'To', 'Channel'], NOTIFICATIONS, 'wrap')}
<p>* The FDD uses these IDs for two different events, or does not define them in section 11 (see section 17).</p>
</section>

<section class="chapter"><h2><span class="n">11</span>Reports (7.15)</h2>
<p>All reports share one filter bar: region/org, date range presets, class/subclass, equipment, project, customer, status, location; filter sets can be bookmarked; export to Excel. Delivery: VBCS dashboards (live), OTBI (ad-hoc, cross-module) and BIP (formatted PDF/Excel, scheduled email).</p>
${table(['ID', 'Report', 'Technology', 'Audience'], REPORTS)}
</section>

<section class="chapter"><h2><span class="n">12</span>Configuration settings (7.17)</h2>
<p>Three tabs: <b>Administration</b> (system settings, flags, role mapping, rate types, cost source), <b>Warehouse</b> (yard operations, picking, shipping, inspection, documents) and <b>Project Site</b> (receiving, acceptance, site inventory). Defaults in brackets.</p>
${table(['Area', 'Settings'], FLAGS, 'wrap')}
</section>

<section class="chapter"><h2><span class="n">13</span>Data model (6)</h2>
${table(['Custom business object', 'Holds'], OBJECTS, 'wrap')}
</section>

<section class="chapter"><h2><span class="n">14</span>Quality, migration and testing (13–15)</h2>
${table(['Area', 'Target'], [['Page load', '< 3 s (95th percentile); BR-014 says ≤ 2 s'], ['Search', '< 2 s for 10,000 records'], ['Dashboard KPIs', '< 1 s'], ['Uptime', '99.5%'], ['Users', '100+ concurrent'], ['Volume', '50,000+ requests, 500,000+ timesheet entries'], ['Devices', 'Tablet 1024 px and up'], ['Accessibility', 'WCAG 2.1 AA'], ['Integrity', 'Audit trail; optimistic locking on requests and timesheets']])}
<p><b>Migration (14):</b> equipment master (500–2,000, FBDI + REST, go-live), rate schedules (10–50, manual/CSV, go-live), active agreements (20–100, manual), historical requests (optional, after go-live). Extract to CSV, validate, load, reconcile counts, sign off.</p>
${table(['Test', 'Scenario', 'Expected'], [
  ['TC-01', 'Create, submit, approve; TO in OM', 'TO with correct orgs and lines'], ['TC-02', 'Pick, ship, receive', 'Yard down, site up'],
  ['TC-03', 'Timesheet approved', 'Expenditure item with right rate and task'], ['TC-04', 'Overlapping rate schedules', 'Rejected'],
  ['TC-05', 'PM opens Approve page', 'Access denied'], ['TC-06', 'Return', 'Billing stops; settlement posted'],
  ['TC-07', 'Nothing available', 'Unavailable badge; procurement flagged'], ['TC-08', 'Bulk approve 50 timesheets', 'Within 10 s, costs right'],
], 'wrap')}
<p>Test phases: unit (DEV), SIT, UAT, performance, security, regression (15.1).</p>
</section>

<section class="chapter"><h2><span class="n">15</span>Decisions and open items (16)</h2>
${table(['ID', 'Decision'], [
  ['DEC-01', 'Rate schedules work without agreements; agreements add terms when on'], ['DEC-02', 'External = third-party via AR invoice (INT-11)'],
  ['DEC-03', 'Serial unavailable at picking: EM re-allocates and retries; no auto-substitution'], ['DEC-04', 'Returns use a reverse TO; no return picking page'],
  ['DEC-05', 'Mixed requests: approve when all serial lines allocated and all others pass the quantity check'], ['DEC-06', 'Schedule embedded in Approve, filtered to the line'],
  ['DEC-07', 'Agreement link optional per request'], ['DEC-08', 'Auto picking uses PICKING_LEAD_TIME_DAYS'],
], 'wrap')}
${table(['Open item', 'Question', 'Owner'], [
  ['OI-01', 'Billing starts at dispatch or receipt?', 'Functional owner'], ['OI-02', 'Approval thresholds by class', 'Equipment Manager'],
  ['OI-03', 'IC billing frequency per legal entity', 'Finance'], ['OI-04', 'Separate approval for damage charges?', 'Functional owner'],
  ['OI-05', 'FOB point for intransit', 'Finance'], ['OI-06', 'Multi-currency rates', 'Finance'], ['OI-07', 'Where to store equipment images', 'Technical lead'],
  ['OI-08', 'Auto Allocate priority: utilization, FIFO or nearest', 'Equipment Manager'], ['OI-09', 'AR invoice template (BIP)', 'Finance'],
  ['OI-10', 'SLA for failed auto-picks', 'Operations'], ['OI-11', 'Split a lot across requests?', 'Functional owner'], ['OI-12', 'Agreement renewal: auto or manual', 'Finance'],
], 'wrap')}
</section>

<section class="chapter"><h2><span class="n">16</span>Old app and new app</h2>
<p>The redesign is built as a second VBCS web app next to today's app, which stays exactly as it is. Both use the same service connections, so they show and change the same data. In the desktop app the sign-in window offers <b>Old EquipRite</b> and <b>New EquipRite</b> and opens the one chosen (scenario S35).</p>
${table(['Today\'s app', 'New app', 'Change'], OLD_NEW.map(([a, b, c]) => [a, b, chip(c)]), 'wrap')}
<p>Wireframes for every new screen: EquipRite-Redesign-Wireframes.pdf in this folder, and the live canvas at claude.ai/artifact/KPvPbWuSGpWcJ4VTXYBpEU.</p>
</section>

<section class="chapter"><h2><span class="n">17</span>Inconsistencies to resolve in the FDD</h2>
<p>Found while summarising. Each needs a decision before the matching feature is built.</p>
<ol>${ISSUES.map((i) => `<li>${i}</li>`).join('')}</ol>
</section>

</main></body></html>`;
}

async function main() {
  fs.mkdirSync(path.dirname(HTML_OUT), { recursive: true });
  fs.writeFileSync(HTML_OUT, render());
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`file://${HTML_OUT}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.pdf({
      path: PDF_OUT, format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font-size:8px;color:#64748b;padding:0 14mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>EquipRite FDD summary · from FDD v1.7</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
  } finally {
    await browser.close();
  }
  console.log(`wrote ${path.relative(process.cwd(), HTML_OUT)} and ${path.relative(process.cwd(), PDF_OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
