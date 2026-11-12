#!/usr/bin/env node
'use strict';
/**
 * Code Fix (desktop/lib/codeFix.js), with real git (a project with a bare "origin"), a real page copied in, its own
 * small test, and a stand-in AI:
 *   - the answer: its headings and SEARCH/REPLACE edits (also in fences, a bold FILE), questions
 *   - an edit that does not fit → asked once more; a path outside the app refused; a rule broken → not usable
 *   - nothing written by analyze; the diff; the checks
 *   - apply: refused over uncommitted changes; pulls first (fast-forward); the code changed since → out of date;
 *     branches that both moved → said, and applied without pulling on request; line endings kept
 *   - the related test before and after: a failure the fix brings is new, one that was there before is not
 *   - undo puts the bytes back; apply again; commit and push
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const CF = require('../desktop/lib/codeFix');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const PAGE = 'webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page';
const ID = 'vbredwoodapp/customer-portal/customer-my-billing';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ident = (cwd) => { git(cwd, 'config', 'user.name', 'Tester'); git(cwd, 'config', 'user.email', 'tester@example.com'); git(cwd, 'config', 'core.autocrlf', 'false'); };
const copyDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); fs.readdirSync(from).forEach((f) => { const a = path.join(from, f), b = path.join(to, f); if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b); }); };

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fix-'));
  const remote = path.join(tmp, 'origin.git'), A = path.join(tmp, 'project'), B = path.join(tmp, 'other');
  try {
    // the project: one real page (its HTML with Windows line endings), its own small test, pushed to origin
    git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    fs.mkdirSync(A); git(A, 'init', '-q', '-b', 'main'); ident(A);
    ['.json', '.js'].forEach((x) => { fs.mkdirSync(path.dirname(path.join(A, PAGE)), { recursive: true }); fs.copyFileSync(path.join(ROOT, PAGE + x), path.join(A, PAGE + x)); });
    fs.writeFileSync(path.join(A, PAGE + '.html'), fs.readFileSync(path.join(ROOT, PAGE + '.html'), 'utf8').replace(/\r?\n/g, '\r\n'));
    copyDir(path.join(ROOT, PAGE + '-chains'), path.join(A, PAGE + '-chains'));
    fs.copyFileSync(path.join(ROOT, 'webApps/vbredwoodapp/app-flow.json'), path.join(A, 'webApps/vbredwoodapp/app-flow.json'));
    fs.copyFileSync(path.join(ROOT, 'webApps/vbredwoodapp/flows/customer-portal/customer-portal-flow.json'), path.join(A, 'webApps/vbredwoodapp/flows/customer-portal/customer-portal-flow.json'));
    fs.mkdirSync(path.join(A, 'tests'));
    fs.writeFileSync(path.join(A, 'tests', 'billing.test.js'), [
      "const fs = require('fs'); const path = require('path');",
      "const html = fs.readFileSync(path.join(__dirname, '..', 'webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page.html'), 'utf8');",
      "const fails = [];",
      "if (/BROKEN/.test(html)) fails.push('the page is not broken');",
      "if (fs.existsSync(path.join(__dirname, 'old-failure'))) fails.push('an old failure');",
      "console.log('passed: ' + (2 - fails.length) + '   failed: ' + fails.length);",
      "if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }", ''].join('\n'));
    git(A, 'add', '-A'); git(A, 'commit', '-q', '-m', 'project'); git(A, 'remote', 'add', 'origin', remote); git(A, 'push', '-q', '-u', 'origin', 'main');
    const html0 = fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8');
    const lines = html0.replace(/\r\n/g, '\n').split('\n');
    const anchor = lines.slice(1, 3).join('\n'); // two lines of the page's header comment
    const answer = (search, replace, extra) => ['## Summary', 'Add a note to the header comment.', '## How it works today', 'The page lists billed requests.', '## What changes', 'A comment line.',
      '## The change', '- `' + PAGE + '.html` — one comment line', '## After the change', 'Nothing visible.', '## Risks', 'None known', '## How to test', '1. Open My Billing.', '## Questions', 'None', '',
      'FILE: ' + PAGE + '.html', '<<<<<<< SEARCH', search, '=======', replace, '>>>>>>> REPLACE', extra || ''].join('\n');

    const replies = [];
    const sent = [];
    const ai = { chat: async (req) => { sent.push(req); const r = replies.shift(); return typeof r === 'string' ? { ok: true, text: r, provider: 'Stand-in AI', model: 'test' } : r; }, settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }) };
    let clock = Date.parse('2026-11-12T12:00:00Z');
    const store = CF.open({ root: A, file: path.join(tmp, 'data', 'code-fixes.json'), ai: ai, now: () => new Date(clock += 1000) });

    T.section('the answer: headings, edits, questions');
    const p = CF.parseAnswer('## Summary\nDo it.\n## Questions\nNone\n```\n**FILE:** `' + PAGE + '.html`\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n```\n');
    T.check('headings and an edit (in a fence, with a bold FILE)', p.sections.map((s) => s.title).join('|') === 'Summary|Questions' && p.edits.length === 1 && p.edits[0].file === PAGE + '.html' && p.edits[0].search === 'a' && p.edits[0].replace === 'b' && p.questions === '', JSON.stringify(p));
    T.check('questions are kept when there are some', CF.parseAnswer('## Summary\nx\n## Questions\nWhich date field?').questions === 'Which date field?');
    T.check('a path outside the app (or the project) is refused', !CF.safeRel(A, '../evil.js', 'vbredwoodapp') && !CF.safeRel(A, 'desktop/main.js', 'vbredwoodapp') && !CF.safeRel(A, 'webApps/equiprite/x.js', 'vbredwoodapp') && CF.safeRel(A, PAGE + '.html', 'vbredwoodapp') === PAGE + '.html');

    const warn = CF.oldAppWarnings(ROOT, 'vbredwoodapp', ['webApps/vbredwoodapp/flows/customer-portal/pages/project-create-request-page.html']);
    T.check('Old EquipRite: a change outside the files its guard agrees to is warned (⚠, not blocking); its guard test runs with the fix', warn.length === 1 && warn[0].warn && /AGREED list/.test(warn[0].detail)
      && CF.oldAppWarnings(ROOT, 'vbredwoodapp', ['webApps/vbredwoodapp/flows/setup/pages/jira-stories-page.html']).length === 0 && CF.oldAppWarnings(ROOT, 'equiprite', ['webApps/equiprite/x.html']).length === 0
      && CF.relatedTests(ROOT, { app: 'vbredwoodapp', flow: 'customer-portal', page: 'project-create-request' }).unit[0] === 'tests/old-app-unchanged.test.js');

    T.section('analyze: nothing written; an edit that does not fit is asked again');
    const info = await store.info();
    T.check('info: the folder, its branch and upstream, the AI', info.ok && info.valid && info.isDefault && info.branch === 'main' && info.upstream === 'origin/main' && info.ai.ready && info.ai.provider === 'Stand-in AI', JSON.stringify(info));
    replies.push(answer('this line is not in the page', '<!-- x -->'), answer(anchor, anchor + '\n  Code fix: a note.'));
    const a1 = await store.analyze({ id: ID, request: 'Add a note to the header comment', kind: 'change', by: 'Asha' });
    const f1 = a1.fix;
    T.check('asked twice (the first SEARCH did not fit), then proposed', a1.ok && f1.retried && f1.status === 'proposed' && sent.length === 2 && /IT COULD NOT BE USED/.test(sent[1].user) && /SEARCH is not in the file/.test(sent[1].user), JSON.stringify([a1.error, f1 && f1.status, f1 && f1.problems]));
    T.check('the AI was given the request, the rules, the facts and the page\'s complete files', /REQUEST \(Change\):\nAdd a note/.test(sent[0].user) && /PAGE My Billing/.test(sent[0].user) && /===== FILE webApps\/vbredwoodapp\/flows\/customer-portal\/pages\/customer-my-billing-page\.html/.test(sent[0].user)
      && /-page-chains\/BilledRequestInitChain\.js/.test(sent[0].user) && /No oj-bind-for-each inside <table>/.test(sent[0].system) && sent[0].maxTokens >= 8000);
    T.check('the diff: one line added, with lines around it', f1.diff.length === 1 && f1.diff[0].added === 1 && f1.diff[0].removed === 0 && f1.diff[0].hunks[0].rows.some((r) => r.t === '+' && /Code fix: a note/.test(r.s)) && f1.diff[0].hunks[0].rows.filter((r) => r.t === ' ').length >= 3);
    T.check('the checks: the page rules hold', f1.checks.length >= 5 && f1.checks.every((c) => c.ok), JSON.stringify(f1.checks.filter((c) => !c.ok)));
    T.check('nothing written to the project', fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8') === html0);
    T.check('kept: listed for the page', store.list(ID).fixes.length === 1 && store.list(ID).fixes[0].status === 'proposed' && store.get(f1.id).fix.markdown.indexOf('## Summary') === 0);

    replies.push(answer(anchor, anchor + '\n<table><tr><oj-bind-for-each data="[[ x ]]"></oj-bind-for-each></tr></table>'), answer(anchor, anchor + '\n<table><tr><oj-bind-for-each data="[[ x ]]"></oj-bind-for-each></tr></table>'));
    const a2 = await store.analyze({ id: ID, request: 'Show the lines as a table' });
    T.check('a page rule broken (a for-each in a table), still after asking again: not usable', a2.ok && a2.fix.status === 'needs-redo' && a2.fix.checks.some((c) => !c.ok && !c.already && /table or select/.test(c.name)), JSON.stringify(a2.fix && a2.fix.checks.filter((c) => !c.ok)));
    replies.push('## Summary\nI need to know more.\n## Questions\nWhich date: the billing date or the contract date?');
    const a3 = await store.analyze({ id: ID, request: 'Filter by date' });
    T.check('questions first: no edits, said so', a3.ok && a3.fix.status === 'questions' && /Which date/.test(a3.fix.questions) && a3.fix.files.length === 0);
    replies.push(answer(anchor, anchor + '\n  A refined note.'));
    const a4 = await store.analyze({ id: ID, request: f1.request, refine: 'Say "refined" in it', parent: f1.id });
    T.check('asked again with what to change: the earlier proposal and the new ask go with it', a4.ok && a4.fix.parent === f1.id && /YOUR EARLIER PROPOSAL/.test(sent[sent.length - 1].user) && /THE PERSON NOW ASKS:\nSay "refined" in it/.test(sent[sent.length - 1].user));

    T.section('apply: after approval — pulled first, written, tested');
    fs.writeFileSync(path.join(A, PAGE + '.html'), html0 + '<!-- mine -->\r\n');
    const d1 = await store.apply({ fix: f1.id, by: 'Asha' });
    T.check('refused while the file has uncommitted changes', !d1.ok && /not committed/.test(d1.error) && /customer-my-billing-page\.html/.test(d1.error), d1.error);
    git(A, 'checkout', '--', PAGE + '.html');
    // someone else pushed (another file): the apply pulls it first
    git(tmp, 'clone', '-q', remote, B); ident(B);
    fs.writeFileSync(path.join(B, 'README.md'), 'from someone else\n'); git(B, 'add', '-A'); git(B, 'commit', '-q', '-m', 'someone else'); git(B, 'push', '-q');
    fs.writeFileSync(path.join(A, 'tests', 'old-failure'), 'x'); // a failure that is there before the fix
    const d2 = await store.apply({ fix: f1.id, by: 'Asha' });
    const html1 = fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8');
    T.check('pulled first (fast-forward), then written', d2.ok && d2.fix.status === 'applied' && d2.fix.applied.pull.done && fs.existsSync(path.join(A, 'README.md')) && /Code fix: a note\./.test(html1), JSON.stringify([d2.error, d2.fix && d2.fix.applied]));
    T.check('the file keeps its Windows line endings', /\r\n/.test(html1) && !/[^\r]\n/.test(html1));
    const u1 = d2.fix.tests.unit[0] || {};
    T.check('the related test ran before and after: its old failure is not the fix\'s', u1.file === 'tests/billing.test.js' && !u1.ok && u1.newFailures.length === 0 && /failing before the fix/.test(u1.before) && d2.fix.tests.ok, JSON.stringify(u1));
    T.check('…and the checks ran on the written code', d2.fix.tests.checks.length >= 5 && d2.fix.tests.checks.every((c) => c.ok || c.already));
    T.check('nothing committed', git(A, 'log', '-1', '--format=%s') === 'someone else' && /customer-my-billing-page\.html/.test(git(A, 'status', '--porcelain')));

    T.section('undo, apply again, a fix that breaks a test, commit and push');
    const n1 = await store.undo({ fix: f1.id });
    T.check('undo: the bytes as they were, the fix "undone"', n1.ok && n1.fix.status === 'undone' && fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8') === html0);
    const d3 = await store.apply({ fix: f1.id, skipPull: true });
    T.check('an undone fix can be applied again', d3.ok && d3.fix.status === 'applied' && /Code fix: a note\./.test(fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8')));
    fs.writeFileSync(path.join(A, PAGE + '.html'), fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8') + 'later\r\n');
    const n2 = await store.undo({ fix: f1.id });
    T.check('undo refused when the file changed since (it would lose that), unless forced', !n2.ok && n2.canForce && /changed after the fix/.test(n2.error) && (await store.undo({ fix: f1.id, force: true })).ok && fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8') === html0);
    fs.unlinkSync(path.join(A, 'tests', 'old-failure'));
    replies.push(answer(anchor, anchor + '\n  BROKEN on purpose.'));
    const b1 = (await store.analyze({ id: ID, request: 'Break the test' })).fix;
    const b2 = await store.apply({ fix: b1.id, skipPull: true });
    T.check('a fix that makes the related test fail: a new failure, "something broke"', b2.ok && !b2.fix.tests.ok && b2.fix.tests.unit[0].newFailures.indexOf('the page is not broken') !== -1 && b2.fix.tests.unit[0].before === 'passed', JSON.stringify(b2.fix && b2.fix.tests.unit));
    await store.undo({ fix: b1.id });
    replies.push(answer(anchor, anchor + '\n  Code fix: the final note.'));
    const c1 = (await store.analyze({ id: ID, request: 'The final note' })).fix;
    await store.apply({ fix: c1.id, by: 'Asha' });
    const cm = await store.commit({ fix: c1.id, push: true });
    T.check('commit and push: only the fix\'s files, its request in the message, on origin', cm.ok && cm.fix.status === 'committed' && cm.fix.commit.pushed && /^Code fix: My Billing — The final note/.test(git(remote, 'log', '-1', '--format=%s', 'main'))
      && git(A, 'show', '--name-only', '--format=', 'HEAD') === PAGE + '.html' && git(A, 'status', '--porcelain') === '', JSON.stringify([cm.error, cm.fix && cm.fix.commit]));
    T.check('a committed fix is not undone here (git revert says how)', !(await store.undo({ fix: c1.id })).ok);

    T.section('the code moved on: out of date; branches that both moved');
    replies.push(answer('  Code fix: the final note.', '  Code fix: the final note, changed.'));
    const s1 = (await store.analyze({ id: ID, request: 'Change the note' })).fix;
    fs.writeFileSync(path.join(A, PAGE + '.html'), fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8').replace('Code fix: the final note.', 'Someone changed it.'));
    git(A, 'commit', '-q', '-am', 'someone changed the page');
    const s2 = await store.apply({ fix: s1.id, skipPull: true });
    T.check('the page changed since the proposal: not applied, out of date', !s2.ok && /changed since this was proposed/.test(s2.error) && store.get(s1.id).fix.status === 'stale', s2.error);
    fs.writeFileSync(path.join(B, 'README.md'), 'again\n'); git(B, 'pull', '-q', '--no-rebase'); git(B, 'commit', '-q', '-am', 'again'); git(B, 'push', '-q');
    replies.push(answer('  Someone changed it.', '  Someone changed it, and the fix too.'));
    const v1 = (await store.analyze({ id: ID, request: 'Again' })).fix;
    const v2 = await store.apply({ fix: v1.id });
    T.check('both branches moved: said, with "apply without pulling" offered', !v2.ok && /both have new commits/.test(v2.error) && v2.canSkipPull, v2.error);
    const v3 = await store.apply({ fix: v1.id, skipPull: true });
    T.check('…which works', v3.ok && v3.fix.applied.pull.text === 'Not pulled (asked to skip).');

    T.section('screenshots with the request: sent to the AI, kept with the fix, and with a refinement');
    const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    git(A, 'checkout', '-q', '--', '.');
    git(A, 'reset', '-q', '--hard', 'HEAD');
    const anchor2 = fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8').replace(/\r\n/g, '\n').split('\n').slice(1, 3).join('\n');
    replies.push(answer(anchor2, anchor2 + '\n  As in the screenshot.'));
    const i1 = await store.analyze({ id: ID, request: 'Make it look like the screenshot', images: [{ name: 'Pasted image 1', mime: 'image/png', base64: PNG1 }, { name: 'bad', mime: 'text/html', base64: 'PGI+' }] });
    const asked = sent[sent.length - 1];
    T.check('the image goes to the AI (only an image type), and the prompt says to look at it', i1.ok && (asked.images || []).length === 1 && asked.images[0].mime === 'image/png' && asked.images[0].base64 === PNG1 && /SCREENSHOTS: the person attached 1 image/.test(asked.user), JSON.stringify([i1.error, (asked.images || []).length]));
    const im = store.img(i1.fix.id, 1);
    T.check('kept with the fix (its file), listed on it', i1.fix.images.length === 1 && i1.fix.images[0].name === 'Pasted image 1' && im.ok && fs.readFileSync(im.file).toString('base64') === PNG1 && !store.img(i1.fix.id, 2).ok);
    replies.push(answer(anchor2, anchor2 + '\n  As in the screenshot, smaller.'));
    const i2 = await store.analyze({ id: ID, request: i1.fix.request, refine: 'Smaller', parent: i1.fix.id });
    T.check('asked again without new screenshots: the earlier ones go with it', i2.ok && (sent[sent.length - 1].images || []).length === 1 && i2.fix.images.length === 1);

    T.section('each AI is given the images its own way');
    const AS = require('../desktop/lib/aiSql');
    const bodies = [];
    const fetchStub = async (url, init) => { bodies.push({ url: url, body: JSON.parse(String(init.body || '{}')) }); return { ok: true, status: 200, text: async () => JSON.stringify(/anthropic/.test(url) ? { content: [{ type: 'text', text: 'ok' }] } : { choices: [{ message: { content: 'ok' } }] }) }; };
    const sA = await AS.open({ file: path.join(tmp, 'ai1.json'), encrypt: (t) => Buffer.from(t), decrypt: (x) => String(x), fetch: fetchStub });
    sA.save({ provider: 'anthropic', key: 'k', model: 'claude-test' });
    await sA.chat({ system: 's', user: 'u', images: [{ mime: 'image/png', base64: PNG1 }], maxTokens: 16000 });
    const ab = bodies[bodies.length - 1].body;
    T.check('Claude (API key): an image block, then the text; a long answer allowed', Array.isArray(ab.messages[0].content) && ab.messages[0].content[0].type === 'image' && ab.messages[0].content[0].source.data === PNG1 && ab.messages[0].content[1].text === 'u' && ab.max_tokens === 16000);
    sA.save({ provider: 'openai', key: 'k', model: 'gpt-test' });
    await sA.chat({ system: 's', user: 'u', images: [{ mime: 'image/png', base64: PNG1 }] });
    const ob = bodies[bodies.length - 1].body;
    T.check('OpenAI: the text, then the image as a data URL', ob.messages[1].content[0].text === 'u' && ob.messages[1].content[1].image_url.url === 'data:image/png;base64,' + PNG1);
    await sA.chat({ system: 's', user: 'u' });
    T.check('…and without images, plain text as before', bodies[bodies.length - 1].body.messages[1].content === 'u');
    const runs = [];
    const sC = await AS.open({ file: path.join(tmp, 'ai2.json'), encrypt: (t) => Buffer.from(t), decrypt: (x) => String(x),
      run: async (args, input) => { runs.push({ args: args, input: input }); return { code: 0, stdout: '{"type":"system"}\n{"type":"result","subtype":"success","is_error":false,"result":"Red"}\n', stderr: '' }; } });
    sC.save({ provider: 'claudecode', model: '' });
    const cr = await sC.chat({ system: 's', user: 'What colour?', images: [{ mime: 'image/png', base64: PNG1 }] });
    const msg = JSON.parse(runs[0].input);
    T.check('Claude Code (subscription): the message as stream-json with the image inline; the answer read from its result line', cr.ok && cr.text === 'Red' && runs[0].args.indexOf('stream-json') !== -1 && runs[0].args.indexOf('--verbose') !== -1
      && msg.type === 'user' && msg.message.content[0].type === 'image' && msg.message.content[0].source.data === PNG1 && msg.message.content[1].text === 'What colour?', JSON.stringify([cr.error, runs[0].args]));

    T.section('the code folder');
    const bad = await store.setFolder(tmp);
    T.check('a folder without webApps is refused', !bad.ok && /no webApps/.test(bad.error));
    T.check('the project itself is fine', (await store.setFolder(A)).ok);

    T.section('the change history: every step with who did it, shared on the data branch');
    const ev1 = store.get(f1.id).fix.events.map((e) => e.what + (e.by ? ' by ' + e.by : ''));
    T.check('a fix\'s steps: asked, proposed, approved and applied (by whom), tested, undone…', ev1[0] === 'asked by Asha' && ev1[1] === 'proposed by Stand-in AI' && ev1.indexOf('approved and applied by Asha') !== -1 && ev1.some((x) => /^tested/.test(x)) && ev1.some((x) => /^undone/.test(x)), ev1.join(' | '));
    fs.writeFileSync(path.join(A, '.gitignore'), '/.equiprite-data/\n'); git(A, 'add', '.gitignore'); git(A, 'commit', '-q', '-m', 'ignore the data branch folder');
    const DBR = require('../desktop/lib/dataBranch');
    const dA = await DBR.open({ root: A }).ensure();
    const hs = CF.open({ root: A, file: path.join(tmp, 'data2', 'code-fixes.json'), ai: ai, data: dA, now: () => new Date(clock += 1000) });
    const a5 = fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8').replace(/\r\n/g, '\n').split('\n').slice(1, 3).join('\n');
    replies.push(answer(a5, a5 + '\n  Shared history note.'));
    const h1 = (await hs.analyze({ id: ID, request: 'A change everyone can see', by: 'Asha' })).fix;
    await hs.apply({ fix: h1.id, skipPull: true, by: 'Ben' });
    const hc = await hs.commit({ fix: h1.id, by: 'Ben' });
    await hs.flush();
    const onData = (() => { try { return JSON.parse(git(remote, 'show', 'claude/equiprite-data:code-history/' + h1.id + '.json')); } catch (e) { return null; } })();
    T.check('applied and committed: the change, its steps and approval pushed to the data branch', hc.ok && onData && onData.status === 'committed' && onData.applied.by === 'Ben' && onData.commit.sha === hc.fix.commit.sha
      && onData.events.some((e) => e.what === 'approved and applied' && e.by === 'Ben') && onData.events.some((e) => e.what === 'committed' && e.by === 'Ben'), JSON.stringify(onData && onData.events));
    T.check('…without this PC\'s paths, backups or screenshots', onData && !onData.folder && !onData.edits && !onData.preview && !onData.hashes);
    // a change made on another PC, shared through the data branch
    fs.writeFileSync(path.join(dA.dir, 'code-history', 'fxother1.json'), JSON.stringify({ id: 'fxother1', page: 'vbredwoodapp/customer-portal/customer-quote', label: 'Your quote', request: 'Bigger total', status: 'committed', at: '2026-11-12T08:00:00.000Z', updatedAt: '2026-11-12T08:05:00.000Z', by: 'Chen', applied: { by: 'Dana', at: '2026-11-12T08:03:00.000Z', branch: 'main' }, commit: { sha: 'abc1234', pushed: true, branch: 'main' }, events: [{ at: '2026-11-12T08:00:00.000Z', what: 'asked', by: 'Chen' }] }));
    const hh = await hs.history('');
    const mineRow = hh.changes.filter((c) => c.id === h1.id)[0], other = hh.changes.filter((c) => c.id === 'fxother1')[0];
    T.check('the history: this PC\'s changes and the shared ones, with who approved and the commit', hh.shared && hh.branch === 'claude/equiprite-data' && mineRow && mineRow.approvedBy === 'Ben' && mineRow.commit.sha === hc.fix.commit.sha && other && other.shared && other.approvedBy === 'Dana' && other.commit.sha === 'abc1234', JSON.stringify(hh.changes.map((c) => c.id + ':' + c.approvedBy)));
    T.check('…found by a word (a person, a page, a commit)', (await hs.history('dana')).changes.length === 1 && (await hs.history('abc1234')).changes[0].id === 'fxother1' && (await hs.history('quote bigger')).changes.length === 1);
    const og = hs.get('fxother1');
    T.check('a change from another PC opens read only (shared)', og.ok && og.fix.shared === true && og.fix.label === 'Your quote' && !(await hs.apply({ fix: 'fxother1' })).ok);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
