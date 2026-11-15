#!/usr/bin/env node
'use strict';
/**
 * What changed, marked in Page code (desktop/lib/pages.js code()/codeFile().changes; resources/js/codeView.js), with real
 * git: a page in a project with an origin —
 *   - nothing changed: said so, no file marked
 *   - a line changed, one added, one taken away (not saved in git yet): each found, at its line, counted; the file marked
 *     in the list (+n −n); committed but not pushed: still shown (it is not in what the remote has)
 *   - your workspace (o.baseFn: VB Studio's branch, named): compared with that; a base that is not there → the remote
 *   - not in git: nothing said
 *   - the viewer: added / changed / taken-away lines and Code fix's change notes marked, the change gone to outlined
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const P = require('../desktop/lib/pages');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const PAGE = 'webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page';
const ID = 'vbredwoodapp/customer-portal/customer-my-billing';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const copyDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); fs.readdirSync(from).forEach((f) => { const a = path.join(from, f), b = path.join(to, f); if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b); }); };
// the code viewer (an AMD module of the app)
let CV;
new Function('define', fs.readFileSync(path.join(ROOT, 'webApps/equiprite-next/resources/js/codeView.js'), 'utf8'))((deps, f) => { CV = f(); });

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-code-chg-'));
  try {
    const origin = path.join(tmp, 'origin.git'), A = path.join(tmp, 'project');
    git(tmp, 'init', '-q', '--bare', '-b', 'dev-one', origin);
    fs.mkdirSync(A); git(A, 'init', '-q', '-b', 'dev-one');
    git(A, 'config', 'user.name', 'Tester'); git(A, 'config', 'user.email', 'tester@example.com'); git(A, 'config', 'core.autocrlf', 'false');
    ['.json', '.js', '.html'].forEach((x) => { fs.mkdirSync(path.dirname(path.join(A, PAGE)), { recursive: true }); fs.copyFileSync(path.join(ROOT, PAGE + x), path.join(A, PAGE + x)); });
    copyDir(path.join(ROOT, PAGE + '-chains'), path.join(A, PAGE + '-chains'));
    fs.copyFileSync(path.join(ROOT, 'webApps/vbredwoodapp/app-flow.json'), path.join(A, 'webApps/vbredwoodapp/app-flow.json'));
    fs.copyFileSync(path.join(ROOT, 'webApps/vbredwoodapp/flows/customer-portal/customer-portal-flow.json'), path.join(A, 'webApps/vbredwoodapp/flows/customer-portal/customer-portal-flow.json'));
    fs.writeFileSync(path.join(A, PAGE + '.html'), fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8').replace(/\r\n/g, '\n'));
    git(A, 'add', '-A'); git(A, 'commit', '-q', '-m', 'workspace'); git(A, 'remote', 'add', 'origin', origin); git(A, 'push', '-q', '-u', 'origin', 'dev-one');

    let base = null;
    const st = P.open({ root: A, baseFn: () => base });
    const HTML = PAGE + '.html';

    T.section('nothing changed');
    const c0 = st.code(ID), f0 = st.codeFile(ID, HTML);
    T.check('no file marked; the file: no change since the remote (origin/dev-one)', c0.ok && !c0.files.some((f) => f.changed) && c0.base === 'origin/dev-one'
      && f0.ok && f0.changes && f0.changes.regions.length === 0 && f0.changes.base === 'origin/dev-one' && !f0.changes.isNew, JSON.stringify(f0.changes));

    T.section('a line changed, one added, one taken away — not in git yet');
    const L = fs.readFileSync(path.join(A, HTML), 'utf8').split('\n');
    L[4] = L[4] + ' <!-- changed -->';             // line 5 changed
    L.splice(10, 0, '<p>an added line</p>');       // line 11 added
    L.splice(20, 1);                               // was line 20 (now after line 20 in the new file… see below), taken away
    fs.writeFileSync(path.join(A, HTML), L.join('\n'));
    const f1 = st.codeFile(ID, HTML);
    const r = (f1.changes && f1.changes.regions) || [];
    T.check('each change at its line: changed (5), added (11), taken away (after line 20); counted +2 −2', r.length === 3 && r[0].kind === 'changed' && r[0].from === 5 && r[0].to === 5
      && r[1].kind === 'added' && r[1].from === 11 && r[1].to === 11 && r[2].kind === 'removed' && r[2].from === 20 && r[2].was === 1 && f1.changes.added === 2 && f1.changes.removed === 2, JSON.stringify(r));
    const c1 = st.code(ID);
    const fh = c1.files.filter((f) => f.path === HTML)[0];
    T.check('…the file marked in the list (+2 −2); its other files not', fh.changed && fh.changed.added === 2 && fh.changed.removed === 2 && c1.files.filter((f) => f.changed).length === 1, JSON.stringify(fh));
    git(A, 'commit', '-q', '-am', 'local change');
    T.check('committed here but not pushed: still shown (the remote does not have it)', st.codeFile(ID, HTML).changes.regions.length === 3);

    T.section('your workspace: against VB Studio\'s branch');
    base = { ref: 'origin/dev-one', label: 'VB Studio (dev-one)' };
    const f2 = st.codeFile(ID, HTML);
    T.check('named VB Studio (its branch)', f2.changes.base === 'VB Studio (dev-one)' && f2.changes.regions.length === 3 && st.code(ID).base === 'VB Studio (dev-one)');
    base = { ref: 'origin/not-there', label: 'VB Studio (not-there)' };
    T.check('…a branch not fetched (not there): the branch\'s remote instead', st.codeFile(ID, HTML).changes.base === 'origin/dev-one');
    git(A, 'push', '-q', 'origin', 'dev-one');
    base = { ref: 'origin/dev-one', label: 'VB Studio (dev-one)' };
    T.check('pushed to VB Studio: no change since it', st.codeFile(ID, HTML).changes.regions.length === 0);

    T.section('not in git');
    const plain = path.join(tmp, 'plain');
    copyDir(path.join(A, 'webApps'), path.join(plain, 'webApps'));
    const sp = P.open({ root: plain });
    T.check('nothing said (no changes to show)', sp.codeFile(ID, HTML).ok && sp.codeFile(ID, HTML).changes === null && !sp.code(ID).files.some((f) => f.changed) && sp.code(ID).base === '');

    T.section('the viewer marks them');
    const text = ['<div>', '<!-- Code fix change fx1abc — My Billing', '     Request:      a note', '     Jira story:   EQP-1 -->', '<p>new</p>', '<!-- end of Code fix change fx1abc -->', '<span>x</span>', '</div>', ''].join('\n');
    const marks = { base: 'VB Studio (dev-one)', regions: [{ from: 2, to: 6, kind: 'added' }, { from: 7, to: 7, kind: 'changed' }, { from: 8, to: 8, kind: 'removed', was: 2 }] };
    const html = CV.doc(text, 'p.html', '', marks, 1);
    const cls = (n) => (new RegExp('<div class="l([^"]*)" id="L' + n + '"').exec(html) || [])[1] || '';
    T.check('added lines (+, green), the changed one (~, amber), a red line where lines were taken away', / ca/.test(cls(5)) && /<i class="sg">\+<\/i>5/.test(html) && / cm/.test(cls(7)) && /<i class="sg">~<\/i>7/.test(html)
      && / cd/.test(cls(8)) && !/ c[amd]/.test(cls(1)), [1, 5, 7, 8].map(cls).join(' | '));
    T.check('…Code fix\'s change note (its lines and its end) tinted; the change gone to outlined', / bn/.test(cls(2)) && / bn/.test(cls(3)) && / bn/.test(cls(4)) && / bn/.test(cls(6)) && !/ bn/.test(cls(5))
      && / cur/.test(cls(7)) && !/ cur/.test(cls(5)), [2, 3, 4, 5, 6, 7].map(cls).join(' | '));
    const js = ['x();', '// Code fix change fx2 — Page', '// Request:      r', '// Issue:        —', 'y();', '// a comment of its own', ''].join('\n');
    const nl = CV.noteLines(js);
    T.check('…in JavaScript too (its // lines), not a comment of its own after it; the line of a change to go to', nl[2] && nl[3] && nl[4] && !nl[5] && !nl[6] && CV.changeLine(marks, 2) === 8 && CV.changeLine({ regions: [{ from: 0, kind: 'removed' }] }, 0) === 1);
    T.check('…no marks: as before', CV.doc('a\nb', 'x.js', '') === CV.doc('a\nb', 'x.js', '', null, -1) && !/ ca| cm/.test(CV.doc('a\nb', 'x.js', '')));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
