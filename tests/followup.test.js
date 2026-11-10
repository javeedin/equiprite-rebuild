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

T.section('composeHtml / composeText');
const html = F.composeHtml({ message: F.message(ROWS, 'close'), signoff: 'Thanks,\nJaveed', rows: ROWS, kind: 'stories' });
T.check('the email has the greeting, the table, the sign-off', html.includes('Dear Rahul and Nabil,') && html.includes('<table') && html.includes('Thanks,'));
T.check('the summary is escaped inside the table', html.includes('Picking Exception &lt;Handling&gt;'));
T.check('no stray item-count line (showCount off)', !/\b2 items\b/.test(html));
const txt = F.composeText({ message: F.message(ROWS, 'close'), signoff: 'Thanks,', rows: ROWS, kind: 'stories' });
T.check('the plain text has the message, a tab-separated table, the sign-off', txt.includes('kindly close') && txt.includes('\t') && txt.trim().endsWith('Thanks,'));

T.section('mailtoHref');
const href = F.mailtoHref({ to: 'a@b.com; c@d.com', subject: 'Please close these stories', message: 'Dear all,', signoff: 'Thanks,' });
T.check('a mailto with the recipients and subject', href.startsWith('mailto:') && href.includes(encodeURIComponent('a@b.com; c@d.com')) && href.includes(encodeURIComponent('Please close these stories')));
T.check('the body tells them the table is on the clipboard', decodeURIComponent(href).includes('press Ctrl+V'));

T.report();
