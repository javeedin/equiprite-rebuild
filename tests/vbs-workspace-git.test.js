#!/usr/bin/env node
'use strict';
/**
 * A VB Studio workspace's Git (desktop/lib/vbs.js workspaceGit), with real git: VB Studio's repository stood in for by a
 * local one (its https address mapped to it). The workspace's branch: its head commit, whether it is the default branch,
 * its last commit (who, when, what) and the files it changed — fetched two commits deep into a cache next to the app's
 * data, the sign-in sent only where VB Studio is reached. A branch not pushed yet, an organization not set up, a name that
 * cannot be a repository: said.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const H = require('./_harness');
const V = require('../desktop/lib/vbs');

const T = H.makeAsserter();
const HOST = 'acme-dev1-demo-phx.developer.ocp.oraclecloud.com';
const ORG = 'acme-dev1-demo-phx';
const PID = 'rebuild-app_100010';
const URL = 'https://' + HOST + '/' + ORG + '/s/' + ORG + '_' + PID + '/scm/App.git';

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-vbs-wsgit-'));
  try {
    // VB Studio's repository: main, and the workspace's branch dev-one two commits ahead (a.txt changed, b.txt added)
    const bare = path.join(tmp, 'App.git');
    const work = path.join(tmp, 'work');
    const g = (cwd, args) => execFileSync('git', args, { cwd: cwd, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'Demo User', GIT_AUTHOR_EMAIL: 'demo@example.com', GIT_COMMITTER_NAME: 'Demo User', GIT_COMMITTER_EMAIL: 'demo@example.com' }) }).toString();
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare]);
    execFileSync('git', ['init', '-q', '-b', 'main', work]);
    fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
    g(work, ['add', '.']); g(work, ['commit', '-q', '-m', 'first']);
    g(work, ['checkout', '-q', '-b', 'dev-one']);
    fs.writeFileSync(path.join(work, 'a.txt'), 'one two\n');
    fs.writeFileSync(path.join(work, 'b.txt'), 'new\n');
    g(work, ['add', '.']); g(work, ['commit', '-q', '-m', 'Titles on the customer dashboard']);
    g(work, ['push', '-q', bare, 'main', 'dev-one']);
    const tip = g(work, ['rev-parse', 'dev-one']).trim();

    // git as the store runs it, VB Studio's address mapped to the local repository; the sign-in each call carries noted
    const seen = [];
    const realGit = (args, auth) => new Promise((resolve) => {
      seen.push({ cmd: args.filter((a) => !/^-/.test(a))[args[0] === '-C' ? 1 : 0], auth: auth && auth.header ? 'Basic' : '', url: args.indexOf(URL) !== -1 });
      execFile('git', args.map((a) => (a === URL ? bare : a)), (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    });
    const enc = (t) => Buffer.from('enc:' + t);
    const dec = (b) => b.toString().slice(4);
    const file = path.join(tmp, 'data', 'vbs.json');
    const st = V.open({ file: file, encrypt: enc, decrypt: dec, git: realGit, fetch: async () => ({ ok: false, status: 404, text: async () => '' }) });

    T.section('not set up; not a repository name');
    const n0 = await st.workspaceGit({ orgKey: HOST + '/' + ORG, project: PID, repo: 'App', branch: 'dev-one' });
    T.check('its organization not set up: said (its sign-in reads the Git)', !n0.ok && /Set up the organization first/.test(n0.error));
    st.saveOrg({ name: 'Rite demo', url: 'https://' + HOST + '/' + ORG + '/', user: 'demo.user', password: 'S3cret!#' });
    const n1 = await st.workspaceGit({ orgKey: HOST + '/' + ORG, project: PID, repo: '../etc', branch: 'dev-one' });
    T.check('…a repository name that cannot be one: said, git never run', !n1.ok && /Which workspace/.test(n1.error) && seen.length === 0);

    T.section('the workspace\'s branch: head, last commit, the files it changed');
    const r = await st.workspaceGit({ orgKey: HOST + '/' + ORG, project: PID, repo: 'App.git', branch: 'dev-one' });
    T.check('its repository\'s address; its branch, not the default one (main); its head commit', r.ok && r.url === URL && r.repo === 'App' && r.branch === 'dev-one' && r.head === 'main' && r.isDefault === false && r.sha === tip, JSON.stringify(r));
    T.check('its last commit: what, who, when', !!r.commit && r.commit.subject === 'Titles on the customer dashboard' && r.commit.author === 'Demo User' && r.commit.sha === tip && !isNaN(new Date(r.commit.date).getTime()), JSON.stringify(r.commit));
    T.check('…the files it changed (a.txt changed, b.txt added)', r.files.map((f) => f.status + ' ' + f.path).join(', ') === 'M a.txt, A b.txt' && r.more === 0, JSON.stringify(r.files));
    T.check('the sign-in only where VB Studio is reached (ls-remote, fetch), never for the cache\'s own reading', seen.filter((x) => x.url).every((x) => x.auth === 'Basic') && seen.filter((x) => !x.url).every((x) => !x.auth)
      && seen.map((x) => x.cmd).join() === 'ls-remote,init,fetch,log,show', JSON.stringify(seen));
    T.check('…fetched into a cache next to the app\'s data (a bare repository, no working copy)', fs.existsSync(path.join(tmp, 'data', 'vbs-git')) && fs.readdirSync(path.join(tmp, 'data', 'vbs-git')).length === 1);
    seen.length = 0;
    const r2 = await st.workspaceGit({ orgKey: HOST + '/' + ORG, project: PID, repo: 'App', branch: 'main' });
    T.check('read again (another branch, the default): the same cache, no new one', r2.ok && r2.isDefault && r2.commit.subject === 'first' && r2.files.map((f) => f.path).join() === 'a.txt' && seen.map((x) => x.cmd).join() === 'ls-remote,fetch,log,show', JSON.stringify(seen));

    T.section('a branch not pushed yet; VB Studio refusing');
    const r3 = await st.workspaceGit({ orgKey: HOST + '/' + ORG, project: PID, repo: 'App', branch: 'not-pushed' });
    T.check('a workspace\'s branch not in the repository yet: said', !r3.ok && /The branch not-pushed is not in App\.git yet/.test(r3.error) && r3.head === 'main');
    const st2 = V.open({ file: path.join(tmp, 'd2', 'vbs.json'), encrypt: enc, decrypt: dec, git: async () => ({ code: 128, stdout: '', stderr: 'fatal: Authentication failed for ...' }), fetch: async () => ({ ok: false, status: 404, text: async () => '' }) });
    st2.saveOrg({ name: 'Rite demo', url: 'https://' + HOST + '/' + ORG + '/', user: 'demo.user', password: 'wrong' });
    const r4 = await st2.workspaceGit({ orgKey: HOST + '/' + ORG, project: PID, repo: 'App', branch: 'dev-one' });
    T.check('…the sign-in refused: said in words', !r4.ok && /refused/.test(r4.error), r4.error);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
