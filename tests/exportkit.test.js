/*
 * exportKit (resources/js/exportKit.js): the "Copy to follow-up" email table and the rich clipboard copy, plus a
 * sanity check of the existing CSV/TSV helpers. followupHtml builds an email-ready HTML table (every style inline,
 * the Key as a link, an overdue date red); run('followup') puts both text/html and text/plain on the clipboard.
 *
 * Run:  node tests/exportkit.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const FILE = path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js', 'exportKit.js');

// A fake clipboard so run('followup') can be exercised without a browser: ClipboardItem keeps what it was handed, and
// navigator.clipboard.write records the item. Blob is Node's global (18+); we only need its constructor to exist.
let written = null;
function FakeClipboardItem(parts) { this.parts = parts; }
const sandbox = {
  console, Date, JSON, Math, Promise, Blob, URL, TextEncoder,
  navigator: { clipboard: { write: (items) => { written = items; return Promise.resolve(); } } },
  window: { ClipboardItem: FakeClipboardItem },
};
let K;
sandbox.define = (names, factory) => { K = factory(); };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'exportKit.js' });

const ROWS = [
  { key: 'EQP-12', summary: 'Master list <view>', status: 'In progress', assignee: 'Asha', due: '2026-01-01', overdue: true, url: 'https://j/EQP-12' },
  { key: 'EQP-13', summary: 'Reports & "KPIs"', status: 'Done', assignee: '', due: '', overdue: false, url: 'https://j/EQP-13' },
];
const COLS = [
  { key: 'key', label: 'Key', href: (r) => r.url },
  { key: 'summary', label: 'Summary' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee', value: (r) => r.assignee || 'Nobody' },
  { key: 'due', label: 'Due', value: (r) => r.due || '—', tone: (r) => (r.overdue ? 'bad' : '') },
];

T.section('followupHtml — structure');
const html = K.followupHtml({ title: 'Follow-up — Sprint 2026-06', subtitle: 'active', when: 'today', rows: ROWS, columns: COLS });
T.check('is one <table>', (html.match(/<table/g) || []).length === 1);
T.check('a header cell per column', (html.match(/<th /g) || []).length === COLS.length);
T.check('a body row per item', (html.match(/<tr/g) || []).length === 1 + ROWS.length); // header row + data rows
T.check('the title shows', html.indexOf('Follow-up — Sprint 2026-06') >= 0);
T.check('shows the item count', html.indexOf('2 items') >= 0);

T.section('followupHtml — cells');
T.check('Key is a link to Jira', html.indexOf('href="https://j/EQP-12"') >= 0);
T.check('styles are inline (email-safe), no class', html.indexOf('style="') >= 0 && html.indexOf('class=') < 0);
T.check('no <style> block (clients drop it)', html.toLowerCase().indexOf('<style') < 0);
T.check('HTML in a summary is escaped', html.indexOf('Master list &lt;view&gt;') >= 0 && html.indexOf('<view>') < 0);
T.check('quotes in a summary are escaped', html.indexOf('&quot;KPIs&quot;') >= 0);
T.check('an empty assignee reads Nobody', html.indexOf('Nobody') >= 0);
T.check('an overdue date is coloured red', html.indexOf('#b91c1c') >= 0);

T.section('followupHtml — intro, sign-off, count');
const wrapped = K.followupHtml({ intro: '<p>Dear Rahul,</p>', signoff: '<p>Thanks,</p>', rows: ROWS, columns: COLS, showCount: false });
T.check('the intro comes before the table', wrapped.indexOf('Dear Rahul,') < wrapped.indexOf('<table') && wrapped.indexOf('<table') > 0);
T.check('the sign-off comes after the table', wrapped.indexOf('Thanks,') > wrapped.lastIndexOf('</table>'));
T.check('showCount:false hides the item-count line', !/\b2 items\b/.test(wrapped));
T.check('showCount default keeps the item-count line', /\b2 items\b/.test(K.followupHtml({ rows: ROWS, columns: COLS })));

T.section("run('followup') — the clipboard");
let result = null;
K.run('followup', { title: 'T', rows: ROWS, columns: COLS }).then((r) => { result = r; });

setTimeout(() => {
  T.check('resolves ok', !!result && result.ok === true, result && result.message);
  T.check('message counts items', !!result && /2 items/.test(result.message));
  T.check('wrote one ClipboardItem', Array.isArray(written) && written.length === 1);
  T.check('wrote text/html', !!written && !!written[0].parts['text/html']);
  T.check('wrote text/plain too', !!written && !!written[0].parts['text/plain']);

  T.section('run — empty and existing formats');
  K.run('csv', { name: 'x', rows: ROWS, columns: COLS }); // smoke: no throw
  const tsv = K.tsv(ROWS, COLS);
  T.check('tsv has a header line and two rows', tsv.split('\n').length === 3);
  T.check('tsv is tab-separated', tsv.split('\n')[1].indexOf('\t') >= 0);

  T.report();
}, 50);
