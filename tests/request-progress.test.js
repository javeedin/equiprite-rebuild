/*
 * Where a request is, worked out from its equipment (webApps/equiprite/resources/js/requestProgress.js).
 * The request's own status says only whether it is approved; the lines say where the equipment is.
 *
 * Run:  node tests/request-progress.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const FILE = path.join(__dirname, '..', 'webApps', 'equiprite', 'resources', 'js', 'requestProgress.js');
const sandbox = {};
let P;
sandbox.define = (deps, factory) => { P = factory(); };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'requestProgress.js' });

const NOW = Date.UTC(2026, 9, 30, 9);
const L = (...codes) => codes.map((c) => ({ lineStatus: c }));
const sum = (header, lines, opts) => P.summarize(header, lines, Object.assign({ now: NOW }, opts || {}));

T.section('one shipped of three: the request says so, not IN PROCESS');
const shipped = sum('IN_PROCESS', L('SHIP_TO_SITE', 'SCHEDULED_FOR_PICKING', 'ALLOCATED'), { start: '2026-11-08', end: '2026-11-30' });
T.eq('headline', shipped.headline, 'Partly shipped · 1 of 3');
T.eq('detail, furthest first', shipped.detail, '1 on the way · 2 getting ready');
T.eq('next: the earlier step when two tie (assign before pick)', shipped.next.text, 'Equipment Manager to confirm it for picking (1 of 3)');
T.eq('tracker counts', shipped.stops.map((s) => s.count + s.state[0]).join(' '), '0d 2h 1h 0t 0t 0t');
T.eq('nothing late before the start date', shipped.late.length, 0);

T.section('the request in the screenshot: 1 returned, 2 never assigned, window ends today');
const shot = sum('IN_PROCESS', L('CLOSED', 'IN_PROCESS', 'IN_PROCESS'), { start: '2026-10-08', end: '2026-10-30' });
T.eq('headline', shot.headline, 'Partly returned · 1 of 3');
T.eq('next', shot.next.text, 'Equipment Manager to assign a unit (2 of 3)');
T.eq('late', shot.late.map((x) => x.text).join(), '2 not shipped, due 8 Oct (22 days late)');
T.eq('tracker: stages between are passed by some', shot.stops.map((s) => s.state[0]).join(''), 'dhppph');

T.section('one stage only');
T.eq('all on site', sum('IN_PROCESS', L('DEPLOYED', 'DEPLOYED')).headline, 'On site');
T.eq('on site within its dates: in use until, not a chore', sum('IN_PROCESS', L('DEPLOYED'), { end: '2026-11-11' }).next.text, 'In use until 11 Nov');
T.eq('on site past its end date: return it', sum('IN_PROCESS', L('DEPLOYED'), { end: '2026-10-25' }).next.text, 'Requester to return it (ended 25 Oct)');
T.eq('all getting ready, by step', JSON.stringify([sum('IN_PROCESS', L('UNDER_PROCUREMENT', 'ALLOCATED')).headline, sum('IN_PROCESS', L('UNDER_PROCUREMENT', 'ALLOCATED')).detail]),
  '["Getting ready","1 being bought · 1 unit assigned"]');
T.eq('waiting for approval', sum('SUBMITTED', L('SUBMITTED', 'SUBMITTED')).next.text, 'Equipment Manager to approve it (2 of 2)');
const done = sum('IN_PROCESS', L('CLOSED', 'CONSUMED'));
T.eq('all back: completed, every stop done', done.headline + ' ' + done.stops.map((s) => s.state[0]).join(''), 'Completed dddddd');
T.eq('completed has no next step', done.next, null);

T.section('the request\'s own decisions win');
T.eq('draft', sum('DRAFT', L('DRAFT')).headline, 'Draft');
T.eq('sent back', JSON.stringify([sum('REJECTED', L('REJECTED')).headline, sum('REJECTED', []).next.text]), '["Sent back","Requester to fix it and send it again"]');
T.eq('cancelled', sum('CANCELLED', L('SUBMITTED')).headline, 'Cancelled');
T.eq('rejected lines leave the count', sum('IN_PROCESS', L('DEPLOYED', 'REJECTED', 'SHIP_TO_SITE')).headline, 'Partly on site · 1 of 2');

T.section('lines not loaded yet: only what the request says');
const bare = sum('IN_PROCESS', [], { start: '2026-10-01' });
T.eq('approved, not a guess', JSON.stringify([bare.headline, bare.late.length, bare.next]), '["Approved",0,null]');
T.eq('submitted past its start date is late for approval', sum('SUBMITTED', [], { start: '2026-10-28' }).late.map((x) => x.text).join(), '1 not shipped, due 28 Oct (2 days late)');

T.section('late and overdue');
const over = sum('IN_PROCESS', [{ lineStatus: 'DEPLOYED', endDate: '2026-10-25' }, { lineStatus: 'DEPLOYED', endDate: '2026-11-25' }]);
T.eq('a line past its own end date', over.late.map((x) => x.text).join(), '1 past its end date (25 Oct), not returned');
T.eq('coming back is not overdue', sum('IN_PROCESS', [{ lineStatus: 'SHIPPED_TO_YARD', endDate: '2026-10-01' }]).late.length, 0);

T.section('customers and unknown statuses');
T.eq('a customer request in IN_PROCESS waits on the Equipment Manager', JSON.stringify([sum('IN_PROCESS', L('IN_PROCESS'), { external: true }).headline,
  sum('IN_PROCESS', L('IN_PROCESS'), { external: true }).next.what]), '["Waiting for approval","review it and assign a unit"]');
T.eq('a quote waits on the customer', sum('QUOTE_GENERATED', L('QUOTE_GENERATED')).next.who, 'Customer');
T.eq('an unknown status reads as words, counted as getting ready', JSON.stringify([P.line('SOME_NEW_STATUS').label, P.line('SOME_NEW_STATUS').stage]), '["Some new status","ready"]');
T.eq('every stored status has a stage', ['DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'ALLOCATED', 'UNDER_PROCUREMENT', 'SCHEDULED_FOR_PICKING',
  'PICK_INITIATED', 'SHIP_TO_SITE', 'DEPLOYED', 'RETURN_INITIATED', 'RETURN_IN_PROCESS', 'SHIPPED_TO_YARD', 'CLOSED', 'CONSUMED', 'REJECTED', 'CANCELLED']
  .map((c) => P.stageOf(c)).join(' '), 'draft approval ready approval ready ready ready ready ready out onsite back back back done done stopped stopped');
T.eq('the bulk view\'s shape works too (status / requestStatus)', sum('IN_PROCESS', [{ status: 'DEPLOYED' }, { requestStatus: 'DEPLOYED' }]).headline, 'On site');

T.report();
