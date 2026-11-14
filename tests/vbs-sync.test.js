#!/usr/bin/env node
'use strict';
/**
 * Sync from VB Studio (API), desktop/lib/vbs.js sync(): no window — the calls VB Studio's own pages make (learned once by
 * Find, their ids hidden) made directly: each organization's project list, every page of it (hasMore / totalResults /
 * page), then each project's repositories and workspaces; signed in with the saved username and password (Basic), else
 * the VB Studio window's session, else the window's own sign-in this run (memory only); a sign-in page or a refusal
 * tried the next way, a 404 not; nothing learned yet said; never a password or a token kept, shown or copied.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const V = require('../desktop/lib/vbs');
const L = require('../desktop/lib/vbsLearn');

const T = H.makeAsserter();
const HOST = 'acme-dev1-demo-phx.developer.ocp.oraclecloud.com';
const ORG = 'acme-dev1-demo-phx';
const base = 'https://' + HOST + '/' + ORG;
const enc = (t) => Buffer.from('enc:' + Buffer.from(t, 'utf8').toString('base64'));
const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString('utf8');
const BASIC = 'Basic ' + Buffer.from('demo.user:S3cret!#').toString('base64');
const TOKEN = 'Bearer eyJ-window-token-123';
const PROJECTS = Array.from({ length: 77 }, (x, i) => ({ identifier: 'proj_' + (i + 1), displayName: 'Project ' + (i + 1), description: 'D' + (i + 1) }));
const res = (status, body, type) => ({ ok: status >= 200 && status < 300, status: status, headers: { get: () => type || 'application/json' }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

/** VB Studio, as the stubs answer it. */
function vbStudio(opts) {
  const o = opts || {};
  const seen = [];
  const answer = (url, how) => {
    const u = new URL(url);
    seen.push({ path: u.pathname, query: u.search, how: how });
    const p = u.pathname;
    if (p === '/' + ORG + '/rest/' + ORG + '/projects') {
      if (o.projectsNeedSession && how === 'basic') return res(200, '<!doctype html><title>Sign in</title>', 'text/html');
      const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 25);
      const items = o.ignorePaging ? PROJECTS.slice(0, 25) : PROJECTS.slice(off, off + lim);
      return res(200, { count: items.length, offset: off, totalResults: PROJECTS.length, hasMore: !o.ignorePaging && off + items.length < PROJECTS.length, items: items });
    }
    const m = new RegExp('^/' + ORG + '/rest/' + ORG + '_([^/]+)/(scm/v2/repositories|workspaces/v1/workspaces)$').exec(p);
    if (m && m[2].indexOf('scm') === 0) {
      if (how === 'basic') return res(401, { error: 'unauthorized' });
      if (m[1] === 'proj_5') return res(404, { error: 'gone' });
      return res(200, [{ name: m[1] + '-ui', httpUrl: base + '/s/' + ORG + '_' + m[1] + '/scm/' + m[1] + '-ui.git' }]);
    }
    if (m) {
      if (m[1] === 'proj_3') return res(403, { error: 'forbidden' });
      return res(200, { items: m[1] === 'proj_1' ? [{ id: 'w-1', name: 'javeed-26c', branch: 'ws-javeed', repository: { name: 'proj_1-ui' }, owner: { username: 'javeed.shaik' } }] : [] });
    }
    return res(404, { error: 'no' });
  };
  return {
    seen: seen,
    fetch: async (url, init) => {
      const a = (init && init.headers && init.headers.Authorization) || '';
      if (a === TOKEN) return answer(url, 'window');
      if (a !== BASIC) return res(401, { error: 'unauthorized' });
      return answer(url, 'basic');
    },
    session: async (url, init) => { if (init && init.headers && init.headers.Authorization) throw new Error('the session sends no header of ours'); return o.noSession ? res(200, '<html>sign in</html>', 'text/html') : answer(url, 'session'); },
  };
}
/** What Find learned from one browse of VB Studio: the project list (25 a page), a project's repositories and workspaces. */
function learned(withRoles) {
  const l = L.learner();
  l.see({ url: base + '/rest/' + ORG + '/projects?offset=0&limit=25&q=SECRET', status: 200, json: { items: PROJECTS.slice(0, 2), hasMore: true } });
  l.see({ url: base + '/rest/' + ORG + '_proj_1/scm/v2/repositories', status: 200, json: [] });
  l.see({ url: base + '/rest/' + ORG + '_proj_1/workspaces/v1/workspaces', status: 200, json: { items: [] } });
  const calls = l.calls();
  if (!withRoles) calls.forEach((c) => { delete c.role; delete c.query; }); // recorded before roles were kept
  return { orgs: [], projects: [], workspaces: [], calls: calls };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-vbs-sync-'));
  try {
    T.section('nothing learned yet');
    const vb0 = vbStudio();
    const s0 = V.open({ file: path.join(tmp, 'a.json'), encrypt: enc, decrypt: dec, fetch: vb0.fetch });
    const n0 = await s0.sync({});
    T.check('no organization: said', !n0.ok && /Add your VB Studio organization/.test(n0.error), JSON.stringify(n0));
    s0.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    const n1 = await s0.sync({});
    T.check('an organization, VB Studio\'s pages never seen: VB Studio\'s own project list asked all the same (built in) — not there here: said', !n1.ok && vb0.seen.map((x) => x.path).join() === '/' + ORG + '/api2/v2/organization/projects'
      && /refused every call|not there/.test(n1.error + JSON.stringify(n1.steps)), JSON.stringify(n1).slice(0, 300));

    T.section('every project, every page; each project\'s repositories and workspaces');
    const vb = vbStudio();
    const file = path.join(tmp, 'b.json');
    const st = V.open({ file: file, encrypt: enc, decrypt: dec, fetch: vb.fetch, sessionFetch: vb.session });
    const so = st.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    st.learn(learned(true));
    const r = await st.sync({ orgId: so.org.id });
    const pr = (r.projects || []).filter((p) => p.org === ORG);
    T.check('all 77 projects (4 pages of 25: hasMore, offset), with their names and descriptions', r.ok && pr.length === 77 && pr.filter((p) => p.project === 'proj_77')[0].name === 'Project 77'
      && vb.seen.filter((x) => /\/rest\/[^/]+\/projects$/.test(x.path)).map((x) => x.query).join(' ') === '?offset=0&limit=25 ?offset=25&limit=25 ?offset=50&limit=25 ?offset=75&limit=25', vb.seen.filter((x) => /\/projects$/.test(x.path)).map((x) => x.query).join(' '));
    T.check('…the recorded call\'s other query parameters never sent (only its paging)', vb.seen.every((x) => x.query.indexOf('SECRET') === -1 && x.query.indexOf('q=') === -1));
    const p9 = pr.filter((p) => p.project === 'proj_9')[0];
    T.check('each project\'s repositories (its Git address) — refused with the username and password, read with the VB Studio window\'s session', p9.repos.length === 1 && p9.repos[0].url === base + '/s/' + ORG + '_proj_9/scm/proj_9-ui.git'
      && r.counts.repos === 76 && r.via.basic > 0 && r.via.session >= 76, JSON.stringify(r.via));
    T.check('…the way that worked tried first afterwards (not refused 77 times)', vb.seen.filter((x) => /repositories$/.test(x.path) && x.how === 'basic').length < 6, String(vb.seen.filter((x) => /repositories$/.test(x.path) && x.how === 'basic').length));
    T.check('…a 404 not asked again another way', vb.seen.filter((x) => /proj_5\/scm/.test(x.path)).length === 1);
    T.check('each project\'s workspaces: name, branch, repository, owner', r.workspaces.length === 1 && r.workspaces[0].name === 'javeed-26c' && r.workspaces[0].branch === 'ws-javeed' && r.workspaces[0].project === 'proj_1' && r.workspaces[0].owner === 'javeed.shaik');
    const stepText = r.steps.map((x) => x.text).join('\n');
    T.check('the steps: each call (its path, ids hidden), pages and items, how it signed in; refusals counted', /\/<org>\/rest\/<org>\/projects — projects: 4 pages, 77 items \(signed in by username and password\)/.test(stepText)
      && /repos of 77 projects: 76 answered, 1 not \(HTTP 404/.test(stepText) && /workspaces of 77 projects: 76 answered, 1 not \(HTTP 403/.test(stepText) && /Done in .* 77 projects · 76 repositories · 1 workspace/.test(stepText), stepText);
    const saved = fs.readFileSync(file, 'utf8');
    T.check('kept: found, the last sync shown again (never the password)', st.discovered().sync.counts.projects === 77 && st.discovered().projects.length === 77 && saved.indexOf('S3cret') === -1 && JSON.stringify(r).indexOf('S3cret') === -1 && JSON.stringify(r).indexOf(BASIC) === -1);
    const diag = st.diagnostic();
    T.check('"Copy what Build.Rite saw": each call\'s role, paging and way in; the last sync\'s steps — no organization, project or person in it', /"role": "projects"/.test(diag) && /"query": "offset=0&limit=25"/.test(diag) && /"auth": "session"/.test(diag) && /lastSync/.test(diag)
      && diag.indexOf(ORG) === -1 && diag.indexOf('Rite demo') === -1 && diag.indexOf('proj_9') === -1 && diag.indexOf('javeed') === -1, diag.slice(0, 500));

    T.section('the way in: the saved sign-in, the window\'s session, the window\'s own sign-in (memory only)');
    const vb2 = vbStudio({ projectsNeedSession: true });
    const st2 = V.open({ file: path.join(tmp, 'c.json'), encrypt: enc, decrypt: dec, fetch: vb2.fetch, sessionFetch: vb2.session });
    st2.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    st2.learn(learned(false));
    const r2 = await st2.sync({});
    T.check('calls recorded before their role was kept: their role read from the path; a sign-in page (not data) → the window\'s session', r2.ok && r2.projects.length === 77 && r2.via.session > 0, JSON.stringify(r2.via));
    const vb3 = vbStudio({ noSession: true });
    const st3 = V.open({ file: path.join(tmp, 'd.json'), encrypt: enc, decrypt: dec, fetch: vb3.fetch, sessionFetch: vb3.session });
    st3.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    st3.learn(learned(true));
    st3.windowSignIn('github.com', TOKEN);
    st3.windowSignIn(HOST, 'Basic abc');
    const r3a = await st3.sync({});
    T.check('…without the window\'s sign-in: the repositories refused (said), the projects still read', r3a.ok && r3a.counts.repos === 0 && /repos of 77 projects: 0 answered, 77 not/.test(r3a.steps.map((x) => x.text).join('\n')), r3a.steps.map((x) => x.text).join('\n'));
    st3.windowSignIn(HOST, TOKEN);
    const r3 = await st3.sync({});
    T.check('…with the sign-in VB Studio\'s own pages sent this run (that host only, a bearer only): read; never kept in the file or shown', r3.ok && r3.counts.repos === 76 && r3.via.window >= 76
      && fs.readFileSync(path.join(tmp, 'd.json'), 'utf8').indexOf('window-token') === -1 && JSON.stringify(r3).indexOf('window-token') === -1 && st3.diagnostic().indexOf('window-token') === -1, JSON.stringify(r3.via));
    const st3b = V.open({ file: path.join(tmp, 'd.json'), encrypt: enc, decrypt: dec, fetch: vb3.fetch, sessionFetch: vb3.session });
    const r3b = await st3b.sync({});
    T.check('…gone when the app is opened again', r3b.counts.repos === 0, JSON.stringify(r3b.counts));

    T.section('VB Studio\'s internal calls (api2): its sign-in page for the username and password — made from inside VB Studio\'s own page');
    const PAGE_PROJECTS = { items: [{ id: 'demo-agent_100001', name: 'Demo_Agent' }, { id: 'sample-git_100002', name: 'samplegit' }, { id: 'contracts-hub_100003', name: 'Contracts Hub' }] };
    const pageSeen = [];
    let pageAnswer = 'data';
    const api2 = async (url, init) => { const u = new URL(url); return u.pathname === '/' + ORG + '/api2/v2/organization/projects' && !(init && init.headers && init.headers.Authorization) ? res(200, '<!doctype html><title>Sign In</title>', 'text/html') : res(200, '<html>Sign in</html>', 'text/html'); };
    const st5 = V.open({ file: path.join(tmp, 'f.json'), encrypt: enc, decrypt: dec, fetch: api2, sessionFetch: api2,
      pageFetch: async (url) => { pageSeen.push(new URL(url).pathname); if (pageAnswer === 'signin') return { signIn: true }; return new URL(url).pathname === '/' + ORG + '/api2/v2/organization/projects' ? res(200, PAGE_PROJECTS) : res(404, {}); } });
    st5.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    const r5 = await st5.sync({});
    T.check('nothing learned, the username and password answered with the sign-in page: read from inside VB Studio\'s page — its 3 projects, their names', r5.ok && r5.projects.length === 3 && r5.projects.filter((p) => p.project === 'demo-agent_100001')[0].name === 'Demo_Agent' && r5.via.page === 1
      && /signed in by your VB Studio session, inside VB Studio's own page/.test(r5.steps.map((x) => x.text).join('\n')), JSON.stringify(r5.steps.map((x) => x.text)));
    pageAnswer = 'signin';
    const r6 = await st5.sync({});
    T.check('…VB Studio\'s session expired: said what to do (Open VB Studio, sign in) — its page not asked again in that sync', !r6.ok && r6.signIn && /Open VB Studio, sign in/.test(r6.error) && st5.discovered().sync.signIn === true, r6.error);
    const st7 = V.open({ file: path.join(tmp, 'g.json'), encrypt: enc, decrypt: dec, fetch: api2, sessionFetch: api2 });
    st7.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    const r7 = await st7.sync({});
    T.check('…without VB Studio\'s page (not the desktop app): its sign-in page said as such, with what to do', !r7.ok && /sent its sign-in page instead of data/.test(r7.error) && /Open VB Studio once and sign in/.test(r7.error), r7.error);

    T.section('one organization; one project (its repositories and workspaces)');
    const vb8 = vbStudio();
    const st8 = V.open({ file: path.join(tmp, 'h.json'), encrypt: enc, decrypt: dec, fetch: vb8.fetch, sessionFetch: vb8.session });
    st8.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    st8.learn(learned(true));
    const r8 = await st8.sync({ orgKey: HOST + '/' + ORG, project: 'proj_9' });
    T.check('one project: only its repositories and workspaces asked (no project list); the last sync line kept', r8.ok && vb8.seen.every((x) => /proj_9\//.test(x.path)) && vb8.seen.length >= 2 && r8.projects.filter((p) => p.project === 'proj_9')[0].repos.length === 1 && !st8.discovered().sync, vb8.seen.map((x) => x.path).join());
    const r9 = await st8.sync({ orgKey: HOST + '/other-org-x', project: 'p' });
    T.check('…an organization not set up (nor on its VB Studio): said', !r9.ok && /Set up that organization first/.test(r9.error));
    T.section('as VB Studio answers (nothing learned): the project list, then each project\'s workspaces and repositories (…/s2/…), from inside its page');
    const PID = 'rebuild-app_100010';
    const s2 = '/' + ORG + '/s2/' + ORG + '_' + PID;
    const vbsAnswers = {
      ['/' + ORG + '/api2/v2/organization/projects']: { items: [{ id: PID, name: 'Rebuild_App', description: 'The rebuild' }, { id: 'other-app_100011', name: 'Other_App' }] },
      [s2 + '/vbdt/design/workspaces']: { items: [
        { id: 'w1', name: 'Dev_One', repository: 'app.git', branch: 'dev-one', environment: { name: 'OICDEMO' }, lastOpened: '2026-11-14T01:37:00Z', owner: 'demo.user' },
        { id: 'w2', name: 'QA_Two', repository: 'app.git', branch: 'qa-two', lastOpened: '2026-11-13T12:25:00Z', owner: 'demo.user' }] },
      [s2 + '/scm/api/repository']: [{ name: 'app', httpUrl: base + '/s/' + ORG + '_' + PID + '/scm/app.git' }, { name: 'tools', httpUrl: base + '/s/' + ORG + '_' + PID + '/scm/tools.git' }],
    };
    const st9 = V.open({ file: path.join(tmp, 'i.json'), encrypt: enc, decrypt: dec, fetch: api2,
      pageFetch: async (url) => { const a = vbsAnswers[new URL(url).pathname]; return a ? res(200, a) : res(404, {}); } });
    st9.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    const r10 = await st9.sync({});
    const rp = (r10.projects || []).filter((p) => p.project === PID)[0] || {};
    const w1 = (r10.workspaces || []).filter((w) => w.name === 'Dev_One')[0] || {};
    T.check('its projects; each one\'s repositories (their Git addresses) and workspaces — inside their project, with their environment and when last opened', r10.ok && r10.projects.length === 2 && rp.repos.map((x) => x.repo).join() === 'app,tools'
      && r10.workspaces.length === 2 && w1.project === PID && w1.environment === 'OICDEMO' && w1.lastOpened === '2026-11-14T01:37:00Z' && w1.repo === 'app' && w1.branch === 'dev-one' && st9.discovered().learned.workspaces && st9.discovered().learned.repos,
    JSON.stringify(r10.workspaces) + ' ' + r10.steps.map((x) => x.text).join(' | '));

    T.section('Find its repositories: VB Studio\'s API when known, else the names VB Studio usually gives (each checked with git)');
    const gitSeen = [];
    const st10 = V.open({ file: path.join(tmp, 'j.json'), encrypt: enc, decrypt: dec, fetch: vb.fetch,
      git: (args, auth) => { gitSeen.push(args[args.length - 1]); return /\/scm\/demo-agent\.git$/.test(args[args.length - 1]) ? { code: 0, stdout: 'abc\trefs/heads/main\n', stderr: '' } : { code: 128, stdout: '', stderr: 'fatal: repository not found' }; } });
    st10.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    st10.learn({ orgs: [], workspaces: [], calls: [], projects: [{ host: HOST, org: ORG, project: 'demo-agent_100001', name: 'Demo Agent', description: '', repos: [] }] });
    const fr = await st10.findRepos({ orgKey: HOST + '/' + ORG, project: 'demo-agent_100001', name: 'Demo Agent' });
    T.check('no repositories call known: the likely names tried in turn (the project id, without its number…) — the one that exists kept, with its address', fr.ok && fr.via === 'git' && fr.repos.length === 1 && fr.repos[0].url === base + '/s/' + ORG + '_demo-agent_100001/scm/demo-agent.git'
      && gitSeen.join(' ') === base + '/s/' + ORG + '_demo-agent_100001/scm/demo-agent_100001.git ' + base + '/s/' + ORG + '_demo-agent_100001/scm/demo-agent.git'
      && st10.discovered().projects.filter((p) => p.project === 'demo-agent_100001')[0].repos.length === 1, JSON.stringify(fr.tried));
    gitSeen.length = 0;
    const fr2 = await st10.findRepos({ orgKey: HOST + '/' + ORG, project: 'other_1', name: 'Other thing' });
    T.check('…none of them: said, with the names tried and what to open in VB Studio', !fr2.ok && /No repository found under the names VB Studio usually gives \(other_1, other, other-thing, other_thing, otherthing\)/.test(fr2.error) && /Repositories page/.test(fr2.error), fr2.error);
    const fr3 = await st10.findRepos({ orgKey: 'other-dev2-demo-iad.developer.ocp.oraclecloud.com/other-dev2-demo-iad', project: 'x' });
    T.check('…an organization on a VB Studio with nothing set up: said (set it up first)', !fr3.ok && /Set up the organization first/.test(fr3.error), fr3.error);
    const vb11 = vbStudio();
    const st11 = V.open({ file: path.join(tmp, 'k.json'), encrypt: enc, decrypt: dec, fetch: vb11.fetch, sessionFetch: vb11.session, git: () => ({ code: 128, stdout: '', stderr: 'not found' }) });
    st11.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    st11.learn(learned(true));
    const fr4 = await st11.findRepos({ orgKey: HOST + '/' + ORG, project: 'proj_12', name: 'Project 12' });
    T.check('the repositories call known: VB Studio\'s API answers (no guessing)', fr4.ok && fr4.via === 'api' && fr4.repos[0].url === base + '/s/' + ORG + '_proj_12/scm/proj_12-ui.git', JSON.stringify(fr4.repos));

    T.section('a list whose paging is ignored; two syncs at once');
    const vb4 = vbStudio({ ignorePaging: true });
    const st4 = V.open({ file: path.join(tmp, 'e.json'), encrypt: enc, decrypt: dec, fetch: vb4.fetch, sessionFetch: vb4.session });
    st4.saveOrg({ name: 'Rite demo', url: base + '/', user: 'demo.user', password: 'S3cret!#' });
    st4.learn(learned(true));
    const both = await Promise.all([st4.sync({}), st4.sync({})]);
    T.check('the same page again: stopped there (25 projects), not asked forever', both[0].projects.length === 25 && vb4.seen.filter((x) => /\/rest\/[^/]+\/projects$/.test(x.path)).length === 2, String(vb4.seen.filter((x) => /\/projects$/.test(x.path)).length));
    T.check('two syncs at once: one run, the same answer', both[0] === both[1]);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
