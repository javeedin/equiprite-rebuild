'use strict';
/**
 * Code Fix: Application pages → a page → the Code fix tab. Someone asks for a fix, an enhancement or a change to one
 * VB page; the AI reads that page's code and proposes the change; nothing is written until they approve.
 *
 *   1. analyze   the page's files (page JSON/HTML/JS, its action chains, the rules modules it uses) and its facts go to
 *                the AI chosen in AI settings (lib/aiSql.js chat), with this codebase's rules. It answers in fixed
 *                headings (Summary, How it works today, What is wrong / What changes, The change, After the change,
 *                Risks, How to test, Questions) and the edits as SEARCH/REPLACE blocks. The edits are tried in memory
 *                (each SEARCH must be found once), the result checked (JSON, JS syntax, the page rules the tests
 *                enforce), and the diff made. If an edit does not fit or a check newly fails, the AI is asked once more
 *                with what went wrong. Nothing is written.
 *   2. preview   (desktop app) a screenshot before, and one after with the change put only into the built copy the
 *                app serves for a moment (the project's files untouched), then that copy put back.
 *   3. apply     (after approval) the files must have no uncommitted changes; git pull --ff-only (unless skipped); the
 *                edits tried again on the code as it is now; the related tests run on the code as it was (baseline);
 *                the files written (line endings kept), and the built copy, so a reload shows the change.
 *   4. test      the checks, and the related unit tests (tests/*.test.js that name the page) compared with the
 *                baseline: a failure that was there before is not the fix's. Browser tests (tests/e2e) on request.
 *   5. commit (and push), or undo (the files as they were; only if nobody changed them since).
 *
 * Edits stay inside the chosen code folder, under webApps/. The folder is the project the app runs from unless the
 * person picks another (a git checkout with webApps/). Every fix is kept (code-fixes.json): what was asked, the
 * analysis, the edits, what was applied, tested and committed.
 *
 *   open({ root, file, dir, ai, capture, buildDir, pickFolder, gitPath, runTest, now }) → store
 *     info()  setFolder(p)  pick()  list(pageId)  get(id)  shot(id, which)
 *     analyze({ id, request, kind, refine, parent, by })  preview({ fix })  apply({ fix, skipPull, by })
 *     test({ fix })  e2e({ fix })  undo({ fix, force })  commit({ fix, push, message })  discard({ fix })
 *     makeSandbox({ fix, branch, by, onStep })  sandboxStatus(sbx, { diff })  sandboxRun(sbx)  sandboxShots(sbx)
 *     sandboxTests(sbx, { onStep })  removeSandbox(sbx, { by, keepBranch })  applyToBranch({ …, sandbox: sbx })
 *   A sandbox (the issue's branch in a folder of its own, the fix written, the app built there and served on a port of
 *   its own) needs o.serveSandbox({ dir, buildDir, webApp }) → { url, close } to run, o.appUrl(webApp) for the app as it
 *   is now, and o.capture(webApp, url, base) for screenshots; o.buildTool: the folder whose node_modules builds it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const scan = require('./pageScan');
const gitPaths = require('./gitPaths');
const { runGit } = gitPaths;

const MAX_CODE = 170000;    // characters of code sent to the AI
const MAX_TOKENS = 16000;   // the answer: the analysis and the edits
const KEEP = 150;           // fixes kept in the history
const MAX_IMAGES = 6;       // screenshots attached to a request
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const SYSTEM = [
  'You are a senior Oracle Visual Builder (VBCS) and Oracle JET developer on the EquipRite project. Someone asks you to fix, enhance or change ONE page. You get the request, the page\'s facts and its code (every file, complete). Propose the smallest correct change.',
  '',
  'This codebase\'s rules (the tests enforce them; never break them):',
  '- A page is flows/<flow>/pages/<page>-page.json (variables, eventListeners, imports), <page>-page.html (Oracle JET markup), <page>-page.js (the page module: helper functions for bindings) and <page>-page-chains/<Name>.js (action chains: AMD define, a class extending ActionChain with async run(context, params)).',
  '- Bindings: [[ ]] one-way, {{ }} in event listener parameters. No regex literals inside bindings; no String()/Number()/Boolean() or inline functions in bindings — put logic in a page-module function ($functions.x) or a chain.',
  '- No oj-bind-for-each inside <table>, <tbody>, <tr> or <select>: use div grids (role="table"/"row"/"cell") or a custom dropdown.',
  '- Every $listeners.X used in the HTML is declared in the page JSON eventListeners; every chain a listener or chain calls exists in the chains folder; every oj- component used is in the JSON imports.components (when the page has imports).',
  '- Page-module functions used in bindings must not use `this`.',
  '- Keep the existing style, names and comments. Change as little as possible. Do not invent REST endpoints, services or variables: use what the facts and code show; if something is missing, say so under Questions.',
  '',
  'Answer in EXACTLY this format, in plain English a business analyst can follow:',
  '## Summary',
  'One or two sentences: what you will change and why.',
  '## How it works today',
  'What the page does now in the area concerned (name the chains, variables and endpoints).',
  '## What is wrong',
  '(For a bug: the cause, pointing at the code. For an enhancement or change, use the heading "## What changes" instead.)',
  '## The change',
  'A bullet per file: `path` — what changes.',
  '## After the change',
  'What the person will see and do on the page afterwards, step by step.',
  '## Risks',
  'What else could be affected (other pages using the same chain/module, data, permissions). "None known" if none.',
  '## How to test',
  'Numbered steps a person can follow in the app to confirm it works.',
  '## Questions',
  'Only if the request is unclear or something needed is missing — then give NO edits. Otherwise write "None".',
  '',
  'Then the edits, after the headings, each exactly like this (no code fences around them):',
  'FILE: webApps/<app>/flows/<flow>/pages/<file>',
  '<<<<<<< SEARCH',
  'the exact existing lines, copied character for character (enough lines to be unique in the file)',
  '=======',
  'the new lines',
  '>>>>>>> REPLACE',
  '',
  'Several edits to one file: several blocks. A new file: an empty SEARCH. Paths are relative to the project (they start with webApps/) and must be files of this app.',
].join('\n');

/** For an issue (Build.Rite's Issues, desktop/lib/issues.js): where it belongs first, and its number in the code. */
function issueRules(key, title) {
  return [
    '',
    'THIS IS ISSUE ' + key + (title ? ': ' + title : '') + '. Before the other headings, decide where it belongs, under the heading "## Verdict", with exactly one of these on its first line, then one or two lines why:',
    '- Fix on this page — the cause is in this page\'s code (the only verdict with edits)',
    '- Fix elsewhere — the cause is outside this page: name where (another page, a shared module, the EquipRite REST backend, an OIC integration, Fusion setup) and what to change there',
    '- Works as designed — the code (and the FDD, if given) says this is the intended behaviour: quote it',
    '- Out of scope — it is a new requirement, not a defect: say why, and suggest how to handle it (a new story, a setting, another page)',
    '- Needs information — something needed is missing: ask for it (also under Questions)',
    'Only "Fix on this page" has edits. In each edit, at every place you change, add one short comment saying why, with the issue number: in HTML <!-- ' + key + ': why -->, in JavaScript // ' + key + ': why. Never in JSON files (JSON has no comments).',
  ].join('\n');
}
const VERDICTS = [['fix-here', /^fix (it )?on this page|^fix here/i], ['fix-elsewhere', /^fix elsewhere|^elsewhere/i], ['as-designed', /^works as designed|^as designed/i],
  ['out-of-scope', /^out of scope/i], ['needs-info', /^needs? (more )?information|^needs info/i]];
/** The verdict of an issue's analysis (its "## Verdict" heading): fix-here, fix-elsewhere, as-designed, out-of-scope, needs-info, or ''. */
function verdictOf(sections) {
  const v = (sections || []).filter((x) => /^verdict$/i.test(x.title))[0];
  if (!v) return { code: '', text: '' };
  const first = v.text.split('\n').map((l) => l.replace(/^[-*\s]+|\*\*/g, '').trim()).filter(Boolean)[0] || '';
  const hit = VERDICTS.filter((x) => x[1].test(first))[0];
  return { code: hit ? hit[0] : '', text: v.text.trim() };
}

function str(v) { return v == null ? '' : String(v); }
const lf = (t) => str(t).replace(/\r\n/g, '\n');
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
const sha = (t) => crypto.createHash('sha1').update(str(t)).digest('hex').slice(0, 12);
const real = (p) => { try { return fs.realpathSync(path.resolve(p)); } catch (e) { return path.resolve(p); } };
const samePath = (a, b) => (process.platform === 'win32' ? real(a).toLowerCase() === real(b).toLowerCase() : real(a) === real(b));

// ── The AI's answer: its headings, and its SEARCH/REPLACE edits ─────────────────────────────────────────────────────
function parseAnswer(text) {
  const lines = lf(text).split('\n');
  const sections = [], edits = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fm = /^\s*(?:\*\*)?FILE:?(?:\*\*)?\s*`?([^`\s*]+)`?\s*$/.exec(l);
    const at = (k) => (fm ? lines.slice(i + 1, i + 3).findIndex((x) => /^<{7}\s*SEARCH\s*$/.test(x)) : -1) === k;
    if (fm && (at(0) || at(1))) {
      let j = i + 1;
      while (!/^<{7}\s*SEARCH\s*$/.test(lines[j])) j++;
      j++;
      const search = [], replace = [];
      while (j < lines.length && !/^={7}\s*$/.test(lines[j])) search.push(lines[j++]);
      j++;
      while (j < lines.length && !/^>{7}\s*REPLACE\s*$/.test(lines[j])) replace.push(lines[j++]);
      edits.push({ file: fm[1].replace(/^\.?\//, ''), search: search.join('\n'), replace: replace.join('\n') });
      i = j; cur = null;
      continue;
    }
    const h = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(l);
    if (h && !/^```/.test(l)) { cur = { title: h[1].replace(/\*\*/g, '').trim(), text: '' }; sections.push(cur); continue; }
    if (cur) cur.text += l + '\n';
  }
  sections.forEach((s) => { s.text = s.text.replace(/(\n\s*```\s*)+\s*$/, '').replace(/^\s*\n/, '').replace(/\s+$/, ''); });
  const markdown = sections.map((s) => '## ' + s.title + '\n' + s.text).join('\n\n');
  const q = sections.filter((s) => /^questions?$/i.test(s.title))[0];
  const questions = q && !/^\s*(none|no questions|n\/a)\.?\s*$/i.test(q.text) && q.text.trim() ? q.text.trim() : '';
  return { sections: sections, edits: edits, markdown: markdown, questions: questions };
}

// ── Trying the edits in memory ──────────────────────────────────────────────────────────────────────────────────────
/** A path the AI gave, made safe: relative, inside the folder, under webApps/ (and in the page's app). */
function safeRel(folder, rel, app) {
  const r = str(rel).replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!r || r.indexOf('\0') !== -1 || path.isAbsolute(r) || /^[a-z]:/i.test(r) || r.split('/').some((x) => x === '..' || x === '')) return '';
  if (r.indexOf('webApps/') !== 0) return '';
  if (app && r.indexOf('webApps/' + app + '/') !== 0) return '';
  const abs = path.resolve(folder, r);
  return abs.indexOf(path.resolve(folder) + path.sep) === 0 ? r : '';
}
function countOf(hay, needle) { let n = 0, i = -1; while ((i = hay.indexOf(needle, i + 1)) !== -1) { n++; if (n > 5) break; } return n; }
/** Where SEARCH is, ignoring indentation and trailing spaces, when it is not there exactly: [start, end) lines. */
function looseFind(content, search) {
  const c = content.split('\n'), s = search.split('\n');
  while (s.length && !s[s.length - 1].trim()) s.pop();
  while (s.length && !s[0].trim()) s.shift();
  if (!s.length) return null;
  const hits = [];
  for (let i = 0; i + s.length <= c.length && hits.length < 2; i++) {
    let ok = true;
    for (let k = 0; k < s.length && ok; k++) ok = c[i + k].trim() === s[k].trim();
    if (ok) hits.push(i);
  }
  return hits.length === 1 ? [hits[0], hits[0] + s.length] : (hits.length ? 'many' : null);
}
function tryEdits(folder, edits, app) {
  const files = {}, errors = [];
  (edits || []).forEach((e, n) => {
    const rel = safeRel(folder, e.file, app);
    if (!rel) { errors.push({ n: n + 1, file: str(e.file), why: 'not a file of this app (it must be under webApps/' + (app || '<app>') + '/ in the project)' }); return; }
    if (!files[rel]) {
      const raw = readText(path.join(folder, rel));
      files[rel] = { exists: raw != null, raw: raw, old: raw == null ? null : lf(raw), neu: raw == null ? null : lf(raw), crlf: raw != null && /\r\n/.test(raw) };
    }
    const f = files[rel];
    const search = lf(e.search), replace = lf(e.replace);
    if (!search.trim()) {
      if (f.neu == null || !f.neu.trim()) { f.neu = replace.replace(/\n?$/, '\n'); return; }
      errors.push({ n: n + 1, file: rel, why: 'an empty SEARCH, but the file exists (an empty SEARCH makes a new file)' });
      return;
    }
    if (f.neu == null) { errors.push({ n: n + 1, file: rel, why: 'the file does not exist' }); return; }
    const c = countOf(f.neu, search);
    if (c === 1) { const i = f.neu.indexOf(search); f.neu = f.neu.slice(0, i) + replace + f.neu.slice(i + search.length); return; }
    if (c > 1) { errors.push({ n: n + 1, file: rel, why: 'SEARCH is in the file ' + c + ' times: it must be unique (give more lines)', search: search }); return; }
    const lo = looseFind(f.neu, search);
    if (Array.isArray(lo)) {
      const L = f.neu.split('\n');
      const rep = replace.split('\n');
      while (rep.length && !rep[rep.length - 1].trim() && !search.split('\n').slice(-1)[0].trim()) rep.pop();
      f.neu = L.slice(0, lo[0]).concat(rep, L.slice(lo[1])).join('\n');
      return;
    }
    errors.push({ n: n + 1, file: rel, why: lo === 'many' ? 'SEARCH matches several places: give more lines' : 'SEARCH is not in the file (it must be copied exactly)', search: search });
  });
  Object.keys(files).forEach((k) => { if (files[k].neu === files[k].old) delete files[k]; });
  return { files: files, errors: errors };
}

// ── The diff: lines removed and added, with 3 lines around ──────────────────────────────────────────────────────────
function lineOps(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push([' ', a[i]]);
  if (A.length * B.length > 4e6) { A.forEach((x) => ops.push(['-', x])); B.forEach((x) => ops.push(['+', x])); } else {
    const m = A.length, n = B.length, W = n + 1;
    const L = new Uint32Array((m + 1) * (n + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (A[i] === B[j]) { ops.push([' ', A[i]]); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { ops.push(['-', A[i++]]); } else ops.push(['+', B[j++]]);
    }
    while (i < m) ops.push(['-', A[i++]]);
    while (j < n) ops.push(['+', B[j++]]);
  }
  for (let i = a.length - suf; i < a.length; i++) ops.push([' ', a[i]]);
  return ops;
}
function diffOf(rel, oldText, newText) {
  const a = oldText == null ? [] : oldText.replace(/\n$/, '').split('\n');
  const b = newText.replace(/\n$/, '').split('\n');
  const ops = lineOps(a, b);
  let o = 0, nn = 0;
  const rows = ops.map((x) => ({ t: x[0], s: x[1], o: x[0] === '+' ? '' : String(++o), n: x[0] === '-' ? '' : String(++nn) }));
  const hunks = [];
  let cur = null, last = -99;
  rows.forEach((r, i) => {
    if (r.t === ' ') return;
    const from = Math.max(0, i - 3);
    if (!cur || from > last + 1) { cur = { rows: [] }; hunks.push(cur); for (let k = from; k < i; k++) cur.rows.push(rows[k]); }
    else for (let k = last + 1; k < i; k++) cur.rows.push(rows[k]);
    cur.rows.push(r);
    last = i;
    const to = Math.min(rows.length - 1, i + 3);
    let k = i + 1;
    while (k <= to && rows[k].t === ' ') { cur.rows.push(rows[k]); last = k; k++; }
  });
  hunks.forEach((h) => { const f = h.rows.filter((r) => r.o)[0] || h.rows[0]; h.head = 'line ' + (f.o || f.n); });
  return { file: rel, created: oldText == null, added: rows.filter((r) => r.t === '+').length, removed: rows.filter((r) => r.t === '-').length, hunks: hunks };
}

// ── The checks: the page rules the tests enforce, on the new code (a rule the old code broke too is "already") ───────
function htmlRules(html, json, chainNames) {
  const out = [];
  const add = (name, bad, detail) => out.push({ name: name, ok: !bad, detail: bad ? detail || '' : '' });
  add('no oj-bind-for-each inside a table or select', /<(table|tbody|tr|select)[^>]*>[\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
  add('no String()/Number()/Boolean() or inline functions in bindings', /\[\[[^\]]*\b(String|Number|Boolean)\(|\[\[[^\]]*function\s*\(/.test(html));
  const rx = /\[\[[^\]]*(\.replace\(\/|\/[^/\s\]]+\/[gimsuy]*\.(test|exec)\()/.exec(html);
  add('no regex literals in bindings', !!rx, rx ? rx[0].slice(0, 80) : '');
  if (json) {
    const listeners = new Set((html.match(/\$listeners\.([a-zA-Z0-9_]+)/g) || []).map((m) => m.split('.')[1]));
    const missing = [...listeners].filter((l) => !(json.eventListeners || {})[l]);
    add('every listener the HTML uses is declared in the page JSON', missing.length > 0, missing.join(', '));
    if (json.imports && json.imports.components) {
      const used = new Set((html.match(/<(oj-[a-z0-9-]+)/g) || []).map((s) => s.slice(1)));
      const notImp = [...used].filter((c) => !json.imports.components[c]);
      add('every oj- component used is imported', notImp.length > 0, notImp.join(', '));
    }
  }
  if (json && chainNames) {
    const named = new Set([...JSON.stringify(json).matchAll(/"chain"\s*:\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
    const missing = [...named].filter((n) => chainNames.indexOf(n) === -1);
    add('every chain the page runs is in its chains folder', missing.length > 0, missing.join(', '));
  }
  return out;
}
function checksFor(folder, files) {
  const out = [];
  const textOf = (rel, which) => (files[rel] ? files[rel][which] : lf(readText(path.join(folder, rel))));
  Object.keys(files).forEach((rel) => {
    const f = files[rel];
    if (/\.json$/i.test(rel)) {
      let ok = true, why = '';
      try { JSON.parse(f.neu); } catch (e) { ok = false; why = e.message; }
      let was = true;
      try { if (f.old != null) JSON.parse(f.old); } catch (e) { was = false; }
      out.push({ file: rel, name: 'valid JSON', ok: ok, detail: why, already: !ok && !was });
    }
    if (/\.js$/i.test(rel)) {
      let ok = true, why = '';
      try { new vm.Script(f.neu, { filename: rel }); } catch (e) { ok = false; why = e.message; }
      out.push({ file: rel, name: 'JavaScript syntax', ok: ok, detail: why });
    }
  });
  // the pages whose HTML, JSON or chains changed: the page rules, on the new code and the old
  const pages = {};
  Object.keys(files).forEach((rel) => { const m = /^(.*\/pages\/[^/]+?-page)(\.html|\.json|-chains\/.+)$/.exec(rel); if (m) pages[m[1]] = true; });
  Object.keys(pages).forEach((base) => {
    const parse = (t) => { try { return JSON.parse(t); } catch (e) { return null; } };
    const chainDir = path.join(folder, base + '-chains');
    const onDisk = isDir(chainDir) ? fs.readdirSync(chainDir).filter((x) => /\.js$/.test(x)).map((x) => x.replace(/\.js$/, '')) : [];
    const added = Object.keys(files).filter((r) => r.indexOf(base + '-chains/') === 0 && files[r].old == null).map((r) => path.basename(r, '.js'));
    const htmlN = textOf(base + '.html', 'neu'), htmlO = textOf(base + '.html', 'old');
    if (htmlN == null) return;
    const now = htmlRules(htmlN, parse(textOf(base + '.json', 'neu')), onDisk.concat(added));
    const was = htmlO == null ? [] : htmlRules(htmlO, parse(textOf(base + '.json', 'old')), onDisk);
    now.forEach((r) => { const w = was.filter((x) => x.name === r.name)[0]; out.push(Object.assign({ file: base + '.html', already: !r.ok && !!w && !w.ok }, r)); });
  });
  return out;
}

/** A warning (not a failed check): a change to Old EquipRite outside the files its guard test agrees to
 *  (tests/old-app-unchanged.test.js, AGREED) — that test will fail unless the change is agreed there. */
const OLD_GUARD = 'tests/old-app-unchanged.test.js';
function oldAppWarnings(folder, app, files) {
  if (app !== 'vbredwoodapp') return [];
  const t = readText(path.join(folder, OLD_GUARD));
  if (t == null) return [];
  const listed = (t.match(/'webApps\/vbredwoodapp\/[^']+'/g) || []).map((x) => x.slice(1, -1));
  const agreed = (rel) => listed.some((p) => (p.endsWith('/') ? rel.indexOf(p) === 0 : rel === p));
  const outside = files.filter((rel) => !agreed(rel));
  return outside.length ? [{ file: outside[0], name: 'Old EquipRite is kept unchanged by agreement (' + OLD_GUARD + ')', ok: false, warn: true,
    detail: 'this change will fail that test unless ' + (outside.length === 1 ? 'the file is' : 'the files are') + ' added to its AGREED list with the reason: ' + outside.join(', ') }] : [];
}

// ── The related tests ──────────────────────────────────────────────────────────────────────────────────────────────
function relatedTests(folder, p) {
  const keys = [p.page + '-page', (p.flow ? p.flow + '/' : '') + p.page + '-page', "'" + p.flow + "/" + p.page + "'"].filter((k) => k.length > 6);
  const find = (dir, re) => {
    if (!isDir(dir)) return [];
    return fs.readdirSync(dir).filter((f) => re.test(f)).filter((f) => {
      const t = readText(path.join(dir, f)) || '';
      return keys.some((k) => t.indexOf(k) !== -1) || (t.indexOf("'" + p.page + "'") !== -1 && t.indexOf(p.flow) !== -1 && t.indexOf(p.app) !== -1);
    }).sort();
  };
  const unit = find(path.join(folder, 'tests'), /\.test\.js$/).slice(0, 8).map((f) => 'tests/' + f);
  // Old EquipRite is kept unchanged by agreement: its guard runs with every fix of its pages
  if (p.app === 'vbredwoodapp' && isFile(path.join(folder, OLD_GUARD)) && unit.indexOf(OLD_GUARD) === -1) unit.unshift(OLD_GUARD);
  return { unit: unit, e2e: find(path.join(folder, 'tests', 'e2e'), /\.e2e\.js$/).slice(0, 4).map((f) => 'tests/' + f) };
}
/** One test file run with node (in the desktop app: its own runtime, as node): { ok, passed, failed, failures, ms, out }. */
function runNode(folder, rel, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const env = Object.assign({}, process.env, process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {});
    require('child_process').execFile(process.execPath, [path.join(folder, rel)], { cwd: folder, env: env, timeout: ms || 180000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = str(stdout) + str(stderr);
        const m = /passed:\s*(\d+)\s+failed:\s*(\d+)/i.exec(out);
        const fails = [];
        const fm = /FAILURES:\s*\n([\s\S]*)$/.exec(out);
        if (fm) fm[1].split('\n').forEach((l) => { const x = /^\s*-\s+(.+?)\s*$/.exec(l); if (x) fails.push(x[1].slice(0, 300)); });
        resolve({ file: rel, ok: !err && (!m || m[2] === '0'), passed: m ? Number(m[1]) : 0, failed: m ? Number(m[2]) : (err ? 1 : 0), failures: fails.slice(0, 40),
          ms: Date.now() - t0, out: out.slice(-4000), timedOut: !!(err && err.killed) });
      });
  });
}

// ── The store ───────────────────────────────────────────────────────────────────────────────────────────────────────
function open(opts) {
  const o = opts || {};
  const root = path.resolve(o.root || path.join(__dirname, '..', '..'));
  const file = o.file || '';
  const dir = o.dir || (file ? path.join(path.dirname(file), 'code-fixes') : '');
  const now = o.now || (() => new Date());
  const git = (cwd, args) => (o.git ? o.git(cwd, args) : runGit(o.gitPath, cwd, args));
  const runTest = o.runTest || runNode;
  let mem = { folder: '', fixes: [] };

  function load() { if (!file) return mem; try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { folder: str(j.folder), fixes: Array.isArray(j.fixes) ? j.fixes : [] }; } catch (e) { return { folder: '', fixes: [] }; } }
  function save(d) { mem = d; if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 1)); }
  const data = () => (file ? load() : mem);
  const folder = () => { const f = data().folder; return f && isDir(path.join(f, 'webApps')) ? path.resolve(f) : root; };
  const isDefault = () => samePath(folder(), root);
  const fixDir = (id) => path.join(dir, id);
  const backupOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(fixDir(id), 'backup.json'), 'utf8')); } catch (e) { return null; } };
  const slim = (f) => { const x = Object.assign({}, f); delete x.edits; return x; };
  function put(fix) {
    const d = data();
    d.fixes = [fix].concat(d.fixes.filter((x) => x.id !== fix.id)).slice(0, KEEP);
    save(d);
    return fix;
  }
  const local = (id) => data().fixes.filter((x) => x.id === str(id))[0] || null;
  const byId = local;

  // ── The history of each change: who asked, what was proposed, who approved and applied it, the tests, the commit ──
  /** One step in a fix's history (fix.events): when, what, who, a detail. */
  function ev(fix, what, by, detail) {
    fix.events = (fix.events || []).concat([{ at: now().toISOString(), what: what, by: str(by), detail: str(detail).slice(0, 400) }]);
    fix.updatedAt = now().toISOString();
  }
  // Shared with everyone: each change that reached the code (applied, tested, committed, undone) is written to the
  // app's data branch (code-history/<id>.json, lib/dataBranch.js) and pushed — never the local paths, backups or
  // screenshots. A change made on another PC is read from there (read only here).
  const shared = o.data && o.data.ok ? o.data : null;
  const HIST = 'code-history';
  const histRepo = shared ? gitPaths.create({ root: shared.dir, paths: [HIST], git: o.git ? (args) => o.git(shared.dir, args) : undefined, gitPath: o.gitPath,
    message: 'Code change history: update', sync: { resolve: shared.resolve, after: shared.merged } }) : null;
  let pubChain = Promise.resolve();
  function publicOf(fix) {
    const x = slim(fix);
    delete x.folder; delete x.preview; delete x.written; delete x.hashes;
    x.images = (fix.images || []).map((im) => ({ n: im.n, name: im.name }));
    if (x.sent) x.sent = { files: x.sent.files, chars: x.sent.chars };
    if (x.tests) x.tests = Object.assign({}, x.tests, { unit: (x.tests.unit || []).map((u) => Object.assign({}, u, { out: '' })) });
    return x;
  }
  function publish(fix) {
    if (!histRepo) return pubChain;
    const rec = publicOf(fix);
    pubChain = pubChain.then(async () => {
      try {
        fs.mkdirSync(path.join(shared.dir, HIST), { recursive: true });
        fs.writeFileSync(path.join(shared.dir, HIST, fix.id + '.json'), JSON.stringify(rec, null, 1) + '\n');
        const r = await histRepo.save({ message: 'Code change history: ' + fix.label + ' — ' + fix.status + ' (' + fix.request.split('\n')[0].slice(0, 60) + ')' });
        if (!r.ok && o.log) o.log('code history: not pushed (' + r.error + ')');
      } catch (e) { if (o.log) o.log('code history: ' + e.message); }
    });
    return pubChain;
  }
  function sharedOne(id) {
    if (!shared || !/^fx[a-z0-9]+$/.test(str(id))) return null;
    try { return Object.assign(JSON.parse(fs.readFileSync(path.join(shared.dir, HIST, id + '.json'), 'utf8')), { shared: true }); } catch (e) { return null; }
  }
  function sharedAll() {
    if (!shared) return [];
    let names = [];
    try { names = fs.readdirSync(path.join(shared.dir, HIST)).filter((n) => /^fx[a-z0-9]+\.json$/.test(n)); } catch (e) { return []; }
    return names.map((n) => sharedOne(n.replace(/\.json$/, ''))).filter(Boolean);
  }
  /** Every change — made here, and shared from other PCs — newest first; q: words to find (page, request, people, commit). */
  async function history(q) {
    if (histRepo) { try { await histRepo.pull(); } catch (e) { /* what is here */ } }
    const mine = data().fixes;
    const all = mine.concat(sharedAll().filter((x) => !mine.some((m) => m.id === x.id)));
    const words = str(q).toLowerCase().split(/\s+/).filter(Boolean);
    const row = (x) => ({ id: x.id, page: x.page, label: x.label, app: x.app, request: x.request, status: x.status, at: x.at, by: x.by, provider: x.provider, files: x.files || [],
      approvedBy: x.applied ? x.applied.by : '', approvedAt: x.applied ? x.applied.at : '', branch: x.applied ? x.applied.branch : '',
      commit: x.commit ? { sha: x.commit.sha, pushed: !!x.commit.pushed, branch: x.commit.branch, by: x.commit.by || '' } : null,
      tests: x.tests ? { ok: !!x.tests.ok } : null, undone: !!x.undone, shared: !!x.shared, updatedAt: x.updatedAt || x.at, steps: (x.events || []).length });
    const list = all.map(row).filter((r) => !words.length || words.every((w) => [r.label, r.page, r.request, r.by, r.approvedBy, r.status, r.commit && r.commit.sha].join(' ').toLowerCase().indexOf(w) !== -1));
    list.sort((a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt)));
    return { ok: true, changes: list.slice(0, 300), shared: !!shared, branch: shared ? shared.branch : '' };
  }
  const ok = (fix, extra) => Object.assign({ ok: true, fix: fix }, extra || {});
  const no = (error, extra) => Object.assign({ ok: false, error: error }, extra || {});

  /** The built copy the app serves for a webApp (the newest version folder), when the code folder is the app's own. */
  function builtDir(app) {
    if (!o.buildDir || !isDefault()) return '';
    const web = path.join(o.buildDir, 'processed', 'webApps', app);
    try { const v = fs.readdirSync(web).filter((n) => /^version_/.test(n)).sort().pop(); return v ? path.join(web, v) : ''; } catch (e) { return ''; }
  }
  const builtFile = (app, rel) => { const b = builtDir(app); const pre = 'webApps/' + app + '/'; return b && rel.indexOf(pre) === 0 ? path.join(b, rel.slice(pre.length)) : ''; };

  async function gitState(f) {
    const inside = await git(f, ['rev-parse', '--is-inside-work-tree']);
    if (inside.code !== 0 || !/true/.test(inside.stdout)) return { git: false, reason: /not installed/.test(inside.stderr) ? 'git is not installed on this PC.' : 'This folder is not a git repository.' };
    const branch = (await git(f, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    const up = await git(f, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return { git: true, branch: branch, upstream: up.code === 0 ? up.stdout.trim() : '' };
  }

  async function info() {
    const f = folder();
    const g = await gitState(f);
    const ai = o.ai && typeof o.ai.settings === 'function' ? (() => { try { const s = o.ai.settings(); return { ready: !!s.active, provider: ((s.catalog || []).filter((c) => c.id === s.active)[0] || {}).label || '' }; } catch (e) { return { ready: false, provider: '' }; } })() : { ready: !!o.ai, provider: '' };
    return { ok: true, folder: f, isDefault: isDefault(), valid: g.git && isDir(path.join(f, 'webApps')), reason: g.git ? '' : g.reason, branch: g.branch || '', upstream: g.upstream || '',
      canPick: typeof o.pickFolder === 'function', canPreview: typeof o.capture === 'function' && !!o.buildDir && isDefault(), ai: ai };
  }
  async function setFolder(p) {
    const f = path.resolve(str(p));
    if (!str(p) || !isDir(f)) return no('No such folder.');
    if (!isDir(path.join(f, 'webApps'))) return no('That folder is not an EquipRite project: it has no webApps folder.');
    const g = await gitState(f);
    if (!g.git) return no(g.reason);
    const d = data(); d.folder = samePath(f, root) ? '' : f; save(d);
    return Object.assign(await info(), { ok: true });
  }
  async function pick() {
    if (typeof o.pickFolder !== 'function') return no('Choosing a folder needs the desktop app.');
    const p = await o.pickFolder(folder());
    if (!p) return Object.assign(await info(), { ok: true, cancelled: true });
    return setFolder(p);
  }

  /** The page's code (its files, then the rules modules it uses) for the AI, within MAX_CODE. */
  function codeOf(f, facts) {
    const list = facts.files.map((x) => x.path).concat((facts.logic.modules || []).map((m) => m.file).filter(Boolean));
    const seen = {}, parts = [], skipped = [];
    let size = 0;
    list.forEach((rel) => {
      if (seen[rel]) return; seen[rel] = true;
      const t = readText(path.join(f, rel));
      if (t == null) return;
      const block = '===== FILE ' + rel + ' (' + lf(t).split('\n').length + ' lines)\n' + lf(t).replace(/\n?$/, '\n') + '===== END FILE ' + rel + '\n';
      if (size + block.length > MAX_CODE) { skipped.push(rel); return; }
      parts.push(block); size += block.length;
    });
    return { text: parts.join('\n'), files: Object.keys(seen).filter((r) => skipped.indexOf(r) === -1), skipped: skipped, chars: size };
  }
  function factsText(facts) {
    const L = [];
    L.push('PAGE ' + facts.label + ' (' + facts.appName + ', ' + facts.app + '/' + (facts.flow ? facts.flow + '/' : '') + facts.page + ')' + (facts.route && facts.route.url ? ' — opens at ' + facts.route.url : ''));
    if (facts.description) L.push('About: ' + facts.description.slice(0, 600));
    if (facts.integrations.rest.length) L.push('REST calls: ' + facts.integrations.rest.map((r) => (r.method || '?') + ' ' + r.path + ' (' + r.endpoint + ', ' + r.backendLabel + ', by ' + r.usedBy.join('/') + ')').join('; '));
    if (facts.logic.chains.length) L.push('Action chains: ' + facts.logic.chains.map((c) => c.name + (c.about ? ' — ' + c.about.slice(0, 160) : '')).join(' | '));
    if ((facts.next || []).length) L.push('Opens: ' + facts.next.map((n) => n.label + ' (' + n.id + ')').join(', '));
    return L.join('\n');
  }

  async function analyze(b) {
    b = b || {};
    if (!o.ai || typeof o.ai.chat !== 'function') return no('No AI is set up: choose one in AI settings.');
    const request = str(b.request).trim();
    if (!request) return no('Say what should change on this page.');
    const f = folder();
    const facts = scan.analyze(f, str(b.id));
    if (!facts) return no('This page is not in ' + f + ' (pick the right code folder).');
    const parent = b.parent ? byId(b.parent) : null;
    const code = codeOf(f, facts);
    // screenshots the person pasted (or, asked again without new ones, the earlier proposal's)
    const MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
    let images = (Array.isArray(b.images) ? b.images : []).filter((im) => im && MIME[im.mime] && im.base64).slice(0, MAX_IMAGES)
      .map((im) => ({ name: str(im.name).slice(0, 80) || 'image', mime: im.mime, base64: str(im.base64).replace(/^data:[^,]*,/, '') }))
      .filter((im) => im.base64.length * 0.75 <= MAX_IMAGE_BYTES);
    if (!images.length && parent && (parent.images || []).length) {
      images = parent.images.map((im) => { try { return { name: im.name, mime: im.mime, base64: fs.readFileSync(path.join(fixDir(parent.id), im.file)).toString('base64') }; } catch (e) { return null; } }).filter(Boolean);
    }
    const kind = { fix: 'Fix a bug', enhance: 'Enhance', change: 'Change' }[str(b.kind)] || '';
    let user = 'REQUEST' + (kind ? ' (' + kind + ')' : '') + ':\n' + request + '\n';
    if (parent && str(b.refine).trim()) {
      user += '\nYOUR EARLIER PROPOSAL for this request:\n' + str(parent.markdown).slice(0, 12000) + '\n\nIts edits touched: ' + (parent.files || []).join(', ')
        + '\n\nTHE PERSON NOW ASKS:\n' + str(b.refine).trim() + '\n\nGive the whole answer again (all headings, all edits against the code as it is below).\n';
    }
    if (images.length) user += '\nSCREENSHOTS: the person attached ' + images.length + ' image' + (images.length === 1 ? '' : 's') + ' (image 1' + (images.length > 1 ? ' to ' + images.length : '') + ', in the order given): look at ' + (images.length === 1 ? 'it' : 'them') + ' closely — they show what the request means (the screen as it is, the error, or what it should look like).\n';
    user += '\nFACTS\n' + factsText(facts) + '\n\nCODE (complete files; copy SEARCH lines exactly from here)\n' + code.text;
    if (code.skipped.length) user += '\n(Not included, too large: ' + code.skipped.join(', ') + ')\n';
    if (str(b.context).trim()) user += '\n' + str(b.context).trim().slice(0, 40000) + '\n';
    // an issue (Build.Rite's Issues): its verdict first, its number in the comments of the code it changes
    const issue = b.issue && b.issue.key ? { key: str(b.issue.key).slice(0, 40), title: str(b.issue.title).slice(0, 200) } : null;
    const system = issue ? SYSTEM + '\n' + issueRules(issue.key, issue.title) : SYSTEM;
    const t0 = Date.now();
    const pics = images.map((im) => ({ mime: im.mime, base64: im.base64 }));
    let r = await o.ai.chat({ system: system, user: user, maxTokens: MAX_TOKENS, images: pics });
    if (!r || !r.ok) return no((r && r.error) || 'The AI did not answer.');
    let parsed = parseAnswer(r.text);
    let tried = tryEdits(f, parsed.edits, facts.app);
    let checks = checksFor(f, tried.files);
    let retried = false;
    const newFails = (cs) => cs.filter((c) => !c.ok && !c.already);
    // (an issue that does not belong to this page's code has no edits: nothing to ask again)
    const noFix = () => issue && ['fix-elsewhere', 'as-designed', 'out-of-scope', 'needs-info'].indexOf(verdictOf(parsed.sections).code) !== -1 && !parsed.edits.length;
    if (!parsed.questions && !noFix() && (tried.errors.length || newFails(checks).length || !parsed.edits.length)) {
      const why = [];
      if (!parsed.edits.length) why.push('There were no edits in the SEARCH/REPLACE format (or the format was wrong).');
      tried.errors.forEach((e) => why.push('Edit ' + e.n + ' (' + e.file + '): ' + e.why + (e.search ? '\nIts SEARCH was:\n' + e.search.slice(0, 1500) : '')));
      newFails(checks).forEach((c) => why.push('Check failed after your edits — ' + c.name + ' (' + c.file + ')' + (c.detail ? ': ' + c.detail : '')));
      const again = await o.ai.chat({ system: system, user: user + '\n\nYOUR PREVIOUS ANSWER:\n' + r.text.slice(0, 30000) + '\n\nIT COULD NOT BE USED:\n' + why.join('\n\n')
        + '\n\nGive the whole answer again, in the format, with every SEARCH copied exactly from the CODE above.', maxTokens: MAX_TOKENS, images: pics });
      if (again && again.ok) {
        const p2 = parseAnswer(again.text), t2 = tryEdits(f, p2.edits, facts.app), c2 = checksFor(f, t2.files);
        if (p2.questions || (t2.errors.length + newFails(c2).length) <= (tried.errors.length + newFails(checks).length)) { r = again; parsed = p2; tried = t2; checks = c2; retried = true; }
      }
    }
    const files = Object.keys(tried.files);
    const fixId = 'fx' + now().getTime().toString(36) + crypto.randomBytes(3).toString('hex');
    const saved = images.map((im, i) => {
      if (!dir) return null; // (a store without a data folder: sent, not kept)
      const file = 'img-' + (i + 1) + '.' + MIME[im.mime];
      try { fs.mkdirSync(fixDir(fixId), { recursive: true }); fs.writeFileSync(path.join(fixDir(fixId), file), Buffer.from(im.base64, 'base64')); } catch (e) { return null; }
      return { n: i + 1, name: im.name, mime: im.mime, file: file, size: Math.round(im.base64.length * 0.75) };
    }).filter(Boolean);
    const fix = {
      id: fixId, images: saved,
      page: facts.id, app: facts.app, label: facts.label, request: request, kind: str(b.kind), refine: str(b.refine).trim(), parent: parent ? parent.id : '',
      at: now().toISOString(), by: str(b.by), provider: r.provider || '', model: r.model || '', ms: Date.now() - t0, retried: retried,
      folder: f, sent: { files: code.files, skipped: code.skipped, chars: code.chars },
      markdown: parsed.markdown || r.text, questions: parsed.questions, edits: parsed.edits, problems: tried.errors, checks: checks.concat(oldAppWarnings(f, facts.app, files)),
      files: files, hashes: files.reduce((m, k) => { m[k] = sha(tried.files[k].old); return m; }, {}),
      diff: files.map((k) => diffOf(k, tried.files[k].old, tried.files[k].neu)),
      status: noFix() ? 'triaged' : parsed.questions && !files.length ? 'questions' : (tried.errors.length || !files.length || newFails(checks).length ? 'needs-redo' : 'proposed'),
    };
    if (issue) { fix.issue = issue; fix.verdict = verdictOf(parsed.sections); }
    fix.events = [{ at: fix.at, what: parent ? 'asked again' : 'asked', by: fix.by, detail: parent ? fix.refine : request }];
    ev(fix, { proposed: 'proposed', 'needs-redo': 'proposal not usable', questions: 'asked questions', triaged: 'triaged: ' + ((fix.verdict && fix.verdict.code) || '') }[fix.status] || fix.status, fix.provider || 'AI',
      files.length ? files.length + ' file(s), +' + fix.diff.reduce((n, d) => n + d.added, 0) + ' −' + fix.diff.reduce((n, d) => n + d.removed, 0) + (images.length ? ' · ' + images.length + ' screenshot(s) read' : '') : (parsed.questions || '').slice(0, 200));
    put(fix);
    return ok(slim(fix));
  }

  /** The edits on the code as it is now, or why not. */
  function retry(fix) {
    const tried = tryEdits(fix.folder, fix.edits, fix.app);
    const files = Object.keys(tried.files);
    const changed = (fix.files || []).filter((k) => !tried.files[k] || sha(tried.files[k].old) !== fix.hashes[k]);
    if (tried.errors.length || changed.length || files.length !== (fix.files || []).length) return { error: 'The page\'s code changed since this was proposed (' + (changed.concat(tried.errors.map((e) => e.file)).filter((x, i, a) => a.indexOf(x) === i).join(', ') || 'its files') + '): analyze again.', tried: tried };
    return { tried: tried };
  }

  async function preview(b) {
    const fix = byId(b && b.fix);
    if (!fix) return no('No such fix.');
    if (typeof o.capture !== 'function') return no('Screenshots need the desktop app.');
    if (!builtDir(fix.app)) return no(isDefault() ? 'The app is not built (npm run build).' : 'The preview runs in this app, so it needs the code folder to be this app\'s own project.');
    const facts = scan.analyze(fix.folder, fix.page);
    const url = facts && facts.route && facts.route.url;
    if (!url) return no('This page is opened from another screen (' + ((facts && facts.route && facts.route.needs) || 'with data') + '), so it cannot be opened alone for a screenshot.');
    const r = retry(fix);
    if (r.error) return no(r.error);
    fs.mkdirSync(fixDir(fix.id), { recursive: true });
    const shot = async (name) => {
      const c = await o.capture(fix.app, url);
      if (!c || !c.ok) throw new Error((c && c.error) || 'The screenshot failed.');
      const ext = /png/.test(c.mime || '') ? 'png' : 'jpg';
      fs.writeFileSync(path.join(fixDir(fix.id), name + '.' + ext), Buffer.from(c.base64, 'base64'));
      return name + '.' + ext;
    };
    const kept = {};
    try {
      const before = await shot('before');
      // the change in the built copy only, for the length of a screenshot; the project's files are not touched
      Object.keys(r.tried.files).forEach((rel) => { const bf = builtFile(fix.app, rel); if (!bf) return; kept[bf] = readText(bf); fs.mkdirSync(path.dirname(bf), { recursive: true }); fs.writeFileSync(bf, r.tried.files[rel].neu); });
      const after = await shot('after');
      fix.preview = { before: before, after: after, at: now().toISOString() };
      ev(fix, 'previewed', b.by, 'before and after screenshots');
      put(fix);
      return ok(slim(fix));
    } catch (e) {
      return no(str(e && e.message));
    } finally {
      Object.keys(kept).forEach((bf) => { try { if (kept[bf] == null) fs.unlinkSync(bf); else fs.writeFileSync(bf, kept[bf]); } catch (e) { /* the next build */ } });
    }
  }
  /** An image the person attached to a fix (its number, from 1). */
  function img(id, n) {
    const fix = byId(id);
    const im = fix && (fix.images || []).filter((x) => String(x.n) === String(n))[0];
    const p = im ? path.join(fixDir(fix.id), im.file) : '';
    return p && isFile(p) ? { ok: true, file: p, mime: im.mime } : no('No such image.');
  }
  function shot(id, which) {
    const fix = byId(id);
    const name = fix && fix.preview && fix.preview[which === 'after' ? 'after' : 'before'];
    const p = name ? path.join(fixDir(fix.id), name) : '';
    return p && isFile(p) ? { ok: true, file: p, mime: /png$/.test(p) ? 'image/png' : 'image/jpeg' } : no('No screenshot.');
  }

  async function runUnits(fix, f, onTest, onDone) {
    const p = scan.pagesOf(f).filter((x) => x.id === fix.page)[0] || { page: '', flow: '', app: fix.app };
    const rel = relatedTests(f, p);
    const out = [];
    for (let i = 0; i < rel.unit.length; i++) {
      if (onTest) onTest(i, rel.unit.length, rel.unit[i]);
      const t = await runTest(f, rel.unit[i]);
      out.push(t);
      if (onDone) onDone(i, rel.unit.length, t);
    }
    return { unit: out, e2eFiles: rel.e2e };
  }

  async function apply(b) {
    b = b || {};
    const fix = byId(b.fix);
    if (!fix) return no('No such fix.');
    if (fix.status !== 'proposed' && fix.status !== 'undone') return no(fix.status === 'applied' ? 'It is applied already.' : 'Only a proposal can be applied (this one is ' + fix.status + ').');
    const f = fix.folder;
    if (!samePath(f, folder())) return no('This was proposed for ' + f + ', and the code folder is now ' + folder() + '.');
    const g = await gitState(f);
    if (!g.git) return no(g.reason);
    const dirty = (await git(f, ['status', '--porcelain', '--'].concat(fix.files))).stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
    if (dirty.length) return no('These files have changes that are not committed: ' + dirty.join(', ') + '. Commit or discard them first, so the fix does not mix with them.');
    let pull = { done: false, text: 'Not pulled (asked to skip).' };
    if (!b.skipPull) {
      if (!g.upstream) pull = { done: false, text: 'Not pulled: branch ' + g.branch + ' is not pushed anywhere.' };
      else {
        const pr = await git(f, ['pull', '--ff-only', '--no-rebase']);
        if (pr.code !== 0) {
          const why = (pr.stderr || pr.stdout).trim();
          return no(/not possible to fast-forward|diverg|Not possible/i.test(why)
            ? 'git pull could not just move ' + g.branch + ' forward: your branch and ' + g.upstream + ' both have new commits. Run "git pull --no-edit" in a terminal, then apply again (or apply without pulling).'
            : 'git pull failed: ' + why.slice(0, 400), { canSkipPull: true });
        }
        pull = { done: true, text: /Already up to date|Already up-to-date/i.test(pr.stdout) ? 'Pulled ' + g.upstream + ': already up to date.' : 'Pulled ' + g.upstream + ': ' + (pr.stdout.trim().split('\n').pop() || 'updated') + '.' };
      }
    }
    const r = retry(fix);
    if (r.error) { fix.status = 'stale'; ev(fix, 'out of date', b.by, r.error); put(fix); return no(r.error, { fix: slim(fix) }); }
    const base = await runUnits(fix, f); // the related tests on the code as it was
    const backup = {};
    Object.keys(r.tried.files).forEach((rel) => {
      const x = r.tried.files[rel];
      backup[rel] = x.raw; // null: a new file
      const out = x.crlf ? x.neu.replace(/\n/g, '\r\n') : x.neu;
      fs.mkdirSync(path.dirname(path.join(f, rel)), { recursive: true });
      fs.writeFileSync(path.join(f, rel), out);
      const bf = builtFile(fix.app, rel);
      if (bf) { try { fs.mkdirSync(path.dirname(bf), { recursive: true }); fs.writeFileSync(bf, out); } catch (e) { /* the next build */ } }
    });
    fs.mkdirSync(fixDir(fix.id), { recursive: true });
    fs.writeFileSync(path.join(fixDir(fix.id), 'backup.json'), JSON.stringify(backup));
    fix.written = Object.keys(r.tried.files).reduce((m, k) => { m[k] = sha(r.tried.files[k].neu); return m; }, {});
    fix.applied = { at: now().toISOString(), by: str(b.by), branch: g.branch, upstream: g.upstream, pull: pull, live: !!builtDir(fix.app) };
    fix.baseline = base.unit.map((t) => ({ file: t.file, ok: t.ok, failed: t.failed, failures: t.failures }));
    fix.status = 'applied';
    ev(fix, 'approved and applied', b.by, 'on ' + g.branch + ' · ' + pull.text);
    put(fix);
    const t = await test({ fix: fix.id, by: b.by });
    return ok(t.fix || slim(fix));
  }

  async function test(b) {
    const fix = byId(b && b.fix);
    if (!fix) return no('No such fix.');
    if (fix.status !== 'applied' && fix.status !== 'committed') return no('Apply it first.');
    const f = fix.folder;
    const files = {};
    (fix.files || []).forEach((rel) => { const bk = backupOf(fix.id) || {}; files[rel] = { old: bk[rel] == null ? null : lf(bk[rel]), neu: lf(readText(path.join(f, rel))) }; });
    const checks = checksFor(f, files);
    const run = await runUnits(fix, f);
    const base = fix.baseline || [];
    const unit = run.unit.map((t) => {
      const was = base.filter((x) => x.file === t.file)[0];
      const newFailures = t.failures.filter((x) => !was || was.failures.indexOf(x) === -1);
      return { file: t.file, ok: t.ok, passed: t.passed, failed: t.failed, failures: t.failures, newFailures: was && !was.ok ? newFailures : (t.ok ? [] : (t.failures.length ? t.failures : ['it failed (see its output)'])), before: was ? (was.ok ? 'passed' : was.failed + ' failing before the fix') : '', ms: t.ms, out: t.ok ? '' : t.out.slice(-1500) };
    });
    const bad = checks.filter((c) => !c.ok && !c.already).length + unit.filter((u) => u.newFailures.length).length;
    fix.tests = { at: now().toISOString(), ok: bad === 0, checks: checks, unit: unit, e2eFiles: run.e2eFiles || [], none: !unit.length };
    ev(fix, 'tested', (b && b.by) || '', bad === 0 ? 'nothing broke' + (unit.length ? ' (' + unit.length + ' related test file(s))' : ' (checks only)') : 'something broke: ' + bad + ' new failure(s)');
    put(fix);
    publish(fix);
    return ok(slim(fix));
  }

  async function e2e(b) {
    const fix = byId(b && b.fix);
    if (!fix) return no('No such fix.');
    if (fix.status !== 'applied' && fix.status !== 'committed') return no('Apply it first.');
    const files = (fix.tests && fix.tests.e2eFiles) || [];
    if (!files.length) return no('No browser test names this page.');
    const res = [];
    for (const t of files) res.push(await runTest(fix.folder, t, 600000));
    fix.e2e = { at: now().toISOString(), ok: res.every((x) => x.ok), runs: res.map((x) => ({ file: x.file, ok: x.ok, passed: x.passed, failed: x.failed, failures: x.failures,
      note: /Cannot find module 'playwright'/.test(x.out) ? 'Browser tests need Playwright on this PC (npm install in the project).' : (x.ok ? '' : x.out.slice(-1200)) })) };
    ev(fix, 'browser tests', b && b.by, fix.e2e.ok ? 'passed' : 'not passed');
    put(fix);
    publish(fix);
    return ok(slim(fix));
  }

  async function undo(b) {
    b = b || {};
    const fix = byId(b.fix);
    if (!fix) return no('No such fix.');
    if (fix.status !== 'applied') return no(fix.status === 'committed' ? 'It is committed (' + (fix.commit && fix.commit.sha) + '): undo it with git revert ' + (fix.commit && fix.commit.sha) + '.' : 'Nothing to undo.');
    const backup = backupOf(fix.id);
    if (!backup) return no('The copy of the files before the fix is missing.');
    const changed = Object.keys(backup).filter((rel) => sha(lf(readText(path.join(fix.folder, rel)))) !== (fix.written || {})[rel]);
    if (changed.length && !b.force) return no('These files changed after the fix was applied: ' + changed.join(', ') + '. Undoing would lose those changes.', { canForce: true });
    Object.keys(backup).forEach((rel) => {
      const abs = path.join(fix.folder, rel), bf = builtFile(fix.app, rel);
      if (backup[rel] == null) { try { fs.unlinkSync(abs); } catch (e) { /* gone */ } if (bf) { try { fs.unlinkSync(bf); } catch (e) { /* gone */ } } return; }
      fs.writeFileSync(abs, backup[rel]);
      if (bf) { try { fs.writeFileSync(bf, backup[rel]); } catch (e) { /* the next build */ } }
    });
    fix.status = 'undone'; fix.undone = { at: now().toISOString(), by: str(b.by) };
    ev(fix, 'undone', b.by, b.force ? 'forced (the files had changed since)' : 'the files as they were before');
    put(fix);
    publish(fix);
    return ok(slim(fix));
  }

  async function commit(b) {
    b = b || {};
    const fix = byId(b.fix);
    if (!fix) return no('No such fix.');
    if (fix.status !== 'applied') return no(fix.status === 'committed' ? 'It is committed already.' : 'Apply it first.');
    const f = fix.folder;
    const msg = str(b.message).trim() || ('Code fix: ' + fix.label + ' — ' + fix.request.split('\n')[0].slice(0, 90) + '\n\n' + fix.request.slice(0, 2000) + '\n\n(Proposed by ' + (fix.provider || 'AI') + ' in EquipRite Code Fix, approved by ' + (fix.applied.by || 'the user') + '.)');
    const add = await git(f, ['add', '--'].concat(fix.files));
    if (add.code !== 0) return no('git add failed: ' + add.stderr.trim());
    const c = await git(f, ['commit', '-m', msg, '--'].concat(fix.files));
    if (c.code !== 0) {
      const why = (c.stderr || c.stdout).trim();
      return no('git commit failed: ' + why.slice(0, 400), { hint: /user\.(name|email)|identity/i.test(why) ? 'Tell git who you are: git config --global user.name "Your Name" and git config --global user.email you@example.com' : '' });
    }
    const shaC = (await git(f, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
    fix.commit = { sha: shaC, at: now().toISOString(), pushed: false, branch: (await gitState(f)).branch, by: str(b.by) };
    fix.status = 'committed';
    ev(fix, 'committed', b.by, shaC + ' on ' + fix.commit.branch);
    if (b.push) {
      const g = await gitState(f);
      const p = g.upstream ? await git(f, ['push']) : await git(f, ['push', '-u', 'origin', 'HEAD']);
      if (p.code === 0) { fix.commit.pushed = true; fix.commit.upstream = g.upstream || 'origin/' + g.branch; ev(fix, 'pushed', b.by, 'to ' + fix.commit.upstream); }
      else { fix.commit.pushError = (p.stderr || p.stdout).trim().slice(0, 400); ev(fix, 'push failed', b.by, fix.commit.pushError); }
    }
    put(fix);
    publish(fix);
    return ok(slim(fix));
  }

  /**
   * The agent's way: the approved change on a branch of its own — `git worktree add -B <branch>` from what the code
   * folder's branch has on its remote (fetched), in a folder apart (never the person's checkout, nor the running app);
   * the edits tried there (the code moved on: out of date), the related tests before and after, the files written, a
   * commit with the message given (the issue's number), pushed; the pull request's address made (GitHub compare).
   */
  async function applyToBranch(b) {
    b = b || {};
    const fix = byId(b.fix);
    if (!fix) return no('No such fix.');
    if (fix.status !== 'proposed' && fix.status !== 'undone') return no('Only a proposal can be applied (this one is ' + fix.status + ').');
    const branch = str(b.branch).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{1,90}$/.test(branch) || /\.\.|\/\/|\.lock$|\/$/.test(branch)) return no('Not a branch name: ' + branch);
    // each step said as it goes: { key, state: running | done | failed | skipped, detail }
    const say = (key, state, detail) => { if (typeof b.onStep === 'function') { try { b.onStep({ key: key, state: state, detail: str(detail).slice(0, 400) }); } catch (e) { /* the screen is gone */ } } };
    const f = fix.folder;
    const g = await gitState(f);
    if (!g.git) { say('fetch', 'failed', g.reason); return no(g.reason); }
    // tried in its sandbox already (makeSandbox): committed and pushed from there — the folder stays, to run it again
    const sbx = b.sandbox && b.sandbox.dir && isDir(b.sandbox.dir) && inSbRoot(b.sandbox.dir) ? b.sandbox : null;
    if (b.sandbox && !sbx) { say('branch', 'failed', 'the sandbox is not on this PC any more'); return no('The sandbox is not on this PC any more: make it again, or throw it away.'); }
    if (sbx && sbx.branch !== branch) { say('branch', 'failed', 'the sandbox is on ' + sbx.branch); return no('The sandbox is on ' + sbx.branch + ', not ' + branch + '.'); }
    const remote = sbx ? sbx.remote : ((g.upstream.split('/')[0]) || 'origin');
    const baseBranch = sbx ? sbx.baseBranch : (g.upstream ? g.upstream.slice(remote.length + 1) : g.branch);
    let fetched, start, wt, done;
    if (sbx) {
      fetched = { code: sbx.fetched ? 0 : 1 }; start = sbx.start; wt = sbx.dir; done = async () => {};
      say('fetch', 'done', 'the sandbox has the code from ' + start + ' @ ' + str(sbx.baseCommit).slice(0, 7));
      say('branch', 'done', branch + ' — the sandbox, where the fix was tried (' + wt + ')');
    } else {
      say('fetch', 'running', 'git fetch ' + remote + ' ' + baseBranch);
      fetched = await git(f, ['fetch', '--quiet', remote, baseBranch]);
      start = fetched.code === 0 ? remote + '/' + baseBranch : (g.upstream || 'HEAD');
      if ((fetched.stderr || '').trim()) say('fetch', 'log', 'git: ' + fetched.stderr.trim().slice(0, 400));
      say('fetch', fetched.code === 0 ? 'done' : 'skipped', fetched.code === 0 ? 'from ' + start : 'could not fetch (' + (fetched.stderr || '').trim().slice(0, 200) + '): starting from ' + start);
      say('branch', 'running', branch + ' from ' + start + ', in a folder apart');
      const wtRoot = path.join(dir || require('os').tmpdir(), 'worktrees');
      wt = path.join(wtRoot, branch.replace(/[^A-Za-z0-9._-]/g, '-'));
      fs.mkdirSync(wtRoot, { recursive: true });
      if (isDir(wt)) await git(f, ['worktree', 'remove', '--force', wt]);
      await git(f, ['worktree', 'prune']);
      const add = await git(f, ['worktree', 'add', '-B', branch, wt, start]);
      if (add.code !== 0) { say('branch', 'failed', (add.stderr || add.stdout).trim().slice(0, 300)); return no('Could not make the branch ' + branch + ': ' + (add.stderr || add.stdout).trim().slice(0, 300)); }
      say('branch', 'done', branch + ' from ' + start);
      done = async () => { await git(f, ['worktree', 'remove', '--force', wt]); };
    }
    try {
      say('check', 'running', (fix.files || []).length + ' file(s): ' + (fix.files || []).join(', '));
      let tried;
      if (sbx) {
        // the sandbox holds exactly the change approved: its files as written then, and nothing else changed
        const ch = (await sbChanged(wt)) || [];
        const want = Object.keys(sbx.files || {});
        const off = ch.filter((c) => !sbx.files[c.file] || shaFile(path.join(wt, c.file)) !== sbx.files[c.file]).map((c) => c.file).concat(want.filter((k) => !ch.some((c) => c.file === k)));
        if (sbx.fixId !== fix.id || off.length) {
          say('check', 'failed', 'the sandbox is not the approved change' + (off.length ? ': ' + off.join(', ') : ' (it holds another proposal)') + ' — make it again');
          return no('The sandbox is not the approved change (' + (off.join(', ') || 'it holds another proposal') + '): make the sandbox again, then apply.', { sandboxDiffers: true });
        }
        tried = { errors: [], files: {} };
        for (const rel of want) {
          const was = await git(wt, ['show', 'HEAD:' + rel]);
          const now0 = readText(path.join(wt, rel)) || '';
          tried.files[rel] = { old: was.code === 0 ? was.stdout.replace(/\r\n/g, '\n') : '', neu: now0.replace(/\r\n/g, '\n'), crlf: /\r\n/.test(now0), inSandbox: true };
        }
      } else tried = tryEdits(wt, fix.edits, fix.app);
      const moved = sbx ? [] : (fix.files || []).filter((k) => !tried.files[k] || sha(tried.files[k].old) !== fix.hashes[k]);
      if (tried.errors.length || moved.length) {
        say('check', 'failed', 'the code on ' + start + ' changed since it was proposed: ' + (moved.join(', ') || 'its files') + ' — analyze again');
        fix.status = 'stale'; ev(fix, 'out of date', b.by, 'the code on ' + start + ' is not what the change was made for: ' + (moved.concat(tried.errors.map((e) => e.file)).join(', ') || 'its files'));
        put(fix); await done();
        return no('The code on ' + start + ' changed since this was proposed (' + (moved.join(', ') || 'its files') + '): analyze again.', { fix: slim(fix), stale: true });
      }
      say('check', 'done', sbx ? 'the sandbox holds exactly the approved change (' + Object.keys(tried.files).length + ' file(s))' : 'it fits the code on ' + start);
      say('before', 'running', sbx ? 'what the tests did when the sandbox was made, before the fix' : 'finding the tests that name this page…');
      const told = (key) => (i, n, t) => say(key, 'log', t.file + ': ' + (t.timedOut ? 'stopped after ' + Math.round(t.ms / 1000) + ' s (too long)' : (t.ok ? '✓ ' : '✗ ') + t.passed + ' passed, ' + t.failed + ' failed')
        + ' (' + (t.ms / 1000).toFixed(1) + ' s)' + (t.failures.length ? ' — ' + t.failures.slice(0, 3).join(' | ') : ''));
      const base = sbx ? { unit: sbx.baseline || [] } : await runUnits(fix, wt, (i, n, file) => say('before', 'running', 'test ' + (i + 1) + ' of ' + n + ': ' + file), told('before'));
      say('before', base.unit.length ? 'done' : 'skipped', base.unit.length ? base.unit.filter((u) => u.ok).length + ' of ' + base.unit.length + ' passing before the change' + (sbx ? ' (when the sandbox was made)' : '') : 'no unit test names this page (the page checks run)');
      say('write', 'running', sbx ? 'already in the sandbox: ' + Object.keys(tried.files).join(', ') : Object.keys(tried.files).join(', '));
      Object.keys(tried.files).forEach((rel) => {
        const x = tried.files[rel];
        if (x.inSandbox) return;
        fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
        fs.writeFileSync(path.join(wt, rel), x.crlf ? x.neu.replace(/\n/g, '\r\n') : x.neu);
      });
      // Old EquipRite is kept unchanged by agreement (its guard test): a change there approved as agreed is named in the
      // guard's AGREED list, with the issue and who approved it, in this same commit — the decision visible in review
      const oldFiles = Object.keys(tried.files).filter((k) => k.indexOf('webApps/vbredwoodapp/') === 0);
      if (b.allowOld && oldFiles.length && isFile(path.join(wt, OLD_GUARD))) {
        const g0 = fs.readFileSync(path.join(wt, OLD_GUARD), 'utf8');
        const q = (s) => "'" + str(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
        const entry = '  { why: ' + q(str(b.allowOldWhy || ('Code fix approved by ' + (b.by || 'someone'))).slice(0, 240) + ' (' + now().toISOString().slice(0, 10) + ')') + ',\n    paths: [\n'
          + oldFiles.map((k) => '      ' + q(k)).join(',\n') + '\n    ] },\n';
        const g1 = g0.replace(/const AGREED = \[\n/, (m) => m + entry);
        if (g1 !== g0) {
          fs.writeFileSync(path.join(wt, OLD_GUARD), g1);
          tried.files[OLD_GUARD] = { old: g0, neu: g1, crlf: false };
          say('write', 'running', 'and agreed for Old EquipRite: ' + oldFiles.join(', ') + ' named in ' + OLD_GUARD);
        }
      }
      say('write', 'done', Object.keys(tried.files).length + ' file(s) written on ' + branch + (tried.files[OLD_GUARD] && b.allowOld ? ' (with the Old EquipRite agreement)' : ''));
      say('after', 'running', 'the same tests, with the change…');
      const after = await runUnits(fix, wt, (i, n, file) => say('after', 'running', 'test ' + (i + 1) + ' of ' + n + ': ' + file), told('after'));
      const checks = checksFor(wt, Object.keys(tried.files).reduce((m, k) => { m[k] = { old: tried.files[k].old, neu: tried.files[k].neu }; return m; }, {}));
      const unit = after.unit.map((t) => {
        const was = base.unit.filter((x) => x.file === t.file)[0];
        const newFailures = t.ok ? [] : (was && !was.ok ? t.failures.filter((x) => was.failures.indexOf(x) === -1) : (t.failures.length ? t.failures : ['it failed']));
        return { file: t.file, ok: t.ok, passed: t.passed, failed: t.failed, failures: t.failures, newFailures: newFailures, before: was ? (was.ok ? 'passed' : was.failed + ' failing before the fix') : '', ms: t.ms,
          out: newFailures.length ? str(t.out).slice(-8000) : '', guard: t.file === OLD_GUARD };
      });
      const bad = checks.filter((c) => !c.ok && !c.already).length + unit.filter((u) => u.newFailures.length).length;
      fix.tests = { at: now().toISOString(), ok: bad === 0, checks: checks, unit: unit, e2eFiles: after.e2eFiles || [], none: !unit.length, where: branch };
      const broke = unit.filter((u) => u.newFailures.length).map((u) => u.file + ': ' + u.newFailures[0]).concat(checks.filter((c) => !c.ok && !c.already).map((c) => 'check: ' + c.name + (c.detail ? ' — ' + c.detail : '')));
      say('after', bad ? (b.anyway ? 'skipped' : 'failed') : 'done', bad ? bad + ' new failure(s)' + (b.anyway ? ', applied anyway: ' + str(b.anywayWhy || 'accepted') : ': not committed') + ' — ' + broke.join(' · ').slice(0, 300)
        : 'nothing broke' + (unit.length ? ' (' + unit.length + ' test file(s), the page checks)' : ' (the page checks)'));
      if (bad && !b.anyway) {
        if (sbx && tried.files[OLD_GUARD] && !tried.files[OLD_GUARD].inSandbox) { try { fs.writeFileSync(path.join(wt, OLD_GUARD), tried.files[OLD_GUARD].old); } catch (e) { /* kept */ } }
        say('end', 'failed', 'the change breaks ' + bad + ' check(s) or test(s): not committed');
        ev(fix, 'tested on ' + branch, b.by, 'something broke: ' + bad + ' new failure(s) — not committed');
        put(fix); await done();
        return no('The change breaks ' + bad + ' check(s) or test(s) on ' + branch + ': not committed. See the tests below.', { fix: slim(fix), broke: true });
      }
      const msg = str(b.message).trim() || ('Code fix: ' + fix.label + ' — ' + fix.request.split('\n')[0].slice(0, 90));
      say('commit', 'running', msg.split('\n')[0]);
      await git(wt, ['add', '--'].concat(Object.keys(tried.files)));
      const c = await git(wt, ['commit', '-m', msg, '--'].concat(Object.keys(tried.files)));
      if (c.code !== 0) {
        const why = (c.stderr || c.stdout).trim();
        say('commit', 'failed', why.slice(0, 300));
        put(fix); await done();
        return no('git commit failed: ' + why.slice(0, 300), { hint: /user\.(name|email)|identity/i.test(why) ? 'Tell git who you are: git config --global user.name "Your Name" and git config --global user.email you@example.com' : '' });
      }
      const shaC = (await git(wt, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
      say('commit', 'done', shaC + ' · ' + msg.split('\n')[0]);
      say('push', 'running', 'git push ' + remote + ' ' + branch + ' (if Git asks you to sign in, its window may be behind this one)');
      const pushed = b.push === false ? { code: 1, stderr: 'not pushed (asked)' } : await git(wt, ['push', '-u', remote, branch]);
      if (((pushed.stderr || '') + (pushed.stdout || '')).trim()) say('push', 'log', 'git: ' + ((pushed.stderr || '') + ' ' + (pushed.stdout || '')).trim().slice(0, 600));
      say('push', pushed.code === 0 ? 'done' : 'failed', pushed.code === 0 ? 'to ' + remote + '/' + branch : (pushed.stderr || pushed.stdout).trim().slice(0, 300));
      const url = (await git(f, ['remote', 'get-url', remote])).stdout.trim();
      const gh = /github\.com[/:]([^/]+)\/([^/.\s]+)(\.git)?\/?$/.exec(url) || /\/git\/([^/]+)\/([^/.\s]+)(\.git)?\/?$/.exec(url);
      const pr = gh && pushed.code === 0 ? 'https://github.com/' + gh[1] + '/' + gh[2] + '/compare/' + encodeURIComponent(baseBranch) + '...' + encodeURIComponent(branch) + '?expand=1'
        + '&title=' + encodeURIComponent(msg.split('\n')[0]) + '&body=' + encodeURIComponent(str(b.prBody).slice(0, 4000)) : '';
      say('end', 'done', shaC);
      say('pr', pr ? 'done' : 'skipped', pr ? 'ready to open' : (pushed.code === 0 ? 'not a GitHub repository: open it on your git site' : 'needs the branch pushed'));
      fix.branchApply = { branch: branch, base: baseBranch, start: start, sha: shaC, pushed: pushed.code === 0, pushError: pushed.code === 0 ? '' : (pushed.stderr || pushed.stdout).trim().slice(0, 300), pr: pr, at: now().toISOString(), by: str(b.by) };
      fix.applied = { at: now().toISOString(), by: str(b.by), branch: branch, upstream: pushed.code === 0 ? remote + '/' + branch : '', pull: { done: fetched.code === 0, text: 'From ' + start + ', on a branch of its own: ' + branch + '.' }, live: false };
      fix.commit = { sha: shaC, at: now().toISOString(), pushed: pushed.code === 0, branch: branch, by: str(b.by), upstream: pushed.code === 0 ? remote + '/' + branch : '', pushError: fix.branchApply.pushError };
      fix.status = 'committed';
      ev(fix, 'approved and applied', b.by, 'on its own branch ' + branch + ' (from ' + start + ')' + (sbx ? ', from the sandbox it was tried in' : ''));
      ev(fix, 'tested', b.by, bad ? 'applied anyway with ' + bad + ' new failure(s)' + (b.anywayWhy ? ': ' + str(b.anywayWhy) : '') : 'nothing broke' + (unit.length ? ' (' + unit.length + ' related test file(s))' : ' (checks only)'));
      if (b.allowOld && tried.files[OLD_GUARD]) ev(fix, 'agreed for Old EquipRite', b.by, oldFiles.join(', ') + ' named in ' + OLD_GUARD);
      ev(fix, 'committed', b.by, shaC + ' on ' + branch);
      ev(fix, pushed.code === 0 ? 'pushed' : 'push failed', b.by, pushed.code === 0 ? 'to ' + remote + '/' + branch + (pr ? ' · pull request ready' : '') : fix.branchApply.pushError);
      put(fix);
      publish(fix);
      await done();
      return ok(slim(fix));
    } catch (e) {
      say('write', 'failed', str(e && e.message));
      await done();
      return no('Applying on ' + branch + ' failed: ' + str(e && e.message));
    }
  }

  // ── Sandboxes: the change tried first, in a copy of the code, before anyone approves it ─────────────────────────────
  // A sandbox is a folder of its own (this app's data folder, sandboxes/<branch>): a git worktree of the code folder on
  // the issue's branch (fix/<KEY>), from what the code folder's branch has on its remote (fetched), at a known commit.
  // The fix is written there — never in the person's checkout — the related tests run there before and after, the app is
  // built there with this project's own build tool (--git-sources / --target: its own build/ folder), and served on a
  // port of its own (o.serveSandbox), so the app can be run and the page checked. Approved, the change is committed and
  // pushed from there (applyToBranch with the sandbox). Thrown away (or the issue closed), the folder goes.
  const sbRoot = () => path.resolve(dir || require('os').tmpdir(), 'sandboxes');
  const sbDirOf = (branch) => path.join(sbRoot(), branch.replace(/[^A-Za-z0-9._-]/g, '-'));
  const inSbRoot = (p) => { const r = path.resolve(str(p)); return r.indexOf(sbRoot() + path.sep) === 0 && r.length > sbRoot().length + 1; };
  const yes = (x) => Object.assign({ ok: true }, x);
  const sbServers = {}; // `<dir>|<webApp>` → Promise<{ url, close }>
  const okBranch = (branch) => /^[A-Za-z0-9][A-Za-z0-9._\/-]{1,90}$/.test(branch) && !/\.\.|\/\/|\.lock$|\/$/.test(branch);
  const sayer = (b) => (key, state, detail) => { if (typeof b.onStep === 'function') { try { b.onStep({ key: key, state: state, detail: str(detail).slice(0, 400) }); } catch (e) { /* the screen is gone */ } } };
  const toldOf = (say) => (key) => (i, n, t) => say(key, 'log', t.file + ': ' + (t.timedOut ? 'stopped after ' + Math.round(t.ms / 1000) + ' s (too long)' : (t.ok ? '✓ ' : '✗ ') + t.passed + ' passed, ' + t.failed + ' failed')
    + ' (' + (t.ms / 1000).toFixed(1) + ' s)' + (t.failures.length ? ' — ' + t.failures.slice(0, 3).join(' | ') : ''));
  const shaFile = (p) => { try { return sha(fs.readFileSync(p, 'utf8')); } catch (e) { return ''; } };
  /** The files a sandbox changed from its base (git status, the build/ folder aside): [{ file, state: 'M'|'A'|'D'|… }]. */
  async function sbChanged(sb) {
    const st = await git(sb, ['status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude)build']);
    if (st.code !== 0) return null;
    return st.stdout.split('\n').filter((l) => l.trim()).map((l) => ({ state: l.slice(0, 2).trim() || 'M', file: l.slice(3).trim().replace(/^"|"$/g, '') }))
      .filter((x) => x.file.indexOf('build/') !== 0 && x.file !== 'build');
  }
  /** Build the app in the sandbox with this project's build tool (its node_modules): build/processed in the sandbox. */
  function buildSandbox(sb) {
    if (typeof o.buildSandbox === 'function') return Promise.resolve(o.buildSandbox(sb)).catch((e) => ({ ok: false, error: str(e && e.message) }));
    const tool = path.resolve(o.buildTool || path.join(__dirname, '..', '..'));
    const grunt = path.join(tool, 'node_modules', 'grunt', 'bin', 'grunt');
    if (!isFile(grunt)) return Promise.resolve({ ok: false, error: 'The build tool is not installed: run npm install in ' + tool + '.' });
    if (!isFile(path.join(sb, 'visual-application.json'))) return Promise.resolve({ ok: false, error: 'The code has no visual-application.json, so the app cannot be built.' });
    return new Promise((resolve) => {
      const t0 = Date.now();
      const env = Object.assign({}, process.env, process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {});
      require('child_process').execFile(process.execPath, [grunt, 'vb-clean', 'vb-process-local', '--git-sources=' + sb, '--target=' + path.join(sb, 'build')],
        { cwd: tool, env: env, timeout: 600000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
          const out = (str(stdout) + str(stderr)).replace(/\x1b\[[0-9;]*m/g, '');
          resolve({ ok: !err, ms: Date.now() - t0, error: err ? (out.split('\n').filter((l) => /error|fatal|warning:/i.test(l)).slice(-6).join(' ').trim() || str(err.message)).slice(0, 600) : '', out: out.slice(-3000) });
        });
    });
  }
  /** Stop its local servers, and take the folder away (the worktree, and the local branch unless kept). */
  async function dropSandbox(f, sb, branch, keepBranch) {
    Object.keys(sbServers).filter((k) => k.indexOf(sb + '|') === 0).forEach((k) => { const p = sbServers[k]; delete sbServers[k]; Promise.resolve(p).then((s) => s && s.close && s.close()).catch(() => {}); });
    if (isDir(sb)) {
      const rm = await git(f, ['worktree', 'remove', '--force', sb]);
      if (rm.code !== 0 && isDir(sb) && inSbRoot(sb)) { try { fs.rmSync(sb, { recursive: true, force: true }); } catch (e) { /* in use */ } }
    }
    await git(f, ['worktree', 'prune']);
    if (branch && !keepBranch) await git(f, ['branch', '-D', branch]);
    return !isDir(sb);
  }

  /**
   * Make the sandbox for a proposed fix: { fix, branch, by, onStep } → { ok, sandbox }. Steps (onStep): fetch, copy, check,
   * before, write, build, end. Made again (a newer fix, newer code), the old folder goes first.
   */
  async function makeSandbox(b) {
    b = b || {};
    const fix = byId(b.fix);
    if (!fix) return no('No such fix.');
    if (!(fix.files || []).length) return no('This proposal changes no file: there is nothing to try.');
    const branch = str(b.branch).trim();
    if (!okBranch(branch)) return no('Not a branch name: ' + branch);
    const say = sayer(b), told = toldOf(say);
    const f = fix.folder;
    const g = await gitState(f);
    if (!g.git) { say('fetch', 'failed', g.reason); say('end', 'failed', g.reason); return no(g.reason); }
    const remote = (g.upstream.split('/')[0]) || 'origin';
    const baseBranch = g.upstream ? g.upstream.slice(remote.length + 1) : g.branch;
    say('fetch', 'running', 'git fetch ' + remote + ' ' + baseBranch);
    const fetched = await git(f, ['fetch', '--quiet', remote, baseBranch]);
    const start = fetched.code === 0 ? remote + '/' + baseBranch : (g.upstream || 'HEAD');
    if ((fetched.stderr || '').trim()) say('fetch', 'log', 'git: ' + fetched.stderr.trim().slice(0, 400));
    say('fetch', fetched.code === 0 ? 'done' : 'skipped', fetched.code === 0 ? 'from ' + start : 'could not fetch (' + (fetched.stderr || '').trim().slice(0, 200) + '): starting from ' + start);
    const sb = sbDirOf(branch);
    say('copy', 'running', 'a copy of the code from ' + start + ' into ' + sb);
    fs.mkdirSync(sbRoot(), { recursive: true });
    await dropSandbox(f, sb, '', true);
    const add = await git(f, ['worktree', 'add', '-B', branch, sb, start]);
    if (add.code !== 0) {
      const why = (add.stderr || add.stdout).trim().slice(0, 300);
      say('copy', 'failed', why); say('end', 'failed', 'could not make the sandbox');
      return no('Could not make the sandbox (' + branch + '): ' + why);
    }
    const baseCommit = (await git(sb, ['rev-parse', 'HEAD'])).stdout.trim();
    say('copy', 'done', branch + ' from ' + start + ' @ ' + baseCommit.slice(0, 7) + ' — ' + sb);
    say('check', 'running', (fix.files || []).length + ' file(s): ' + (fix.files || []).join(', '));
    const tried = tryEdits(sb, fix.edits, fix.app);
    const moved = (fix.files || []).filter((k) => !tried.files[k] || sha(tried.files[k].old) !== fix.hashes[k]);
    if (tried.errors.length || moved.length) {
      const what = moved.concat(tried.errors.map((e) => e.file)).filter((x, i, a) => a.indexOf(x) === i).join(', ') || 'its files';
      say('check', 'failed', 'the code on ' + start + ' changed since the fix was proposed: ' + what + ' — analyze again');
      say('end', 'failed', 'the fix does not fit the latest code');
      await dropSandbox(f, sb, branch, false);
      return no('The code on ' + start + ' changed since this was proposed (' + what + '): analyze again.', { stale: true });
    }
    say('check', 'done', 'it fits the code on ' + start);
    say('before', 'running', 'finding the tests that name this page…');
    const base = await runUnits(fix, sb, (i, n, file) => say('before', 'running', 'test ' + (i + 1) + ' of ' + n + ': ' + file), told('before'));
    say('before', base.unit.length ? 'done' : 'skipped', base.unit.length ? base.unit.filter((u) => u.ok).length + ' of ' + base.unit.length + ' passing before the fix' : 'no unit test names this page');
    say('write', 'running', Object.keys(tried.files).join(', '));
    const files = {};
    Object.keys(tried.files).forEach((rel) => {
      const x = tried.files[rel];
      fs.mkdirSync(path.dirname(path.join(sb, rel)), { recursive: true });
      fs.writeFileSync(path.join(sb, rel), x.crlf ? x.neu.replace(/\n/g, '\r\n') : x.neu);
      files[rel] = shaFile(path.join(sb, rel));
    });
    say('write', 'done', Object.keys(files).length + ' file(s) changed in the sandbox — your own code folder is not touched');
    say('build', 'running', 'building the app in the sandbox (its own build folder)…');
    const built = await buildSandbox(sb);
    say('build', built.ok ? 'done' : 'failed', built.ok ? 'built in ' + (built.ms / 1000).toFixed(1) + ' s' : str(built.error) || 'the build failed');
    if (!built.ok && built.out) say('build', 'log', 'build: ' + str(built.out).slice(-600));
    const sandbox = {
      dir: sb, branch: branch, remote: remote, baseBranch: baseBranch, start: start, baseCommit: baseCommit, fetched: fetched.code === 0, fixId: fix.id, app: fix.app, page: fix.page,
      files: files, at: now().toISOString(), by: str(b.by), pc: require('os').hostname(),
      baseline: base.unit.map((t) => ({ file: t.file, ok: t.ok, passed: t.passed, failed: t.failed, failures: t.failures, ms: t.ms })), e2eFiles: base.e2eFiles || [],
      built: { ok: !!built.ok, at: now().toISOString(), ms: built.ms || 0, error: built.ok ? '' : str(built.error) },
    };
    say('end', 'done', built.ok ? 'the sandbox is ready: run it' : 'made, but the app could not be built in it');
    ev(fix, 'sandbox made', b.by, branch + ' from ' + start + ' @ ' + baseCommit.slice(0, 7) + (built.ok ? '' : ' (not built: ' + str(built.error).slice(0, 120) + ')'));
    put(fix);
    return yes({ sandbox: sandbox, warning: built.ok ? '' : 'The sandbox is made, but the app could not be built in it: ' + str(built.error) });
  }

  /** Is it there, on this PC; what it changed (git), how far behind its base branch it is; its diff. */
  async function sandboxStatus(sbx, opts) {
    if (!sbx || !sbx.dir) return { ok: true, exists: false };
    const here = !sbx.pc || sbx.pc === require('os').hostname();
    if (!here || !isDir(sbx.dir)) return { ok: true, exists: false, here: here };
    const changed = await sbChanged(sbx.dir);
    if (!changed) return { ok: true, exists: false, here: here };
    const head = (await git(sbx.dir, ['rev-parse', 'HEAD'])).stdout.trim();
    const behind = await git(sbx.dir, ['rev-list', '--count', 'HEAD..' + sbx.start]);
    const same = changed.length === Object.keys(sbx.files || {}).length && changed.every((c) => sbx.files[c.file] && shaFile(path.join(sbx.dir, c.file)) === sbx.files[c.file]);
    const out = { ok: true, exists: true, here: true, head: head.slice(0, 7), committed: head !== sbx.baseCommit, changed: changed, asMade: same || head !== sbx.baseCommit,
      behind: behind.code === 0 ? Number(behind.stdout.trim()) || 0 : 0, built: isFile(path.join(sbx.dir, 'build', 'processed', 'webApps', sbx.app || '', 'index.html')) };
    if (opts && opts.diff) out.diff = str((await git(sbx.dir, ['diff', '--no-color', head !== sbx.baseCommit ? sbx.baseCommit : 'HEAD', '--', '.', ':(exclude)build'])).stdout).slice(0, 120000);
    // where its data comes from: the same services as the app (its Fusion, from the code's catalog) — real data
    const fusion = (() => { try { const c = JSON.parse(fs.readFileSync(path.join(sbx.dir, 'services', 'catalog.json'), 'utf8')).backends || {}; const bk = c.fusion || c.bipService; return bk && bk.servers && bk.servers[0] ? String(bk.servers[0].url || '') : ''; } catch (e) { return ''; } })();
    const host = (/^https?:\/\/([^/:]+)/.exec(fusion) || [])[1] || '';
    out.data = { fusion: fusion, host: host, prod: !!host && !/(dev|test|tst|uat|sit|stag|stg|demo|qa|sandbox|train)/i.test(host) };
    return out;
  }
  /** Its local server (one per sandbox and app, on a port of its own), started once: { ok, url }. */
  async function sandboxServer(sbx) {
    if (typeof o.serveSandbox !== 'function') return no('Running a sandbox needs the desktop app.');
    if (!isFile(path.join(sbx.dir, 'build', 'processed', 'webApps', sbx.app, 'index.html'))) return no('The app is not built in the sandbox: make the sandbox again.');
    const k = sbx.dir + '|' + sbx.app;
    if (!sbServers[k]) sbServers[k] = Promise.resolve(o.serveSandbox({ dir: sbx.dir, buildDir: path.join(sbx.dir, 'build'), webApp: sbx.app })).catch((e) => { delete sbServers[k]; throw e; });
    try { const s = await sbServers[k]; return yes({ url: String(s.url).replace(/\/$/, '') }); } catch (e) { return no('Could not start the sandbox\'s app: ' + str(e && e.message)); }
  }
  /** Where to run it: the sandbox's address of the issue's page (and the same page in the app as it is now). */
  async function sandboxRun(sbx) {
    const st = await sandboxStatus(sbx);
    if (!st.exists) return no(st.here === false ? 'The sandbox is on another PC (' + sbx.pc + ').' : 'There is no sandbox on this PC: make it first.');
    const srv = await sandboxServer(sbx);
    if (!srv.ok) return srv;
    const facts = scan.analyze(sbx.dir, sbx.page);
    const route = (facts && facts.route && facts.route.url) || '';
    const cur = typeof o.appUrl === 'function' ? str(o.appUrl(sbx.app)).replace(/\/$/, '') : '';
    return yes({ url: srv.url + (route || '/'), base: srv.url, current: cur ? cur + (route || '/') : '', route: route, needs: route ? '' : str(facts && facts.route && facts.route.needs) || 'another screen' });
  }
  /** Screenshots of the issue's page: before (the app as it is now) and after (the sandbox). */
  async function sandboxShots(sbx) {
    if (typeof o.capture !== 'function') return no('Screenshots need the desktop app.');
    const run = await sandboxRun(sbx);
    if (!run.ok) return run;
    if (!run.route) return no('This page is opened from ' + run.needs + ', so it cannot be opened alone for a screenshot: run it and look.');
    const after = await o.capture(sbx.app, run.route, run.base);
    const before = await o.capture(sbx.app, run.route);
    if (!after || !after.ok) return no((after && after.error) || 'Could not take the sandbox\'s screenshot.');
    return yes({ after: after, before: before && before.ok ? before : null, beforeError: before && before.ok ? '' : str(before && before.error) });
  }
  /** The related tests again, in the sandbox, against what they did before the fix (when it was made); the page checks. */
  async function sandboxTests(sbx, b) {
    b = b || {};
    const fix = byId(sbx && sbx.fixId);
    const st = await sandboxStatus(sbx);
    if (!st.exists) return no('There is no sandbox on this PC: make it first.');
    if (!fix) return no('No such fix.');
    const say = sayer(b), told = toldOf(say);
    const after = await runUnits(fix, sbx.dir, (i, n, file) => say('after', 'running', 'test ' + (i + 1) + ' of ' + n + ': ' + file), told('after'));
    const changedFiles = st.changed.map((c) => c.file);
    const pairs = {};
    for (const rel of changedFiles) {
      const was = await git(sbx.dir, ['show', sbx.baseCommit + ':' + rel]);
      pairs[rel] = { old: was.code === 0 ? was.stdout.replace(/\r\n/g, '\n') : '', neu: readText(path.join(sbx.dir, rel)) == null ? '' : readText(path.join(sbx.dir, rel)).replace(/\r\n/g, '\n') };
    }
    const checks = checksFor(sbx.dir, pairs);
    const unit = after.unit.map((t) => {
      const was = (sbx.baseline || []).filter((x) => x.file === t.file)[0];
      const newFailures = t.ok ? [] : (was && !was.ok ? t.failures.filter((x) => was.failures.indexOf(x) === -1) : (t.failures.length ? t.failures : ['it failed']));
      return { file: t.file, ok: t.ok, passed: t.passed, failed: t.failed, failures: t.failures, newFailures: newFailures, before: was ? (was.ok ? 'passed' : was.failed + ' failing before the fix') : '', ms: t.ms,
        out: newFailures.length ? str(t.out).slice(-8000) : '', guard: t.file === OLD_GUARD };
    });
    const bad = checks.filter((c) => !c.ok && !c.already && !c.warn).length + unit.filter((u) => u.newFailures.length).length;
    return yes({ tests: { at: now().toISOString(), ok: bad === 0, bad: bad, checks: checks, unit: unit, none: !unit.length, where: 'the sandbox (' + sbx.branch + ')' } });
  }
  /** Throw it away: its servers stopped, its folder deleted (its local branch too, unless kept: pushed for review). */
  async function removeSandbox(sbx, b) {
    if (!sbx || !sbx.dir) return yes({ removed: false });
    if (!inSbRoot(sbx.dir)) return no('Not a sandbox folder: ' + sbx.dir);
    if (sbx.pc && sbx.pc !== require('os').hostname()) return no('The sandbox is on another PC (' + sbx.pc + ').');
    const fix = byId(sbx.fixId);
    const f = (fix && fix.folder) || folder();
    const gone = await dropSandbox(f, path.resolve(sbx.dir), sbx.branch, !!(b && b.keepBranch));
    if (fix) { ev(fix, 'sandbox thrown away', b && b.by, sbx.branch + (b && b.keepBranch ? ' (the branch kept)' : '')); put(fix); }
    return gone ? yes({ removed: true }) : no('The sandbox folder could not be deleted (is a file in it open?): ' + sbx.dir);
  }

  function discard(b) {
    const fix = byId(b && b.fix);
    if (!fix) return no('No such fix.');
    if (fix.status === 'applied' || fix.status === 'committed') return no('It is applied: undo it instead.');
    fix.status = 'discarded'; ev(fix, 'discarded', b && b.by, ''); put(fix);
    return ok(slim(fix));
  }

  return {
    info: info, setFolder: setFolder, pick: pick,
    list: (pageId) => ({ ok: true, fixes: data().fixes.filter((x) => !pageId || x.page === str(pageId)).map((x) => ({ id: x.id, request: x.request, status: x.status, at: x.at, by: x.by, files: x.files, provider: x.provider })) }),
    get: (id) => { const x = local(id) || sharedOne(id); return x ? ok(x.shared ? x : slim(x)) : no('No such fix.'); },
    history: history, flush: () => pubChain,
    shot: shot, img: img, analyze: analyze, applyToBranch: applyToBranch,
    makeSandbox: makeSandbox, sandboxStatus: sandboxStatus, sandboxRun: sandboxRun, sandboxShots: sandboxShots, sandboxTests: sandboxTests, removeSandbox: removeSandbox, sandboxDirOf: sbDirOf,
    pageOf: (id) => { const p = scan.analyze(folder(), str(id)); return p ? { id: p.id, label: p.label, app: p.app, flow: p.flow, page: p.page } : null; }, preview: preview, apply: apply, test: test, e2e: e2e, undo: undo, commit: commit, discard: discard,
    folder: folder,
  };
}

module.exports = { open, parseAnswer, tryEdits, diffOf, checksFor, htmlRules, relatedTests, oldAppWarnings, safeRel, SYSTEM, issueRules, verdictOf };
