/*
 * followup (resources/js/followup.js): the "Copy to follow-up" / "Open in Outlook" compose helpers on the Jira pages —
 * the greeting that names the assignees, the ready email bodies, the composed email (message + stories table + sign-off)
 * and the mailto link. The table itself is exportKit.followupHtml (tested in exportkit.test.js).
 *
 * Run:  node tests/followup.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js');

function load(name, deps) {
  const sandbox = { console, Date, JSON, Math, Promise, Blob, URL, TextEncoder };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}
const exportKit = load('exportKit');
const F = load('followup', { 'resources/js/exportKit': exportKit });

const ROWS = [
  { key: 'EQP-144', summary: 'Picking Exception <Handling>', status: 'DEVELOPMENT', assignee: 'Rahul Kanth Panganamamula', due: '2026-06-30', overdue: true, url: 'https://j/EQP-144', in: 'here', labels: ['cianbro'] },
  { key: 'EQP-205', summary: 'Rental Agreement', status: 'DEVELOPMENT', assignee: 'nabil.khan', due: '2026-06-30', overdue: true, url: 'https://j/EQP-205', in: 'here', labels: ['oceaneering'] },
];

T.section('firstName & greeting');
T.eq('a dotted username → first name', F.firstName('nabil.khan'), 'Nabil');
T.eq('a full name → first name', F.firstName('Rahul Kanth Panganamamula'), 'Rahul');
T.eq('nobody / empty → nothing', F.firstName('Nobody') + '|' + F.firstName(''), '|');
T.eq('greeting names the assignees in row order', F.greeting(ROWS), 'Dear Rahul and Nabil,');
T.eq('one assignee', F.greeting([ROWS[0]]), 'Dear Rahul,');
T.eq('three → comma then and', F.greeting([{ assignee: 'Alpha' }, { assignee: 'Beta' }, { assignee: 'Gamma' }]), 'Dear Alpha, Beta and Gamma,');
T.eq('nobody assigned → Dear all', F.greeting([{ assignee: '' }, { assignee: 'Nobody' }]), 'Dear all,');
T.eq('too many to name → Dear all', F.greeting([{ assignee: 'a a' }, { assignee: 'b b' }, { assignee: 'c c' }, { assignee: 'd d' }, { assignee: 'e e' }]), 'Dear all,');

T.section('templates');
T.check('at least seven, each has a subject', F.TEMPLATES.length >= 7 && F.TEMPLATES.every((t) => !!t.subject && !!t.key));
T.check('the sample "ask to close" template exists', F.TEMPLATES.some((t) => t.key === 'close' && /close the following stories/i.test(t.body)));
T.check('a blank template to write your own', F.TEMPLATES.some((t) => t.key === 'blank' && t.body === ''));
T.check('message() is greeting + the chosen body', F.message(ROWS, 'close').startsWith('Dear Rahul and Nabil,') && /kindly close/.test(F.message(ROWS, 'close')));

T.section('columns');
T.check('sprint columns include where it stands', F.columns('sprint').some((c) => c.key === 'in'));
T.check('stories columns include the Customer label', F.columns('stories').some((c) => c.key === 'labels' && c.label === 'Customer'));
T.check('the Key column links to the story', typeof F.columns('stories')[0].href === 'function' && F.columns('stories')[0].href(ROWS[0]) === 'https://j/EQP-144');

T.section('introHtml (message → email paragraphs)');
const intro = F.introHtml('Dear Nabil,\n\nPlease close these.\nThanks');
T.check('a paragraph per blank line, a break for a single newline', (intro.match(/<p /g) || []).length === 2 && intro.includes('<br>'));
T.check('text is HTML-escaped', F.introHtml('a <b> & "c"').includes('&lt;b&gt;') && !F.introHtml('a <b>').includes('<b>'));
T.eq('empty message → nothing', F.introHtml('   '), '');

T.section('headerText / composeHtml / composeText');
T.eq('headerText: title, subtitle, N items · when', F.headerText({ title: 'T', subtitle: 'S', when: 'W', rows: ROWS }), 'T\nS\n2 items · W');
const OPTS = { title: 'Follow-up — Sprint 2026-06', subtitle: 'active · 2026-06-01 – 2026-06-30', when: '11/10/2026, 10:43:47 PM',
  message: F.message(ROWS, 'close'), signoff: 'Thanks,\nJaveed', rows: ROWS, kind: 'stories' };
const html = F.composeHtml(OPTS);
T.check('the email header: title, subtitle, and the count with the timestamp', html.includes('Follow-up — Sprint 2026-06')
  && html.includes('active · 2026-06-01') && html.includes('2 items · 11/10/2026, 10:43:47 PM'));
T.check('then the greeting, the table and the sign-off', html.includes('Dear Rahul and Nabil,') && html.includes('<table') && html.includes('Thanks,'));
T.check('the summary is escaped inside the table', html.includes('Picking Exception &lt;Handling&gt;'));
const txt = F.composeText(OPTS);
T.check('plain text: the header, the message, a tab-separated table, the sign-off', txt.includes('Follow-up — Sprint 2026-06')
  && txt.includes('2 items · 11/10/2026') && txt.includes('kindly close') && txt.includes('\t') && txt.trim().endsWith('Javeed'));

T.section('ascii (mailto-safe punctuation)');
T.eq('folds em/en dash, middot and curly quotes to ASCII', F.ascii('A — B · C – today’s “x”'), 'A -- B - C - today\'s "x"');

T.section('tableHtml / tableText (table only, for Open in Outlook)');
const tonly = F.tableHtml({ rows: ROWS, kind: 'stories' });
T.check('just the stories table with its Customer column', tonly.includes('<table') && tonly.includes('Customer'));
T.check('no greeting or header leaking into the table-only html', !tonly.includes('Dear ') && !/Follow-up/.test(tonly));
T.check('tableText is a tab-separated table', F.tableText({ rows: ROWS, kind: 'stories' }).split('\n').length === 3);

T.section('mailtoHref');
const href = F.mailtoHref({ to: 'a@b.com; c@d.com', subject: 'Please close these stories', title: 'Follow-up — Sprint 2026-06', subtitle: 'active', when: 'now', message: 'Dear all,', signoff: 'Thanks,', rows: ROWS });
T.check('a mailto with the recipients and subject', href.startsWith('mailto:') && href.includes(encodeURIComponent('a@b.com; c@d.com')) && href.includes(encodeURIComponent('Please close these stories')));
const decoded = decodeURIComponent(href);
T.check('the body is plain ASCII (no em dash / middot that Outlook would mojibake)',
  !/[—–·‘’“”]/.test(decoded) && decoded.includes('Follow-up -- Sprint 2026-06') && decoded.includes('press Ctrl+V'));

T.report();
