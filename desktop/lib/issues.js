'use strict';
/**
 * Issues (Build.Rite): an issue logged against a page goes from what someone wrote to a reviewed fix on a branch.
 *
 *   logged → written up (the AI) → analyzed (against the page's code and the FDD: a verdict, and for a fix on this page
 *   the exact change, checked) → awaiting approval (in the app, and an approval email from Microsoft 365) → approved →
 *   the agent applies it on a branch of its own (fix/<KEY>: the issue's number in the code's comments and the commit),
 *   tests it, pushes it and makes the pull request → closed. Not a fix on this page: triaged (fix elsewhere, works as
 *   designed, out of scope) or needs information, with what to do instead.
 *
 * Jira stays the record: an issue logged here can be created there (and one there brought here), and each step is a
 * comment on it. Each issue is kept here (issues.json) and, when there is one, on the app's data branch
 * (issues/<id>.json, lib/dataBranch.js) so everyone sees the same list. Self-approval for now (anyone may approve);
 * approval by email reply comes with Mail.Read.
 *
 *   open({ file, dir, ai, fix, mail, jira, fdd, data, now, log, project }) → store
 *     info()  list({ q, status })  get(id)
 *     create({ page, text, kind, images, by, toJira, jiraKey })   format(id, { by })   update(id, fields, { by })
 *     toJira(id, { by })   analyze(id, { refine, by })   ask(id, { email, to, by })   approve(id, { by, via })
 *     reject(id, { by, reason })   apply(id, { by })   close(id, { by, note })   reopen(id, { by })   img(id, n)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gitPaths = require('./gitPaths');

const KEEP = 500;
const STEPS = ['Logged', 'Written up', 'Analyzed', 'Approval', 'Applied', 'Pull request', 'Closed'];
const STAGE = { new: 0, written: 1, analyzed: 2, triaged: 2, 'needs-info': 2, 'awaiting-approval': 3, approved: 3, rejected: 3, 'in-review': 5, closed: 6 };
const VERDICT_LABEL = { 'fix-here': 'Fix on this page', 'fix-elsewhere': 'Fix elsewhere', 'as-designed': 'Works as designed', 'out-of-scope': 'Out of scope', 'needs-info': 'Needs information' };

const FORMAT_SYSTEM = [
  'You write up software issues for the team building EquipRite, an Oracle Visual Builder (VBCS) application on Oracle Fusion.',
  'From what the person wrote (and any screenshots), write the issue clearly, keeping their meaning. Do not invent facts:',
  'leave a field empty when it is not known, and say what is missing under questions. Plain English, short.',
  'Answer ONLY with JSON, nothing else:',
  '{"title": "a one-line title (max 90 characters)", "summary": "two or three sentences", "steps": ["step to reproduce", "…"],',
  ' "expected": "what should happen", "actual": "what happens", "impact": "who is affected and how badly",',
  ' "kind": "bug | enhancement | change", "questions": ["what is missing", "…"]}',
].join('\n');

function str(v) { return v == null ? '' : String(v); }
const sha = (t) => crypto.createHash('sha1').update(str(t)).digest('hex').slice(0, 12);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
/** The first {…} of an answer, parsed. */
function jsonOf(text) {
  const t = str(text);
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i === -1 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { return null; }
}
/** The issue as text, for the analysis and for Jira. */
function issueText(x) {
  const f = x.formatted || {};
  const L = [];
  L.push((f.title || x.title || '').trim());
  if (f.summary) L.push('', f.summary);
  if ((f.steps || []).length) L.push('', 'Steps to reproduce:', f.steps.map((s, i) => (i + 1) + '. ' + s).join('\n'));
  if (f.expected) L.push('', 'Expected: ' + f.expected);
  if (f.actual) L.push('Actual: ' + f.actual);
  if (f.impact) L.push('Impact: ' + f.impact);
  if (x.text && x.text.trim() && x.text.trim() !== (f.summary || '').trim()) L.push('', 'As written by ' + (x.by || 'the person') + ': ' + x.text.trim());
  return L.join('\n').trim();
}
function jiraWiki(x) {
  const f = x.formatted || {};
  const L = [];
  if (f.summary) L.push(f.summary, '');
  if ((f.steps || []).length) L.push('*Steps to reproduce*', f.steps.map((s) => '# ' + s).join('\n'), '');
  if (f.expected) L.push('*Expected:* ' + f.expected);
  if (f.actual) L.push('*Actual:* ' + f.actual);
  if (f.impact) L.push('*Impact:* ' + f.impact);
  L.push('', '*Page:* ' + x.label + ' ({{' + x.page + '}})', '_Logged in Build.Rite by ' + (x.by || 'someone') + '._');
  if (x.text) L.push('', '{quote}' + x.text.slice(0, 4000) + '{quote}');
  return L.join('\n');
}
const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function open(opts) {
  const o = opts || {};
  const file = o.file || '';
  const dir = o.dir || (file ? path.join(path.dirname(file), 'issues') : '');
  const now = o.now || (() => new Date());
  const log = typeof o.log === 'function' ? o.log : () => {};
  let mem = { issues: [] };
  const load = () => { if (!file) return mem; try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { issues: Array.isArray(j.issues) ? j.issues : [] }; } catch (e) { return { issues: [] }; } };
  const save = (d) => { mem = d; if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 1)); };
  const all = () => load().issues;
  const byId = (id) => all().filter((x) => x.id === str(id))[0] || null;
  const ok = (issue, extra) => Object.assign({ ok: true, issue: view(issue) }, extra || {});
  const no = (error, extra) => Object.assign({ ok: false, error: error }, extra || {});

  function ev(x, what, by, detail) {
    x.events = (x.events || []).concat([{ at: now().toISOString(), what: what, by: str(by), detail: str(detail).slice(0, 500) }]);
    x.updatedAt = now().toISOString();
  }
  function put(x) {
    const d = load();
    d.issues = [x].concat(d.issues.filter((y) => y.id !== x.id)).slice(0, KEEP);
    save(d);
    publish(x);
    return x;
  }
  /** What the screen shows: the issue, its fix (the analysis, the change, the tests), its stage. */
  function view(x) {
    const v = Object.assign({}, x);
    v.stage = STAGE[x.status] != null ? STAGE[x.status] : 0;
    v.steps = STEPS.map((t, i) => ({ n: i, label: t, state: i < v.stage ? 'done' : (i === v.stage ? (x.status === 'closed' ? 'done' : 'now') : 'next') }));
    v.verdictLabel = x.verdict ? VERDICT_LABEL[x.verdict.code] || '' : '';
    if (x.fixId && o.fix) { const g = o.fix.get(x.fixId); v.fix = g && g.ok ? g.fix : null; }
    return v;
  }

  // ── shared with everyone: the data branch (issues/<id>.json) ──
  const shared = o.data && o.data.ok ? o.data : null;
  const repo = shared ? gitPaths.create({ root: shared.dir, paths: ['issues'], git: o.git ? (args) => o.git(shared.dir, args) : undefined, gitPath: o.gitPath,
    message: 'Issues: update', sync: { resolve: shared.resolve, after: shared.merged } }) : null;
  let pub = Promise.resolve();
  function publish(x) {
    if (!repo) return pub;
    const rec = Object.assign({}, x, { images: (x.images || []).map((im) => ({ n: im.n, name: im.name })) });
    pub = pub.then(async () => {
      try {
        fs.mkdirSync(path.join(shared.dir, 'issues'), { recursive: true });
        fs.writeFileSync(path.join(shared.dir, 'issues', x.id + '.json'), JSON.stringify(rec, null, 1) + '\n');
        const r = await repo.save({ message: 'Issues: ' + x.key + ' ' + x.status + ' — ' + str((x.formatted && x.formatted.title) || x.title).slice(0, 60) });
        if (!r.ok) log('issues: not pushed (' + r.error + ')');
      } catch (e) { log('issues: ' + e.message); }
    });
    return pub;
  }
  function sharedAll() {
    if (!shared) return [];
    try { return fs.readdirSync(path.join(shared.dir, 'issues')).filter((n) => /^is[a-z0-9]+\.json$/.test(n)).map((n) => { try { return Object.assign(JSON.parse(fs.readFileSync(path.join(shared.dir, 'issues', n), 'utf8')), { shared: true }); } catch (e) { return null; } }).filter(Boolean); } catch (e) { return []; }
  }

  // ── Jira ──
  async function jira(method, p, body) {
    const a = o.jira && typeof o.jira.auth === 'function' ? o.jira.auth() : null;
    if (!a || !a.site || !a.header) return { ok: false, error: 'Jira is not connected (Jira stories → Connect Jira).' };
    const doFetch = o.jira.fetch || (typeof fetch === 'function' ? fetch : null);
    try {
      const r = await doFetch(String(a.site).replace(/\/+$/, '') + p, { method: method, headers: { Authorization: a.header, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      let j = null;
      try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
      if (r.ok) return { ok: true, body: j, site: String(a.site).replace(/\/+$/, '') };
      const why = j ? [].concat(j.errorMessages || [], Object.keys(j.errors || {}).map((k) => k + ': ' + j.errors[k])).join('; ') : '';
      return { ok: false, status: r.status, error: why || ('Jira answered HTTP ' + r.status) };
    } catch (e) { return { ok: false, error: 'Jira did not answer: ' + str(e && e.message) }; }
  }
  async function comment(x, text) {
    if (!x.jira || !x.jira.key) return;
    const r = await jira('POST', '/rest/api/2/issue/' + encodeURIComponent(x.jira.key) + '/comment', { body: text + '\n\n_— Build.Rite_' });
    if (!r.ok) ev(x, 'Jira comment failed', 'Build.Rite', r.error);
  }

  // ── the FDD sections that match the issue (for "works as designed") ──
  function fddContext(x) {
    try {
      const t = o.fdd && typeof o.fdd.pick === 'function' ? o.fdd.pick({ summary: (x.formatted && x.formatted.title) || '', body: issueText(x) }) : '';
      return t ? 'FDD (the sections of the functional design that match this issue — quote them when the verdict is Works as designed or Out of scope)\n' + t : '';
    } catch (e) { return ''; }
  }

  const fixOf = (x) => (x.fixId && o.fix ? (o.fix.get(x.fixId) || {}).fix || null : null);
  const fingerprint = (fx) => (fx ? sha(JSON.stringify([fx.files, fx.hashes, (fx.diff || []).map((d) => d.hunks)])) : '');
  const keyOf = (x) => (x.jira && x.jira.key) || x.key;

  async function info() {
    const mail = o.mail && typeof o.mail.status === 'function' ? (() => { try { const s = o.mail.status(); return { signedIn: !!s.signedIn, account: s.account || '' }; } catch (e) { return { signedIn: false, account: '' }; } })() : { signedIn: false, account: '' };
    const ja = o.jira && typeof o.jira.auth === 'function' ? o.jira.auth() : null;
    return { ok: true, jira: { connected: !!(ja && ja.header), site: ja ? ja.site : '', project: o.project || 'EQP' }, mail: mail, shared: !!shared, branch: shared ? shared.branch : '',
      fix: o.fix ? await o.fix.info() : null, steps: STEPS };
  }
  function list(b) {
    b = b || {};
    const mine = all();
    const rows = mine.concat(sharedAll().filter((x) => !mine.some((m) => m.id === x.id)));
    const words = str(b.q).toLowerCase().split(/\s+/).filter(Boolean);
    const groups = { open: ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'awaiting-approval', 'approved', 'rejected'], approval: ['awaiting-approval'], review: ['approved', 'in-review'], closed: ['closed'] };
    const out = rows.filter((x) => (!b.status || b.status === 'all' || (groups[b.status] || [b.status]).indexOf(x.status) !== -1)
      && (!words.length || words.every((w) => [x.key, x.jira && x.jira.key, x.title, x.formatted && x.formatted.title, x.label, x.page, x.by, x.status].join(' ').toLowerCase().indexOf(w) !== -1)))
      .map((x) => ({ id: x.id, key: keyOf(x), title: (x.formatted && x.formatted.title) || x.title, label: x.label, page: x.page, status: x.status, kind: x.kind,
        verdict: x.verdict ? x.verdict.code : '', verdictLabel: x.verdict ? VERDICT_LABEL[x.verdict.code] || '' : '', by: x.by, at: x.at, updatedAt: x.updatedAt || x.at, jira: x.jira || null, shared: !!x.shared }));
    out.sort((a, c) => str(c.updatedAt).localeCompare(str(a.updatedAt)));
    const count = (st) => rows.filter((x) => (groups[st] || [st]).indexOf(x.status) !== -1).length;
    return { ok: true, issues: out, counts: { all: rows.length, open: count('open'), approval: count('approval'), review: count('review'), closed: count('closed') } };
  }

  async function create(b) {
    b = b || {};
    let text = str(b.text).trim();
    let jiraRef = null;
    if (b.jiraKey) {
      const k = str(b.jiraKey).trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]*-\d+$/.test(k)) return no('Give a Jira key like EQP-123.');
      const r = await jira('GET', '/rest/api/2/issue/' + encodeURIComponent(k) + '?fields=summary,description,issuetype,status', null);
      if (!r.ok) return no('Could not read ' + k + ' from Jira: ' + r.error);
      const fl = (r.body && r.body.fields) || {};
      text = [fl.summary, typeof fl.description === 'string' ? fl.description : '', text].filter(Boolean).join('\n\n');
      jiraRef = { key: k, url: r.site + '/browse/' + k, from: true };
    }
    if (!text) return no('Say what is wrong (or give its Jira key).');
    if (!b.page) return no('Choose the page the issue is on.');
    const facts = o.fix && o.fix.pageOf ? o.fix.pageOf(b.page) : null;
    const id = 'is' + now().getTime().toString(36) + crypto.randomBytes(2).toString('hex');
    const x = { id: id, key: jiraRef ? jiraRef.key : 'BR-' + now().getTime().toString(36).slice(-5).toUpperCase(), page: str(b.page), label: (facts && facts.label) || str(b.page),
      app: (facts && facts.app) || str(b.page).split('/')[0], kind: ['bug', 'enhancement', 'change'].indexOf(b.kind) !== -1 ? b.kind : 'bug', text: text, title: text.split('\n')[0].slice(0, 90),
      by: str(b.by), at: now().toISOString(), status: 'new', images: [], jira: jiraRef, events: [] };
    (Array.isArray(b.images) ? b.images : []).filter((im) => im && /^image\/(png|jpeg|webp|gif)$/.test(im.mime) && im.base64).slice(0, 6).forEach((im, i) => {
      if (!dir) return;
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[im.mime];
      const f = 'img-' + (i + 1) + '.' + ext;
      fs.mkdirSync(path.join(dir, id), { recursive: true });
      fs.writeFileSync(path.join(dir, id, f), Buffer.from(str(im.base64).replace(/^data:[^,]*,/, ''), 'base64'));
      x.images.push({ n: i + 1, name: str(im.name).slice(0, 80) || 'image', mime: im.mime, file: f });
    });
    ev(x, jiraRef ? 'brought from Jira' : 'logged', x.by, jiraRef ? jiraRef.key : x.title);
    put(x);
    return ok(x);
  }
  const imagesOf = (x) => (x.images || []).map((im) => { try { return { name: im.name, mime: im.mime, base64: fs.readFileSync(path.join(dir, x.id, im.file)).toString('base64') }; } catch (e) { return null; } }).filter(Boolean);
  function img(id, n) {
    const x = byId(id);
    const im = x && (x.images || []).filter((y) => String(y.n) === String(n))[0];
    const p = im && dir ? path.join(dir, x.id, im.file) : '';
    return p && fs.existsSync(p) ? { ok: true, file: p, mime: im.mime } : no('No such image.');
  }

  async function format(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (!o.ai || typeof o.ai.chat !== 'function') return no('No AI is set up: choose one in AI settings.');
    const r = await o.ai.chat({ system: FORMAT_SYSTEM, user: 'PAGE: ' + x.label + ' (' + x.page + ')\nKIND: ' + x.kind + '\n\nWHAT THEY WROTE:\n' + x.text, maxTokens: 2000, images: imagesOf(x) });
    if (!r || !r.ok) return no((r && r.error) || 'The AI did not answer.');
    const j = jsonOf(r.text);
    if (!j || !j.title) return no('The AI did not answer in the expected form: try again.');
    x.formatted = { title: str(j.title).slice(0, 120), summary: str(j.summary), steps: (Array.isArray(j.steps) ? j.steps : []).map(str).filter(Boolean).slice(0, 20),
      expected: str(j.expected), actual: str(j.actual), impact: str(j.impact), questions: (Array.isArray(j.questions) ? j.questions : []).map(str).filter(Boolean).slice(0, 8) };
    if (['bug', 'enhancement', 'change'].indexOf(j.kind) !== -1) x.kind = j.kind;
    x.status = x.status === 'new' ? 'written' : x.status;
    ev(x, 'written up', r.provider || 'AI', x.formatted.title);
    put(x);
    return ok(x);
  }
  function update(id, f, b) {
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (STAGE[x.status] >= 3 && x.status !== 'rejected') return no('It is with the approval already: reopen it to change it.');
    f = f || {};
    x.formatted = Object.assign({}, x.formatted || {}, {
      title: f.title != null ? str(f.title).slice(0, 120) : (x.formatted || {}).title, summary: f.summary != null ? str(f.summary) : (x.formatted || {}).summary,
      steps: f.steps != null ? (Array.isArray(f.steps) ? f.steps : str(f.steps).split('\n')).map((s) => str(s).replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean) : (x.formatted || {}).steps || [],
      expected: f.expected != null ? str(f.expected) : (x.formatted || {}).expected, actual: f.actual != null ? str(f.actual) : (x.formatted || {}).actual,
      impact: f.impact != null ? str(f.impact) : (x.formatted || {}).impact });
    if (f.page && f.page !== x.page) { const facts = o.fix && o.fix.pageOf ? o.fix.pageOf(f.page) : null; x.page = f.page; x.label = (facts && facts.label) || f.page; x.app = (facts && facts.app) || x.app; }
    if (x.status === 'new') x.status = 'written';
    ev(x, 'edited', (b && b.by) || '', '');
    put(x);
    return ok(x);
  }
  async function toJira(id, b) {
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.jira && x.jira.key) return ok(x, { already: true });
    const fields = { project: { key: o.project || 'EQP' }, summary: str((x.formatted && x.formatted.title) || x.title).slice(0, 250), description: jiraWiki(x) };
    let r = await jira('POST', '/rest/api/2/issue', { fields: Object.assign({}, fields, { issuetype: { name: x.kind === 'bug' ? 'Bug' : 'Task' } }) });
    if (!r.ok && /issuetype|issue type/i.test(r.error) && x.kind === 'bug') r = await jira('POST', '/rest/api/2/issue', { fields: Object.assign({}, fields, { issuetype: { name: 'Task' } }) });
    if (!r.ok) return no('Could not create it in Jira: ' + r.error);
    const k = r.body && r.body.key;
    x.jira = { key: k, url: r.site + '/browse/' + k };
    x.localKey = x.key; x.key = k;
    ev(x, 'created in Jira', (b && b.by) || '', k);
    put(x);
    return ok(x);
  }

  async function analyze(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (!o.fix) return no('Code analysis is not set up here.');
    if (['awaiting-approval', 'approved', 'in-review', 'closed'].indexOf(x.status) !== -1) return no('It is ' + x.status + ': reopen it to analyze it again.');
    const parent = b.refine && x.fixId ? x.fixId : '';
    const r = await o.fix.analyze({ id: x.page, request: issueText(x), kind: x.kind === 'bug' ? 'fix' : x.kind, images: imagesOf(x), issue: { key: keyOf(x), title: (x.formatted && x.formatted.title) || x.title },
      context: fddContext(x), refine: str(b.refine), parent: parent, by: b.by });
    if (!r.ok) return no(r.error);
    const fx = r.fix;
    x.fixId = fx.id;
    x.verdict = fx.verdict || { code: fx.files.length ? 'fix-here' : '', text: '' };
    if (!x.verdict.code && fx.files.length) x.verdict.code = 'fix-here';
    x.status = x.verdict.code === 'needs-info' || fx.status === 'questions' ? 'needs-info' : (x.verdict.code && x.verdict.code !== 'fix-here' ? 'triaged' : 'analyzed');
    ev(x, b.refine ? 'analyzed again' : 'analyzed', fx.provider || 'AI', (VERDICT_LABEL[x.verdict.code] || 'no verdict') + (fx.files.length ? ' · ' + fx.files.length + ' file(s) to change' : ''));
    await comment(x, 'h4. Build.Rite analysis\n*Verdict:* ' + (VERDICT_LABEL[x.verdict.code] || '—') + '\n' + str(x.verdict.text).split('\n').slice(1).join('\n').trim()
      + (fx.files.length ? '\n*Change proposed:* ' + fx.files.map((f) => '{{' + f + '}}').join(', ') : ''));
    put(x);
    return ok(x);
  }

  // ── approval: in the app (self-approval for now) and an email ──
  function emailHtml(x, fx, code) {
    const f = x.formatted || {};
    const sec = (t) => { const m = new RegExp('##\\s+' + t + '\\s*\\n([\\s\\S]*?)(\\n##\\s|$)', 'i').exec(str(fx.markdown)); return m ? m[1].trim() : ''; };
    const diff = (fx.diff || []).map((d) => '<p style="margin:14px 0 4px;font:600 13px Segoe UI,Arial">' + esc(d.file) + ' <span style="color:#2f7d4f">+' + d.added + '</span> <span style="color:#b3311f">−' + d.removed + '</span></p>'
      + '<pre style="margin:0;padding:8px;background:#f6f8fa;border:1px solid #d4dce4;border-radius:6px;font:12px Consolas,monospace;white-space:pre-wrap">'
      + d.hunks.map((h) => h.rows.map((r) => '<span style="display:block;background:' + (r.t === '+' ? '#e6f6ea' : r.t === '-' ? '#fdecea' : 'transparent') + '">' + esc((r.t === ' ' ? ' ' : r.t) + ' ' + r.s) + '</span>').join('')).join('<hr style="border:0;border-top:1px dashed #ccc">')
      + '</pre>').join('');
    const checks = (fx.checks || []).map((c) => '<li>' + (c.ok ? '✓' : (c.warn ? '⚠' : '✗')) + ' ' + esc(c.name) + '</li>').join('');
    return '<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#16212c;max-width:880px">'
      + '<div style="background:#2c5266;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0"><div style="font-size:12px;opacity:.8">BUILD.RITE · APPROVAL</div><div style="font-size:20px;font-weight:700">' + esc(keyOf(x)) + ' · ' + esc(f.title || x.title) + '</div>'
      + '<div style="font-size:13px;opacity:.85">' + esc(x.label) + ' (' + esc(x.page) + ')</div></div>'
      + '<div style="border:1px solid #d4dce4;border-top:0;padding:14px 18px;border-radius:0 0 8px 8px">'
      + '<p style="margin:0 0 10px;padding:10px 12px;background:#fff4d6;border-radius:6px"><b>To approve:</b> reply with <b>APPROVE</b> on the first line (or <b>REJECT</b> and why), or approve it in Build.Rite → Issues → ' + esc(keyOf(x)) + '. Code: ' + esc(code) + '</p>'
      + (f.summary ? '<p>' + esc(f.summary) + '</p>' : '')
      + '<p><b>Verdict:</b> ' + esc(VERDICT_LABEL[x.verdict && x.verdict.code] || '') + '</p>'
      + (sec('Summary') ? '<p><b>The fix:</b> ' + esc(sec('Summary')) + '</p>' : '')
      + (sec('After the change') ? '<p><b>After the change:</b><br>' + esc(sec('After the change')).replace(/\n/g, '<br>') + '</p>' : '')
      + (sec('Risks') ? '<p><b>Risks:</b> ' + esc(sec('Risks')) + '</p>' : '')
      + '<h3 style="font-size:15px;margin:16px 0 4px">The change</h3>' + diff
      + (checks ? '<h3 style="font-size:15px;margin:16px 0 4px">Checks</h3><ul style="margin:0;padding-left:18px">' + checks + '</ul>' : '')
      + (sec('How to test') ? '<h3 style="font-size:15px;margin:16px 0 4px">How to test</h3><p>' + esc(sec('How to test')).replace(/\n/g, '<br>') + '</p>' : '')
      + '<p style="color:#6b7886;font-size:12px;margin-top:18px">Proposed by ' + esc(fx.provider || 'AI') + ' in Build.Rite for ' + esc(x.by || 'the team') + '. Once approved, the change is applied on its own branch (fix/' + esc(keyOf(x)) + '), tested, and a pull request is made.</p>'
      + '</div></div>';
  }
  async function ask(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    const fx = fixOf(x);
    if (!fx || x.verdict.code !== 'fix-here' || (fx.status !== 'proposed' && fx.status !== 'undone')) return no('Only an analyzed issue with a fix on this page (proposed, checks passing) goes for approval.');
    const code = 'BR-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
    x.approval = { requested: { at: now().toISOString(), by: str(b.by), code: code, fingerprint: fingerprint(fx), email: { wanted: b.email !== false, sent: false, to: '', error: '' } } };
    x.status = 'awaiting-approval';
    if (b.email !== false) {
      const st = o.mail && typeof o.mail.status === 'function' ? (() => { try { return o.mail.status(); } catch (e) { return {}; } })() : {};
      const to = str(b.to).trim() || st.account || '';
      if (!o.mail || !st.signedIn) x.approval.requested.email.error = 'Not signed in to Microsoft 365 (Standup minutes → email settings): no email sent.';
      else if (!to) x.approval.requested.email.error = 'No address to send it to.';
      else {
        const r = await o.mail.sendMail({ to: to, subject: '[Build.Rite] Approve ' + keyOf(x) + ' · ' + x.label + ' (' + code + ')', html: emailHtml(x, fx, code) });
        x.approval.requested.email = { wanted: true, sent: !!(r && r.ok), to: to, error: r && r.ok ? '' : (r && r.error) || 'Not sent.' };
      }
    }
    ev(x, 'sent for approval', b.by, x.approval.requested.email.sent ? 'email to ' + x.approval.requested.email.to + ' (' + code + ')' : 'in the app' + (x.approval.requested.email.error ? ' — ' + x.approval.requested.email.error : ''));
    await comment(x, 'Sent for approval (' + code + ').');
    put(x);
    return ok(x);
  }
  async function approve(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.status !== 'awaiting-approval') return no('It is not waiting for approval.');
    const fx = fixOf(x);
    if (!fx || fingerprint(fx) !== x.approval.requested.fingerprint) return no('The change is not the one sent for approval any more: analyze and send it again.');
    x.approval.decision = { approved: true, by: str(b.by), at: now().toISOString(), via: b.via === 'email' ? 'email' : 'app' };
    x.status = 'approved';
    ev(x, 'approved', b.by, 'in ' + (x.approval.decision.via === 'email' ? 'an email reply' : 'Build.Rite'));
    await comment(x, 'Approved by ' + (b.by || 'someone') + ' (' + x.approval.decision.via + ').');
    put(x);
    return ok(x);
  }
  async function reject(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.status !== 'awaiting-approval') return no('It is not waiting for approval.');
    x.approval.decision = { approved: false, by: str(b.by), at: now().toISOString(), via: 'app', reason: str(b.reason) };
    x.status = 'rejected';
    ev(x, 'rejected', b.by, str(b.reason));
    await comment(x, 'Rejected by ' + (b.by || 'someone') + (b.reason ? ': ' + b.reason : '.'));
    put(x);
    return ok(x);
  }

  // ── the agent: the approved change on a branch of its own, tested, pushed, a pull request ──
  async function apply(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.status !== 'approved') return no('Approve it first.');
    const fx = fixOf(x);
    if (!fx || fingerprint(fx) !== x.approval.requested.fingerprint) return no('The change is not the one approved any more: analyze and send it again.');
    const k = keyOf(x), f = x.formatted || {};
    const message = k + ': ' + (f.title || x.title) + '\n\n' + (f.summary || '') + '\n\nPage: ' + x.label + ' (' + x.page + ')\nApproved by ' + (x.approval.decision.by || 'someone') + ' (' + x.approval.decision.via + ') '
      + x.approval.decision.at + '.\nProposed by ' + (fx.provider || 'AI') + ' in Build.Rite.' + (x.jira && x.jira.url ? '\nJira: ' + x.jira.url : '');
    const prBody = '**' + k + '** · ' + (f.title || x.title) + '\n\n' + (f.summary || '') + '\n\n**Page:** ' + x.label + ' (`' + x.page + '`)\n\n' + str(fx.markdown).slice(0, 2500)
      + '\n\n---\nApproved by ' + (x.approval.decision.by || 'someone') + ' · proposed by ' + (fx.provider || 'AI') + ' in Build.Rite' + (x.jira && x.jira.url ? ' · ' + x.jira.url : '');
    ev(x, 'agent started', b.by, 'branch fix/' + k);
    const r = await o.fix.applyToBranch({ fix: fx.id, branch: 'fix/' + k, by: b.by, message: message, prBody: prBody });
    if (!r.ok) {
      x.lastError = r.error;
      ev(x, r.stale ? 'out of date' : (r.broke ? 'tests broke' : 'agent failed'), 'agent', r.error);
      if (r.stale) x.status = 'analyzed';
      put(x);
      return no(r.error, { issue: view(x) });
    }
    const ba = r.fix.branchApply || {};
    x.branch = { name: ba.branch, base: ba.base, sha: ba.sha, pushed: ba.pushed, pr: ba.pr, pushError: ba.pushError, at: ba.at };
    x.status = 'in-review';
    x.lastError = '';
    ev(x, 'applied on a branch', 'agent', ba.branch + ' · ' + ba.sha + (ba.pushed ? ' · pushed' : ' · not pushed: ' + ba.pushError));
    if (ba.pr) ev(x, 'pull request ready', 'agent', ba.pr.split('?')[0]);
    await comment(x, 'Fixed on branch {{' + ba.branch + '}} (' + ba.sha + ')' + (r.fix.tests && r.fix.tests.ok ? ', tests passing' : '') + '.' + (ba.pr ? '\nPull request: ' + ba.pr.split('?')[0] : ''));
    put(x);
    return ok(x);
  }
  async function close(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    x.status = 'closed';
    x.closed = { at: now().toISOString(), by: str(b.by), note: str(b.note) };
    ev(x, 'closed', b.by, str(b.note));
    await comment(x, 'Closed in Build.Rite' + (b.note ? ': ' + b.note : '.'));
    put(x);
    return ok(x);
  }
  function reopen(id, b) {
    const x = byId(id);
    if (!x) return no('No such issue.');
    x.status = x.formatted ? 'written' : 'new';
    x.approval = null;
    ev(x, 'reopened', (b && b.by) || '', '');
    put(x);
    return ok(x);
  }

  return {
    info: info, list: list, get: (id) => { const x = byId(id) || sharedAll().filter((y) => y.id === str(id))[0]; return x ? ok(x) : no('No such issue.'); },
    create: create, format: format, update: update, toJira: toJira, analyze: analyze, ask: ask, approve: approve, reject: reject, apply: apply, close: close, reopen: reopen,
    img: img, flush: () => pub,
  };
}

/** The FDD sections that match an issue: resources/js/fddIndex.js pick() on the library's latest FDD (lib/fdd.js store). */
function fddPicker(fddStore, root) {
  let FI = null;
  const load = () => {
    if (FI) return FI;
    const vm = require('vm');
    const sb = { console: console, define: (deps, f) => { FI = f(); } };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(root, 'webApps', 'equiprite-next', 'resources', 'js', 'fddIndex.js'), 'utf8'), sb, { filename: 'fddIndex.js' });
    return FI;
  };
  return {
    pick(story) {
      const st = typeof fddStore === 'function' ? fddStore() : fddStore;
      if (!st || typeof st.info !== 'function') return '';
      const info = st.info();
      if (!info.latest) return '';
      const doc = JSON.parse(fs.readFileSync(path.join(st.root, 'webApps', 'equiprite-next', 'resources', 'fdd', info.latest + '.json'), 'utf8'));
      const r = load().pick(doc, story, { budget: 12000 });
      return r && r.text ? r.text : '';
    },
  };
}

module.exports = { open, issueText, jiraWiki, jsonOf, fddPicker, STEPS, VERDICT_LABEL };
