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
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const scan = require('./pageScan');
const { runGit } = require('./gitPaths');

const MAX_CODE = 170000;    // characters of code sent to the AI
const MAX_TOKENS = 16000;   // the answer: the analysis and the edits
const KEEP = 150;           // fixes kept in the history

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
  return { unit: find(path.join(folder, 'tests'), /\.test\.js$/).slice(0, 8).map((f) => 'tests/' + f), e2e: find(path.join(folder, 'tests', 'e2e'), /\.e2e\.js$/).slice(0, 4).map((f) => 'tests/e2e/' + f) };
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
  const byId = (id) => data().fixes.filter((x) => x.id === str(id))[0] || null;
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
    const kind = { fix: 'Fix a bug', enhance: 'Enhance', change: 'Change' }[str(b.kind)] || '';
    let user = 'REQUEST' + (kind ? ' (' + kind + ')' : '') + ':\n' + request + '\n';
    if (parent && str(b.refine).trim()) {
      user += '\nYOUR EARLIER PROPOSAL for this request:\n' + str(parent.markdown).slice(0, 12000) + '\n\nIts edits touched: ' + (parent.files || []).join(', ')
        + '\n\nTHE PERSON NOW ASKS:\n' + str(b.refine).trim() + '\n\nGive the whole answer again (all headings, all edits against the code as it is below).\n';
    }
    user += '\nFACTS\n' + factsText(facts) + '\n\nCODE (complete files; copy SEARCH lines exactly from here)\n' + code.text;
    if (code.skipped.length) user += '\n(Not included, too large: ' + code.skipped.join(', ') + ')\n';
    const t0 = Date.now();
    let r = await o.ai.chat({ system: SYSTEM, user: user, maxTokens: MAX_TOKENS });
    if (!r || !r.ok) return no((r && r.error) || 'The AI did not answer.');
    let parsed = parseAnswer(r.text);
    let tried = tryEdits(f, parsed.edits, facts.app);
    let checks = checksFor(f, tried.files);
    let retried = false;
    const newFails = (cs) => cs.filter((c) => !c.ok && !c.already);
    if (!parsed.questions && (tried.errors.length || newFails(checks).length || !parsed.edits.length)) {
      const why = [];
      if (!parsed.edits.length) why.push('There were no edits in the SEARCH/REPLACE format (or the format was wrong).');
      tried.errors.forEach((e) => why.push('Edit ' + e.n + ' (' + e.file + '): ' + e.why + (e.search ? '\nIts SEARCH was:\n' + e.search.slice(0, 1500) : '')));
      newFails(checks).forEach((c) => why.push('Check failed after your edits — ' + c.name + ' (' + c.file + ')' + (c.detail ? ': ' + c.detail : '')));
      const again = await o.ai.chat({ system: SYSTEM, user: user + '\n\nYOUR PREVIOUS ANSWER:\n' + r.text.slice(0, 30000) + '\n\nIT COULD NOT BE USED:\n' + why.join('\n\n')
        + '\n\nGive the whole answer again, in the format, with every SEARCH copied exactly from the CODE above.', maxTokens: MAX_TOKENS });
      if (again && again.ok) {
        const p2 = parseAnswer(again.text), t2 = tryEdits(f, p2.edits, facts.app), c2 = checksFor(f, t2.files);
        if (p2.questions || (t2.errors.length + newFails(c2).length) <= (tried.errors.length + newFails(checks).length)) { r = again; parsed = p2; tried = t2; checks = c2; retried = true; }
      }
    }
    const files = Object.keys(tried.files);
    const fix = {
      id: 'fx' + now().getTime().toString(36) + crypto.randomBytes(3).toString('hex'),
      page: facts.id, app: facts.app, label: facts.label, request: request, kind: str(b.kind), refine: str(b.refine).trim(), parent: parent ? parent.id : '',
      at: now().toISOString(), by: str(b.by), provider: r.provider || '', model: r.model || '', ms: Date.now() - t0, retried: retried,
      folder: f, sent: { files: code.files, skipped: code.skipped, chars: code.chars },
      markdown: parsed.markdown || r.text, questions: parsed.questions, edits: parsed.edits, problems: tried.errors, checks: checks,
      files: files, hashes: files.reduce((m, k) => { m[k] = sha(tried.files[k].old); return m; }, {}),
      diff: files.map((k) => diffOf(k, tried.files[k].old, tried.files[k].neu)),
      status: parsed.questions && !files.length ? 'questions' : (tried.errors.length || !files.length || newFails(checks).length ? 'needs-redo' : 'proposed'),
    };
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
      put(fix);
      return ok(slim(fix));
    } catch (e) {
      return no(str(e && e.message));
    } finally {
      Object.keys(kept).forEach((bf) => { try { if (kept[bf] == null) fs.unlinkSync(bf); else fs.writeFileSync(bf, kept[bf]); } catch (e) { /* the next build */ } });
    }
  }
  function shot(id, which) {
    const fix = byId(id);
    const name = fix && fix.preview && fix.preview[which === 'after' ? 'after' : 'before'];
    const p = name ? path.join(fixDir(fix.id), name) : '';
    return p && isFile(p) ? { ok: true, file: p, mime: /png$/.test(p) ? 'image/png' : 'image/jpeg' } : no('No screenshot.');
  }

  async function runUnits(fix, f) {
    const p = scan.pagesOf(f).filter((x) => x.id === fix.page)[0] || { page: '', flow: '', app: fix.app };
    const rel = relatedTests(f, p);
    const out = [];
    for (const t of rel.unit) out.push(await runTest(f, t));
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
    if (r.error) { fix.status = 'stale'; put(fix); return no(r.error, { fix: slim(fix) }); }
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
    put(fix);
    const t = await test({ fix: fix.id });
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
    put(fix);
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
    put(fix);
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
    fix.status = 'undone'; fix.undone = { at: now().toISOString() };
    put(fix);
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
    fix.commit = { sha: shaC, at: now().toISOString(), pushed: false, branch: (await gitState(f)).branch };
    fix.status = 'committed';
    if (b.push) {
      const g = await gitState(f);
      const p = g.upstream ? await git(f, ['push']) : await git(f, ['push', '-u', 'origin', 'HEAD']);
      if (p.code === 0) { fix.commit.pushed = true; fix.commit.upstream = g.upstream || 'origin/' + g.branch; } else fix.commit.pushError = (p.stderr || p.stdout).trim().slice(0, 400);
    }
    put(fix);
    return ok(slim(fix));
  }

  function discard(b) {
    const fix = byId(b && b.fix);
    if (!fix) return no('No such fix.');
    if (fix.status === 'applied' || fix.status === 'committed') return no('It is applied: undo it instead.');
    fix.status = 'discarded'; put(fix);
    return ok(slim(fix));
  }

  return {
    info: info, setFolder: setFolder, pick: pick,
    list: (pageId) => ({ ok: true, fixes: data().fixes.filter((x) => !pageId || x.page === str(pageId)).map((x) => ({ id: x.id, request: x.request, status: x.status, at: x.at, by: x.by, files: x.files, provider: x.provider })) }),
    get: (id) => { const x = byId(id); return x ? ok(slim(x)) : no('No such fix.'); },
    shot: shot, analyze: analyze, preview: preview, apply: apply, test: test, e2e: e2e, undo: undo, commit: commit, discard: discard,
    folder: folder,
  };
}

module.exports = { open, parseAnswer, tryEdits, diffOf, checksFor, htmlRules, relatedTests, safeRel, SYSTEM };
