#!/usr/bin/env node
'use strict';
/**
 * Change notes (desktop/lib/changeNote.js): the comment Code fix writes into the code beside each change — what was
 * asked, who asked and when, who changed it and when, the issue and the Jira story, the change's id — in the file's own
 * comment syntax and only where a comment may stand:
 *   - HTML: before the changed line; a change inside a tag (an attribute) → before the line the tag starts on; inside a
 *     comment → before it; inside <style>/<script> → a CSS/JS comment; inside <textarea> → none
 *   - JavaScript: // lines (never inside a template or a string); CSS: a block comment; JSON: never touched
 *   - the first change gets the whole note, each other one a line pointing to it; indented like its line
 *   - each change bracketed: "end of Code fix change …" after it (after the tag's last line, for an attribute)
 *   - what could end a comment early is made harmless; the time is this PC's, its offset said
 */
process.env.TZ = 'Asia/Riyadh'; // UTC+03:00 (no daylight saving): the note's times
const vm = require('vm');
const H = require('./_harness');
const CN = require('../desktop/lib/changeNote');

const T = H.makeAsserter();
const META = { id: 'fx1abc2', page: 'Customer Dashboard', request: 'Put 26C in the page title -- before the go-live', kind: 'Change', askedBy: 'priya.raman', askedAt: '2026-11-14T21:30:00Z',
  changedBy: 'arun.mehta', changedAt: '2026-11-14T21:41:00Z', how: 'approved and applied in Code fix', proposedBy: 'Stand-in AI (test)', issue: 'ISS-12', jira: 'EQP-123', also: ['customer-dashboard-page.json'] };
const lineOps = (a, b) => { // the simplest line diff for a test: common prefix and suffix, one change between
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return a.slice(0, s).map((x) => [' ', x]).concat(a.slice(s, a.length - e).map((x) => ['-', x]), b.slice(s, b.length - e).map((x) => ['+', x]), a.slice(a.length - e).map((x) => [' ', x]));
};
const linesOf = (t) => t.split('\n');

T.section('the note: every fact asked for');
const full = CN.lines(META);
T.check('the change\'s id and page; the request and its kind; who asked and when; who changed it, when and how; who proposed it; the issue; the Jira story; JSON changed beside it',
  full[0] === 'Code fix change fx1abc2 — Customer Dashboard' && /^Request: +Put 26C in the page title -- before the go-live \(Change\)$/.test(full[1])
  && /^Requested by: priya\.raman on 15 Nov 2026 at 00:30 \(UTC\+03:00\)$/.test(full[2]) && /^Changed by: +arun\.mehta on 15 Nov 2026 at 00:41 \(UTC\+03:00\) — approved and applied in Code fix$/.test(full[3])
  && /^Proposed by: +Stand-in AI \(test\)$/.test(full[4]) && /^Issue: +ISS-12$/.test(full[5]) && /^Jira story: +EQP-123$/.test(full[6]) && /^Also changed: customer-dashboard-page\.json \(JSON files cannot hold comments\)$/.test(full[7]), full.join(' | '));
const bare = CN.lines({ id: 'fx9', request: 'x', askedBy: 'a', askedAt: '2026-11-14T21:30:00Z', changedBy: 'b', changedAt: '2026-11-14T21:31:00Z' });
T.check('no issue or Jira story given: said so (—), not left out', bare.some((l) => /^Issue: +—$/.test(l)) && bare.some((l) => /^Jira story: +—$/.test(l)) && !bare.some((l) => /^Also changed/.test(l)), bare.join(' | '));
T.check('a long request is cut to one line', CN.lines(Object.assign({}, META, { request: 'a\nb ' + 'x'.repeat(400) }))[1].length < 200);

T.section('HTML');
const page = ['<!--', '  Customer Dashboard', '-->', '<style>', '  .a { color: red; }', '</style>', '', '<oj-sp-general-overview-page', '  page-title="customer dashboard"', '  page-subtitle="Manage">',
  '  <div slot="main">', '    <h3>Recent</h3>', '    <textarea>notes</textarea>', '  </div>', '</oj-sp-general-overview-page>', ''].join('\n');
const attr = CN.annotate('webApps/app/flows/f/pages/customer-dashboard-page.html', page, page.replace('customer dashboard"', 'customer dashboard 26C"'), META, lineOps);
const A = linesOf(attr.text);
const tagAt = A.indexOf('<oj-sp-general-overview-page');
T.check('a change inside a tag (its page-title attribute): the note before the line the tag starts on, not between its attributes', attr.notes === 1 && /^<!-- Code fix change fx1abc2 — Customer Dashboard$/.test(A[tagAt - 8]) && / -->$/.test(A[tagAt - 1])
  && A[tagAt + 1] === '  page-title="customer dashboard 26C"', A.slice(tagAt - 9, tagAt + 2).join('\n'));
T.check('…"--" (which could end the comment early) made harmless, <> too; the rest of the page as it was', !/--(?!>)/.test(A.slice(tagAt - 8, tagAt).join('\n').replace(/^<!--/, '')) && /Put 26C in the page title — before the go-live/.test(attr.text)
  && attr.text.replace(/<!-- Code fix[\s\S]*? -->\n/, '').replace('<!-- end of Code fix change fx1abc2 -->\n', '') === page.replace('customer dashboard"', 'customer dashboard 26C"'));
T.check('…bracketed: "end of Code fix change" after the line the tag ends on (not between its attributes)', A[A.indexOf('  page-subtitle="Manage">') + 1] === '<!-- end of Code fix change fx1abc2 -->' && attr.ends === 1, A.slice(tagAt, tagAt + 5).join('\n'));
const txt = CN.annotate('p.html', page, page.replace('<h3>Recent</h3>', '<h3>Recent requests</h3>'), META, lineOps);
const B = linesOf(txt.text), h3 = B.indexOf('    <h3>Recent requests</h3>');
T.check('a change between tags: the note right before it and its end right after, indented like it', /^    <!-- Code fix change fx1abc2/.test(B[h3 - 8]) && /^         Request:/.test(B[h3 - 7]) && / -->$/.test(B[h3 - 1])
  && B[h3 + 1] === '    <!-- end of Code fix change fx1abc2 -->', B.slice(h3 - 8, h3 + 2).join('\n'));
const cmt = CN.annotate('p.html', page, page.replace('  Customer Dashboard', '  Customer Dashboard (26C)'), META, lineOps);
T.check('a change inside a comment: the note before that comment and its end after it (never inside it)', /^<!-- Code fix change/.test(linesOf(cmt.text)[0]) && cmt.text.indexOf('<!--\n  Customer Dashboard (26C)\n-->\n<!-- end of Code fix change fx1abc2 -->\n<style>') > 0, linesOf(cmt.text).slice(0, 14).join('\n'));
const css = CN.annotate('p.html', page, page.replace('color: red', 'color: blue'), META, lineOps);
const Cl = linesOf(css.text), rule = Cl.indexOf('  .a { color: blue; }');
T.check('inside <style>: CSS comments, before and after (an HTML one would be read as CSS)', /^  \/\* Code fix change fx1abc2/.test(Cl[rule - 8]) && / \*\/$/.test(Cl[rule - 1]) && !/<!--/.test(Cl.slice(rule - 8, rule).join(''))
  && Cl[rule + 1] === '  /* end of Code fix change fx1abc2 */' && Cl[rule + 2] === '</style>', Cl.slice(rule - 8, rule + 3).join('\n'));
const box = '<div>\n  <textarea>first line\nsecond line</textarea>\n</div>\n';
const ta = CN.annotate('p.html', box, box.replace('second line', 'second line, changed'), META, lineOps);
T.check('a line inside a <textarea>: no note (it would show in the box)', ta.notes === 0 && ta.skipped === 1 && ta.text === box.replace('second line', 'second line, changed'), ta.text);
const two = CN.annotate('p.html', page, page.replace('color: red', 'color: blue').replace('<h3>Recent</h3>', '<h3>Recent requests</h3>'), META, (a, b) => {
  // a real diff would see two changes: each kept apart
  const ops = []; for (let i = 0; i < a.length; i++) { if (a[i] === b[i]) ops.push([' ', a[i]]); else { ops.push(['-', a[i]]); ops.push(['+', b[i]]); } } return ops;
});
T.check('two changes in a file: the whole note at the first, a line pointing to it at the second', two.notes === 2 && (two.text.match(/Requested by:/g) || []).length === 1
  && /<!-- Code fix change fx1abc2 \(continued — see its note above\): Put 26C in the page title — before the go-live -->\n    <h3>Recent requests<\/h3>/.test(two.text), two.text);

T.section('JavaScript, CSS, JSON');
const js = ['define([], () => {', "  const tpl = `line one", 'line two`;', '  class PageModule {', '    total(a) { return a + 1; }', '  }', '  return PageModule;', '});', ''].join('\n');
const j1 = CN.annotate('m-page.js', js, js.replace('a + 1', 'a + 2'), META, lineOps);
const J = linesOf(j1.text), at = J.indexOf('    total(a) { return a + 2; }');
let parses = true; try { new vm.Script(j1.text); } catch (e) { parses = false; }
T.check('// lines before the change and after it, indented like it; the code still parses', j1.notes === 1 && /^    \/\/ Code fix change fx1abc2/.test(J[at - 8]) && /^    \/\/ Jira story: +EQP-123$/.test(J[at - 2])
  && J[at + 1] === '    // end of Code fix change fx1abc2' && parses, J.slice(at - 8, at + 2).join('\n'));
const j2 = CN.annotate('m-page.js', js, js.replace('line two`', 'line 2`'), META, lineOps);
T.check('a change inside a multi-line template: no note there (it would become part of the text)', j2.notes === 0 && j2.text === js.replace('line two`', 'line 2`'));
const sheet = '.a {\n  color: red;\n}\n';
const c1 = CN.annotate('x.css', sheet, sheet.replace('red', 'blue'), Object.assign({}, META, { request: 'end */ early' }), lineOps);
T.check('CSS: block comments (the note, its end); "*/" in the request cannot end it early', /^  \/\* Code fix change/.test(linesOf(c1.text)[1]) && (c1.text.match(/\*\//g) || []).length === 2 && /end \* \/ early/.test(c1.text)
  && /color: blue;\n  \/\* end of Code fix change fx1abc2 \*\/\n\}/.test(c1.text), c1.text);
const json = '{\n  "title": "Customer Dashboard"\n}\n';
const jn = CN.annotate('customer-dashboard-page.json', json, json.replace('Dashboard', 'Dashboard (26C)'), META, lineOps);
T.check('JSON: never touched (it has no comments)', jn.notes === 0 && jn.text === json.replace('Dashboard', 'Dashboard (26C)'));
const fresh = CN.annotate('new-page.html', null, '<div>new</div>\n', META);
T.check('a new file: the note at its top, its end at the bottom', /^<!-- Code fix change fx1abc2/.test(fresh.text) && /<div>new<\/div>\n<!-- end of Code fix change fx1abc2 -->\n$/.test(fresh.text) && fresh.notes === 1, fresh.text);
const cut = CN.annotate('p.html', page, page.replace('    <h3>Recent</h3>\n', ''), META, lineOps);
T.check('lines only taken away: the note where they were, no end (nothing left to bracket)', cut.notes === 1 && cut.ends === 0 && /-->\n    <textarea>notes<\/textarea>/.test(cut.text) && !/<h3>/.test(cut.text), cut.text.slice(-400));
T.check('nothing changed: nothing written', CN.annotate('p.html', page, page, META, lineOps).notes === 0);

T.report();
