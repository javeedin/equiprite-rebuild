/*
 * The Jira stories page's rules (resources/js/jiraBacklog.js, identical in Old EquipRite and EquipRite Next): a story
 * read from Jira split into its parts (body, acceptance criteria, FDD sections) the way the EQP stories are written,
 * the tester's gaps from a comment, the checks a story fails and its score, reading every page of a search, what a
 * failed call means, the analysis and its findings, the filters and their options, and Old's copy kept the same.
 *
 * Run:  node tests/jira-backlog.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'webApps', 'equiprite-next', 'resources', 'js', 'jiraBacklog.js');
const sandbox = { console, Date, JSON, Math, Promise, Blob, URL };
let J;
sandbox.define = (names, factory) => { J = factory(); };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'jiraBacklog.js' });
const plain = (x) => JSON.parse(JSON.stringify(x));

const EPIC = { key: 'EQP-1', fields: { summary: 'Equipment Registry' } };
const status = (name, key) => ({ name, statusCategory: { key } });
// As Jira sends EQP-12 and EQP-13 (REST v2: description and comments as text)
const EQP12 = { key: 'EQP-12', fields: {
  summary: 'Equipment Master List View - Section 7.2', issuetype: { name: 'Story' }, status: status('DEVELOPMENT', 'indeterminate'), priority: { name: 'Medium' },
  parent: EPIC, fixVersions: [{ name: '26C', releaseDate: '2026-09-30' }], assignee: { displayName: 'Rahul Kanth Panganamamula' }, duedate: '2026-10-07',
  description: 'Display master list of all equipment records with smart search, advanced filtering (Class, Subclass, Name, Maintenance Asset No., Location, Status, Type), and data grid with all specified columns.Acceptance Criteria: Grid displays all columns per FDD 7.2.4; smart search returns results with type-ahead; all filter fields functional.FDD Section: 7.2Only Smart search is available by two columns, Class and Sub-Class. Advanced Search is not there.',
  comment: { comments: [{ author: { displayName: 'Sana Suhana Thehaseen' }, created: '2026-09-29T04:37:34.383-0500',
    body: '**(FDD-7.2)**\n\n1. Only Class, Subclass search filters are present, remaining needs to be added. (FDD-7.2.3)\n\n2. Type Column is missing.\n\n3. Map view is missing.\n\n4. Edit option to be added.' }] },
  customfield_10020: [{ name: '2026-07', state: 'active' }], created: '2026-07-16T15:05:30.408-0500', updated: '2026-10-26T18:13:06.146-0500' } };
const EQP13 = { key: 'EQP-13', fields: {
  summary: 'Equipment Master Create/Edit - Section 7.2, 7.2.5G', issuetype: { name: 'Story' }, status: status('DEVELOPMENT', 'indeterminate'), priority: { name: 'High' },
  parent: EPIC, fixVersions: [{ name: '27A', releaseDate: '2026-12-31' }], assignee: { displayName: 'Rahul Kanth Panganamamula' }, duedate: '2026-10-31',
  description: 'Create new equipment records and edit existing ones.\n\nAcceptance Criteria: Equipment created/edited successfully; unique name validation fires; FA Asset required for Company-Owned type; all fields save correctly; Non-Labor Resource Type and Expenditure Type fields support multiple values per equipment (one-to-many); values saved and retrieved correctly; expenditure types linked to equipment are used to filter LOV on timesheet and post cost pages.\n\nFDD Section: 7.2, 7.2.5G',
  comment: { comments: [] }, customfield_10020: [{ name: '2026-10 B', state: 'future' }], created: '2026-07-16', updated: '2026-10-27T11:21:37.258-0500' } };
const DONE = { key: 'EQP-20', fields: { summary: 'Rate schedule list', issuetype: { name: 'Story' }, status: status('Done', 'done'), priority: { name: 'Low' },
  parent: { key: 'EQP-62', fields: { summary: 'Rate & Pricing' } }, fixVersions: [{ name: '26C', releaseDate: '2026-09-30' }], assignee: { displayName: 'Aditi Rao' },
  duedate: '2026-09-01', description: 'List schedules. Acceptance Criteria: list shows. FDD Section: 7.3', comment: { comments: [] }, updated: '2026-09-02' } };
const BARE = { key: 'EQP-30', fields: { summary: 'Notification engine', issuetype: { name: 'Story' }, status: status('FUNC DESIGN', 'indeterminate'),
  priority: { name: 'Medium' }, description: 'Send notifications.', comment: { comments: [] }, updated: '2026-08-01' } };
const TODAY = '2026-11-05';
const issue2 = (key, st, cat, sprints, due) => ({ key, fields: { summary: key + ' story', issuetype: { name: 'Story' }, status: status(st, cat), priority: { name: 'Medium' },
  assignee: { displayName: 'Rahul Kanth Panganamamula' }, fixVersions: [{ name: '27A', releaseDate: '2026-12-31' }], duedate: due,
  description: 'Do it. Acceptance Criteria: it works. FDD Section: 7.5', comment: { comments: [] }, customfield_10020: sprints, updated: '2026-11-01' } });

T.section('a story, split into its parts');
const r12 = J.fromIssue(EQP12, { today: TODAY });
T.eq('its acceptance criteria, without the label', r12.ac, 'Grid displays all columns per FDD 7.2.4; smart search returns results with type-ahead; all filter fields functional.');
T.check('…the body keeps the description and the note added after the FDD line', r12.body.startsWith('Display master list') && r12.body.includes('Advanced Search is not there.') && !r12.body.includes('Acceptance'));
T.eq('its FDD section ("per FDD 7.2.4" in the criteria is a pointer, not its section; "7.2Only…" read as 7.2)', r12.fdd.join(), '7.2');
T.eq('…several, from the FDD line and the summary', J.fromIssue(EQP13, { today: TODAY }).fdd.join(), '7.2,7.2.5G');
T.eq('the tester\'s gaps, from the numbered lines', r12.gaps.join(' | '),
  'Only Class, Subclass search filters are present, remaining needs to be added. | Type Column is missing. | Map view is missing. | Edit option to be added.');
T.check('the latest comment, who last commented and when (for the list column)', r12.lastCommentBy === 'Sana Suhana Thehaseen'
  && r12.lastCommentAt === '2026-09-29' && !!r12.lastComment && r12.lastComment.length > 0);
T.eq('no comments → empty last-comment fields', [J.fromIssue(EQP13, { today: TODAY }).lastComment, J.fromIssue(EQP13, { today: TODAY }).lastCommentBy].join('|'), '|');
T.eq('epic, release, sprint, who, link', [r12.epicKey, r12.epicName, r12.release, r12.sprint + ' ' + r12.sprintState, r12.assignee, r12.url].join(' / '),
  'EQP-1 / Equipment Registry / 26C / 2026-07 active / Rahul Kanth Panganamamula / https://equiprite.atlassian.net/browse/EQP-12');
T.check('overdue: due 7 Oct, not done (a done one never is)', r12.overdue && !J.fromIssue(DONE, { today: TODAY }).overdue);
T.eq('Atlassian Document Format flattened (REST v3)', J.plain({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] }), 'One\nTwo');

T.section('the checks a story fails, and its score');
T.eq('EQP-12: due after its release (7 Oct, 26C on 30 Sep), and that date has passed', plain(r12.checks).map((c) => c.key).join(), 'dueAfterRelease,releasePassed');
const r13 = J.fromIssue(EQP13, { today: TODAY });
T.eq('EQP-13: seven checks in one story: too big', [r13.acChecks, r13.checks.map((c) => c.key).join()].join(' / '), '7 / big');
const bare = J.fromIssue(BARE, { today: TODAY });
T.eq('a title and a line: no criteria, no FDD, no due date, release or owner, idle', bare.checks.map((c) => c.key).join(),
  'noAc,noFdd,noDue,noRelease,noAssignee,stale');
T.eq('…scores', [r12.score, r13.score, bare.score, J.fromIssue(DONE, { today: TODAY }).score].join(), '4,4,1,5');

T.section('reading every page of a search');
(async () => {
  const calls = [];
  const pages = [{ issues: [EQP12], nextPageToken: 'p2', isLast: false }, { issues: [EQP13], isLast: true }];
  const Actions = { callRest: async (ctx, o) => { calls.push(o); return { ok: true, status: 200, body: pages[calls.length - 1] }; } };
  const got = await J.load({}, Actions, 'project = EQP');
  T.eq('two pages, the second asked with its token', [got.ok, got.issues.length, calls.map((c) => c.endpoint + ' ' + (c.uriParams.nextPageToken || '-')).join(' > ')].join(' / '),
    'true / 2 / jira/searchJiraIssues - > jira/searchJiraIssues p2');
  T.check('…the fields the page reads, 100 at a time', calls[0].uriParams.fields.includes('customfield_10020') && calls[0].uriParams.maxResults === 100);
  const refused = await J.load({}, { callRest: async () => ({ ok: false, status: 401, body: {} }) }, 'x');
  T.check('a 401: not connected, and how to connect', !refused.ok && /not connected/.test(refused.message) && /Basic authentication/.test(refused.message));
  T.section('only a signed-in Jira answer counts');
  const asWho = (body, status) => J.whoAmI({}, { callRest: async () => ({ ok: (status || 200) < 400, status: status || 200, body }) });
  const me = await asWho({ accountId: '712020:9b82', displayName: 'Javeed Shaik', emailAddress: 'javeed@equiprite.com' });
  T.eq('signed in: Jira names the account', [me.ok, me.name, me.email].join(' / '), 'true / Javeed Shaik / javeed@equiprite.com');
  const anon = await asWho({});
  T.check('an answer without an account (an anonymous call): not connected, and why', !anon.ok && anon.status === 401 && /not for a signed-in user/.test(anon.message));
  const page = await asWho('<!DOCTYPE html><html><body>EquipRite</body></html>');
  T.check('a web page instead of Jira\'s data: said, not connected', !page.ok && page.status === 502 && /did not reach Jira/.test(page.message));
  const notSearch = await J.load({}, { callRest: async () => ({ ok: true, status: 200, body: '<html>shell</html>' }) }, 'project = EQP');
  T.check('a search answered with a web page: an error, never "no items"', !notSearch.ok && notSearch.status === 502 && /did not reach Jira/.test(notSearch.message));
  const emptyObj = await J.load({}, { callRest: async () => ({ ok: true, status: 200, body: {} }) }, 'project = EQP');
  T.check('…or with something that is not a search result', !emptyObj.ok && /not a search result/.test(emptyObj.message));
  const none = await J.load({}, { callRest: async () => ({ ok: true, status: 200, body: { issues: [], isLast: true } }) }, 'project = EQP');
  T.check('a real empty result is fine', none.ok && none.issues.length === 0);
  T.eq('a bad JQL: Jira\'s words', J.problem({ status: 400, body: { errorMessages: ['Field \'foo\' does not exist.'] } }), 'Jira did not accept the search: Field \'foo\' does not exist..');

  T.section('the analysis');
  const rows = [EQP12, EQP13, DONE, BARE].map((i) => J.fromIssue(i, { today: TODAY }));
  const a = J.analyse(rows, TODAY);
  T.eq('the numbers', JSON.stringify(plain(a.kpis)), JSON.stringify({ total: 4, done: 1, active: 3, onHold: 0, notStarted: 0, overdue: 2, noAc: 1, withGaps: 1, gaps: 4, avgScore: 3.5 }));
  T.eq('statuses in the workflow\'s order', a.statuses.map((s) => s.status + ' ' + s.count).join(', '), 'FUNC DESIGN 1, DEVELOPMENT 2, Done 1');
  T.eq('epics, most open first', a.epics.map((e) => (e.key || '-') + ' ' + e.open + '/' + e.total).join(', '), 'EQP-1 2/2, - 1/1, EQP-62 0/1');
  T.eq('releases by date, a passed one marked', a.releases.map((r) => r.name + (r.passed ? ' passed' : '') + ' ' + r.open + '/' + r.total).join(', '),
    '26C passed 1/2, 27A 1/1, No release 1/1');
  T.eq('FDD sections', a.fdd.map((s) => s.section + ' ' + s.total).join(', '), '7.2 2, 7.3 1');
  T.eq('the findings', a.findings.map((f) => f.tone + ': ' + f.text).join(' | '),
    'bad: 2 items are past their due date, most of them in DEVELOPMENT (2). | bad: Release 26C was due 2026-09-30 and still has 1 item not done. | '
    + 'warn: Next release: 27A on 2026-12-31, 1 item still open of 1. | warn: 1 story has no acceptance criteria: they cannot be tested as written. | '
    + 'warn: Testers listed 4 gaps on 1 item: each is unfinished work the status may not show. | warn: 1 open item has nobody assigned. | '
    + 'info: Rahul Kanth Panganamamula holds 2 of the 3 open items (67%): a bottleneck risk. | info: Most open work: EQP-1 Equipment Registry (2 open of 2). | '
    + 'info: 1 story is large (more than 6 checks in the criteria): worth splitting.');
  T.check('…each opens the rows it is about', JSON.stringify(a.findings[0].filter) === '{"only":"overdue"}' && a.findings[1].filter.release === '26C');

  T.section('filters and their options');
  T.eq('by a finding (overdue), a check, a person, words', [J.filter(rows, { only: 'overdue' }).map((r) => r.key).join(), J.filter(rows, { check: 'big' }).map((r) => r.key).join(),
    J.filter(rows, { assignee: 'Nobody' }).map((r) => r.key).join(), J.filter(rows, { text: 'map view' }).map((r) => r.key).join()].join(' / '), 'EQP-12,EQP-13 / EQP-13 / EQP-30 / EQP-12');
  T.eq('an FDD section and its subsections', J.filter(rows, { fdd: '7.2' }).map((r) => r.key).join(), 'EQP-12,EQP-13');
  T.eq('status options, in the workflow\'s order, with counts', J.options(rows, 'status').map((o) => o.label).join(', '), 'FUNC DESIGN (1), DEVELOPMENT (2), Done (1)');
  T.eq('epic options, named', J.options(rows, 'epic').map((o) => o.label).join(', '), 'EQP-1 Equipment Registry (2), EQP-62 Rate & Pricing (1), No epic (1)');
  T.check('an export column per finding', J.exportColumns().map((c) => c.label).join().includes('Tester gaps'));

  T.section('by customer (the story labels)');
  const lab = (key, labels, cat) => J.fromIssue({ key, fields: { summary: key + ' story', issuetype: { name: 'Story' },
    status: status(cat === 'done' ? 'Done' : 'DEVELOPMENT', cat), priority: { name: 'Medium' }, assignee: { displayName: 'Aditi Rao' },
    duedate: '2026-12-31', labels, description: 'Do it. Acceptance Criteria: it works. FDD Section: 7.9', comment: { comments: [] }, updated: '2026-11-01' } }, { today: TODAY });
  const crows = [lab('EQP-70', ['cianbro'], 'indeterminate'), lab('EQP-71', ['cianbro', 'oceaneering'], 'indeterminate'), lab('EQP-72', ['oceaneering'], 'done'), lab('EQP-73', [], 'indeterminate')];
  const ca = J.analyse(crows, TODAY);
  T.eq('customers (labels), most open first, No label last', ca.customers.map((c) => c.name + ' ' + c.open + '/' + c.total).join(', '),
    'cianbro 2/2, oceaneering 1/2, No label 1/1');
  T.eq('a story with two labels is counted under each customer', J.filter(crows, { label: 'oceaneering' }).map((r) => r.key).join(), 'EQP-71,EQP-72');
  T.eq('the No label bucket filters on "none"', J.filter(crows, { label: 'none' }).map((r) => r.key).join(), 'EQP-73');
  T.eq('a label is searchable as text', J.filter(crows, { text: 'cianbro' }).map((r) => r.key).join(), 'EQP-70,EQP-71');
  T.check('Customer is an export column', J.exportColumns().map((c) => c.label).join().includes('Customer'));
  T.check('labels do not disturb the no-label analysis (findings unchanged)', J.analyse([EQP12, EQP13, DONE, BARE].map((i) => J.fromIssue(i, { today: TODAY })), TODAY).customers.map((c) => c.name).join() === 'No label');

  T.section('sprints: dates, progress, spill-over, what is wrong on the board');
  const SP = (name, state, start, end) => ({ id: name.length, name, state, startDate: start + 'T05:00:00.000Z', endDate: end + 'T05:00:00.000Z' });
  const sp = [
    issue2('EQP-50', 'DEVELOPMENT', 'indeterminate', [SP('2026-06', 'closed', '2026-06-01', '2026-06-30'), SP('2026-07', 'active', '2026-07-01', '2026-07-31')], '2026-07-20'),
    issue2('EQP-51', 'Done', 'done', [SP('2026-07', 'active', '2026-07-01', '2026-07-31')], '2026-07-15'),
    issue2('EQP-52', 'FUNC DESIGN', 'indeterminate', [SP('2026-10 B', 'future', '2026-10-16', '2026-10-31')], '2026-10-31'),
    issue2('EQP-53', 'DEVELOPMENT', 'indeterminate', [SP('2026-11 A', 'active', '2026-11-01', '2026-11-14')], '2026-11-30'),
    issue2('EQP-54', 'Done', 'done', [SP('2026-11 A', 'active', '2026-11-01', '2026-11-14')], '2026-11-10'),
  ].map((i) => J.fromIssue(i, { today: TODAY }));
  T.eq('a story\'s sprint, its dates, and the sprints before it', [sp[0].sprint, sp[0].sprintStart, sp[0].sprintEnd, sp[0].sprintPast.join()].join(' / '), '2026-07 / 2026-07-01 / 2026-07-31 / 2026-06');
  T.eq('…its checks: its sprint ended, carried over', sp[0].checks.filter((c) => /sprint|carried/.test(c.key)).map((c) => c.key).join(), 'sprintEnded,carried');
  T.eq('an older Jira\'s sprint string', JSON.stringify(plain(J.sprintsOf(['com.atlassian.greenhopper.service.sprint.Sprint@1[id=5,state=ACTIVE,name=2026-07,startDate=2026-07-01T14:56:40.083Z,endDate=2026-07-31T05:00:00.000Z,completeDate=<null>,goal=]']))),
    JSON.stringify([{ id: '5', name: '2026-07', state: 'active', start: '2026-07-01', end: '2026-07-31', done: '', goal: '', board: '' }]));
  const sa = J.analyse(sp, TODAY);
  T.eq('the sprints: active first, then future, then closed', sa.sprints.map((x) => x.name + ' ' + x.state + ' ' + x.done + '/' + x.total).join(' | '),
    '2026-07 active 1/2 | 2026-11 A active 1/2 | 2026-10 B future 0/1');
  T.eq('…what is wrong with each', sa.sprints.map((x) => x.name + ': ' + (x.flags.join('; ') || 'fine')).join(' | '),
    '2026-07: Still active, ended 2026-07-31 | 2026-11 A: 1 item due after it ends | 2026-10 B: Future, but its end date (2026-10-31) has passed');
  T.eq('…days left in the running one', sa.sprints[1].daysLeft, 9);
  T.eq('the sprint findings', sa.findings.filter((f) => /[Ss]print|carried/.test(f.text)).map((f) => f.tone + ': ' + f.text).join(' | '),
    'bad: Sprint 2026-07 is still active although it ended on 2026-07-31 (1 item open): close it and move the work on. | '
    + 'info: Sprint 2026-11 A: 1 of 2 done (50%), 9 days left. | warn: 1 future sprint has an end date already past (2026-10 B): the sprint plan is out of date. | '
    + 'warn: 1 open item was carried over from an earlier sprint.');
  T.eq('a sprint finding opens its items', J.filter(sp, sa.findings.filter((f) => /still active/.test(f.text))[0].filter).map((r) => r.key).join(), 'EQP-50,EQP-51');

  T.section('one sprint\'s report (its own tab)');
  const SB = (id, name, state, start, end) => ({ id, name, state, boardId: 3, startDate: start + 'T05:00:00.000Z', endDate: end + 'T05:00:00.000Z' });
  const s6 = SB(6, '2026-06', 'active', '2026-06-01', '2026-06-30');
  const s7 = SB(7, '2026-07', 'active', '2026-07-01', '2026-07-31');
  const s5 = SB(5, '2026-05', 'closed', '2026-05-01', '2026-05-31');
  const mk = (key, st, cat, sprints, resolved, due, who) => Object.assign(issue2(key, st, cat, sprints, due), {}, { fields: Object.assign(issue2(key, st, cat, sprints, due).fields,
    { resolutiondate: resolved ? resolved + 'T10:00:00.000-0500' : null, assignee: who === null ? null : { displayName: who || 'Rahul Kanth Panganamamula' } }) });
  const sr = [
    mk('EQP-60', 'Done', 'done', [s6], '2026-06-03', '2026-06-20'),
    mk('EQP-61', 'Done', 'done', [s5, s6], '2026-06-10', '2026-06-25', 'Aditi Rao'),
    mk('EQP-62', 'DEVELOPMENT', 'indeterminate', [s6, s7], null, '2026-07-20'),
    mk('EQP-63', 'TEST', 'indeterminate', [s6], null, '2026-07-15', null),
  ].map((i) => J.fromIssue(i, { today: TODAY }));
  T.eq('its JQL finds everything ever in it; its link in Jira', [J.sprintJql({ id: '6' }), J.sprintUrl('https://equiprite.atlassian.net', { id: '6', board: '3', state: 'active' })].join(' | '),
    'project = EQP AND sprint = 6 ORDER BY status ASC, key ASC | https://equiprite.atlassian.net/jira/software/projects/EQP/boards/3?sprint=6');
  T.eq('…a closed one opens its sprint report', J.sprintUrl('', { id: '5', board: '3', state: 'closed' }), 'https://equiprite.atlassian.net/jira/software/projects/EQP/boards/3/reports/sprint-retrospective?sprint=5');
  const rep6 = J.sprintReport(sr, { id: '6' }, TODAY);
  T.eq('the sprint as Jira has it', [rep6.sprint.name, rep6.sprint.state, rep6.sprint.start, rep6.sprint.end, rep6.sprint.board].join(' / '), '2026-06 / active / 2026-06-01 / 2026-06-30 / 3');
  T.eq('the numbers', JSON.stringify(plain(rep6.kpis)), JSON.stringify({ total: 4, done: 2, open: 2, donePct: 50, overdue: 2, carriedOut: 1, carriedIn: 1, unassigned: 1, days: 30, dayText: 'Ended 128 days ago' }));
  T.eq('each item: still here, done, or carried on (and to where)', rep6.rows.map((r) => r.key + ' ' + r.in + (r.sprintNow ? ' > ' + r.sprintNow : '') + (r.carriedIn ? ' (in)' : '')).join(' | '),
    'EQP-60 done | EQP-61 done (in) | EQP-62 moved > 2026-07 | EQP-63 here');
  T.eq('the burn-up: a day each, done by then', [rep6.burnup.length, rep6.burnup[0].day + ' ' + rep6.burnup[0].done, rep6.burnup[2].day + ' ' + rep6.burnup[2].done + ' ' + rep6.burnup[2].pct + '%',
    rep6.burnup[29].day + ' ' + rep6.burnup[29].done].join(' | '), '30 | 2026-06-01 0 | 2026-06-03 1 25% | 2026-06-30 2');
  T.eq('what is wrong with it', rep6.flags.join(' | '), 'Still active, ended 2026-06-30: close it in Jira and move what is open to the next sprint. | 2 open items are due after it ends.');
  T.eq('what it says', rep6.findings.map((f) => f.tone + ': ' + f.text).join(' | '),
    'info: 2 of 4 done (50%), ended 128 days ago. | warn: 1 item was carried on to a later sprint (2026-07). | info: 1 item came in from an earlier sprint. | '
    + 'bad: 2 items are past their due date. | warn: 1 open item has nobody assigned.');
  T.eq('by person', rep6.people.map((p) => p.name + ' ' + p.open + '/' + p.total).join(', '), 'Rahul Kanth Panganamamula 1/2, Nobody 1/1, Aditi Rao 0/1');

  T.section('images: the screenshots attached to comments and the description');
  const withImages = J.fromIssue({ key: 'EQP-196', fields: { summary: 'Business Unit & Organization Mapping', issuetype: { name: 'Story' }, status: status('DEVELOPMENT', 'indeterminate'),
    description: 'Map each BU to its yards.\n\n!bu-map.png|width=400!\n\nAcceptance Criteria: one yard per BU at least. FDD Section: 7.17',
    attachment: [{ id: 10501, filename: 'image-20261102-213121.png', mimeType: 'image/png', size: 48213, created: '2026-11-02T21:31:21.000-0500', author: { displayName: 'Rahul Kanth Panganamamula' } },
      { id: 10502, filename: 'Screenshot 2026-11-04 135139.png', mimeType: 'image/png', size: 2400000 }, { id: 10503, filename: 'bu-map.png', mimeType: 'image/png', size: 900 },
      { id: 10504, filename: 'mapping.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 12000 }],
    comment: { comments: [
      { author: { displayName: 'Rahul Kanth Panganamamula' }, created: '2026-11-02', body: 'Sub Inventory column added in the BU 2 Org mapping.\n\n!image-20261102-213121.png|width=650,alt="image-20261102-213121.png"!' },
      { author: { displayName: 'Sana Suhana Thehaseen' }, created: '2026-11-04', body: 'Sub Inv column is not yet added.\n\n!Screenshot 2026-11-04 135139.png|width=227,alt="Screenshot 2026-11-04 135139.png"!' }] } } },
  { today: TODAY });
  T.eq('a comment\'s text without the image markup', withImages.comments.map((c) => c.text).join(' | '), 'Sub Inventory column added in the BU 2 Org mapping. | Sub Inv column is not yet added.');
  T.eq('…and its images, matched to the attachments', withImages.comments.map((c) => c.images.map((i) => i.id + ' ' + i.name).join()).join(' | '),
    '10501 image-20261102-213121.png | 10502 Screenshot 2026-11-04 135139.png');
  T.eq('the description\'s image, and its text without it', [withImages.bodyImages.map((i) => i.id).join(), withImages.body].join(' / '), '10503 / Map each BU to its yards.');
  T.eq('every attachment, images marked, sizes in words', withImages.attachments.map((a) => a.name + ' ' + (a.image ? 'image' : 'file') + ' ' + a.sizeText).join(' | '),
    'image-20261102-213121.png image 47 KB | Screenshot 2026-11-04 135139.png image 2.3 MB | bu-map.png image 1 KB | mapping.xlsx file 12 KB');
  const imgCalls = [];
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const imgActions = { callRest: async (ctx, o) => { imgCalls.push(o); return o.uriParams.id === '10502' ? { ok: false, status: 404 } : { ok: true, status: 200, body: new Blob([PNG], { type: 'image/png' }) }; } };
  const imgs = await J.loadImages({}, imgActions, withImages);
  T.check('each image read through the jira connection as a file (redirect=false), the others not', imgCalls.length === 3
    && imgCalls.every((c) => c.endpoint === 'jira/getJiraAttachmentContent' && c.uriParams.redirect === false && c.responseBodyFormat === 'blob'));
  T.check('…shown from memory; one that could not be read is \'\'', /^blob:/.test(imgs['10501']) && imgs['10502'] === '' && /^blob:/.test(imgs['10503']) && !('10504' in imgs));
  await J.loadImages({}, imgActions, withImages);
  T.eq('…read once', imgCalls.length, 4);

  T.section('Old keeps the same file');
  const old = path.join(ROOT, 'webApps', 'vbredwoodapp', 'resources', 'js', 'jiraBacklog.js');
  T.check('webApps/vbredwoodapp/resources/js/jiraBacklog.js is identical', fs.existsSync(old) && fs.readFileSync(old, 'utf8') === fs.readFileSync(FILE, 'utf8'));
  T.report();
})();
