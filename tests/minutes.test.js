/*
 * The Standup minutes rules (webApps/equiprite-next/resources/js/minutes.js): the roll-ups that track minutes by Jira
 * story and by its epic and by customer, the open-action list, the formatted email and the Teams message, and the
 * prompt that cleans a note up with AI. Pure — loaded straight, no page, no DOM.
 *
 * Run:  node tests/minutes.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const FILE = path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js', 'minutes.js');
const sandbox = { console, Date, JSON, Math };
let M;
sandbox.define = (names, factory) => { M = factory(); };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'minutes.js' });

// The Jira backlog rows the page already read (jiraBacklog shape: key, summary, epicKey, epicName, labels, statusCat).
const ROWS = [
  { key: 'EQP-12', summary: 'Equipment Master List', epicKey: 'EQP-1', epicName: 'Equipment Registry', labels: ['cianbro'], statusCat: 'indeterminate' },
  { key: 'EQP-13', summary: 'Equipment Master Edit', epicKey: 'EQP-1', epicName: 'Equipment Registry', labels: ['cianbro', 'oceaneering'], statusCat: 'indeterminate' },
  { key: 'EQP-20', summary: 'Rate schedule list', epicKey: 'EQP-62', epicName: 'Rate & Pricing', labels: ['oceaneering'], statusCat: 'done' },
];
const MEETINGS = [
  { id: 'm1', date: '2026-11-09', time: '09:30', title: 'Daily standup', customer: 'Cianbro', attendees: ['Javeed', 'Rahul'], lines: [
    { jiraKey: 'EQP-12', text: 'Smart search still missing columns.', action: 'Add the missing filters', owner: 'Rahul', due: '2026-01-05', status: 'open' },
    { jiraKey: 'EQP-20', text: 'Rate list looks good.', action: 'Close the story', owner: 'Aditi', due: '2026-11-11', status: 'done' },
    { jiraKey: '', text: 'Agreed the release plan for 27A.', action: 'Circulate the plan', owner: 'Javeed', due: '2030-01-01', status: 'open' },
  ] },
  { id: 'm2', date: '2026-11-10', time: '09:30', title: 'Daily standup', customer: 'Oceaneering', attendees: ['Javeed'], lines: [
    { jiraKey: 'EQP-13', text: 'Edit screen save fails on unique name.', action: 'Fix the validation', owner: 'Rahul', due: '2026-11-25', status: 'open' },
    { jiraKey: 'EQP-12', text: 'Type column added, map view still open.', action: '', owner: '', due: '', status: 'open' },
  ] },
];

T.section('a blank meeting and line are dated today and sensible');
T.check('blankMeeting has today, a title and no lines', /^\d{4}-\d{2}-\d{2}$/.test(M.blankMeeting().date) && M.blankMeeting().title && M.blankMeeting().lines.length === 0);
T.check('blankLine is generic and open', M.blankLine().generic === true && M.blankLine().status === 'open');

T.section('summarise a meeting');
const su = M.summarise(MEETINGS[0]);
T.eq('lines, linked, generic, open actions', [su.lines, su.linked, su.generic, su.openActions].join('/'), '3/2/1/2');

T.section('track by Jira story (the full history per story)');
const st = M.stories(MEETINGS, ROWS);
T.eq('one row per story, most open actions first', st.map((s) => s.key).join(','), 'EQP-12,EQP-13,EQP-20');
const s12 = st.find((s) => s.key === 'EQP-12');
T.eq('EQP-12 spans both meetings, named from the backlog', s12.name + ' · ' + s12.meetings + ' meetings · ' + s12.lines + ' lines', 'EQP-12 Equipment Master List · 2 meetings · 2 lines');

T.section('roll up by epic (what the user tracks by)');
const ep = M.epics(MEETINGS, ROWS);
T.eq('epics named from the backlog, plus a General bucket for generic lines', ep.map((e) => e.name).sort().join(' | '),
  'EQP-1 Equipment Registry | EQP-62 Rate & Pricing | General (no story)');
const e1 = ep.find((e) => e.key === 'EQP-1');
T.eq('the Equipment Registry epic gathers EQP-12 and EQP-13 lines', e1.lines + ' lines, ' + e1.openActions + ' open actions', '3 lines, 2 open actions');

T.section('roll up by customer (entered on the meeting)');
const cu = M.customers(MEETINGS);
T.eq('a group per customer', cu.map((c) => c.name).sort().join(','), 'Cianbro,Oceaneering');

T.section('every open action item, earliest due first, overdue flagged');
const oa = M.openActions(MEETINGS);
T.eq('open actions only (done excluded), earliest due first', oa.map((a) => a.action).join(' | '), 'Add the missing filters | Fix the validation | Circulate the plan');
T.check('the past-due one is flagged overdue, the future one is not', oa[0].overdue === true && oa[2].overdue === false);

T.section('a formatted minutes email');
const em = M.emailFor(MEETINGS[0], ROWS);
T.check('the subject names the meeting, date and customer', em.subject === '[Standup] Daily standup — 2026-11-09 · Cianbro');
T.check('the HTML has the header, a story heading, and an action-items table', em.html.indexOf('Standup minutes') !== -1
  && em.html.indexOf('EQP-12 — Equipment Master List') !== -1 && em.html.indexOf('Next action items') !== -1 && em.html.indexOf('Add the missing filters') !== -1);
T.check('the plain-text fallback lists discussion and next actions', em.text.indexOf('DISCUSSION') !== -1 && em.text.indexOf('NEXT ACTIONS') !== -1 && em.text.indexOf('[EQP-12]') !== -1);

T.section('a Teams message');
const tm = M.teamsFor(MEETINGS[0], ROWS);
T.check('Markdown with a heading, discussion and next actions', tm.text.indexOf('## ') === 0 && tm.text.indexOf('**Discussion**') !== -1 && tm.text.indexOf('**Next actions**') !== -1 && tm.text.indexOf('**EQP-12**') !== -1);

T.section('the AI format prompt cleans up a note without inventing anything');
const fp = M.formatPrompt('map not loading n edit btn doesnt work');
T.check('a system instruction and the raw note as the user turn', /simple|clear/i.test(fp.system) && fp.user === 'map not loading n edit btn doesnt work');

T.report();
