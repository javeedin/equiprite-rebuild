#!/usr/bin/env node
'use strict';
/**
 * The working copy (desktop/lib/vbs.js work*), with real git: a VB Studio workspace's repository (stood in for by a local
 * one, its https address rewritten to it by git itself, so the clone keeps VB Studio's address) cloned on this PC at the
 * workspace's branch; a change committed (by who made it) and pushed back to that branch — never forced: VB Studio's
 * newer commits pulled first (fast-forward only); the sign-in only in git's environment, never in the clone's config.
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
const ENV = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'Team Mate', GIT_AUTHOR_EMAIL: 'mate@example.com', GIT_COMMITTER_NAME: 'Team Mate', GIT_COMMITTER_EMAIL: 'mate@example.com' });

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-vbs-work-'));
  try {
    const bare = path.join(tmp, 'App.git');
    const mate = path.join(tmp, 'mate');
    const g = (cwd, args) => execFileSync('git', args, { cwd: cwd, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare]);
    execFileSync('git', ['init', '-q', '-b', 'main', mate]);
    fs.writeFileSync(path.join(mate, 'page.html'), '<h1>Title</h1>\n');
    g(mate, ['add', '.']); g(mate, ['commit', '-q', '-m', 'first']);
    g(mate, ['checkout', '-q', '-b', 'dev-one']);
    g(mate, ['push', '-q', bare, 'main', 'dev-one']);
    g(mate, ['remote', 'add', 'origin', bare]);
    g(mate, ['fetch', '-q', 'origin']);
    g(mate, ['branch', '-q', '--set-upstream-to=origin/dev-one']);

    // git as the store runs it — VB Studio's address rewritten to the local repository by git (insteadOf), its sign-in noted
    const seen = [];
    const realGit = (args, auth) => new Promise((resolve) => {
      const cmd = args.filter((a, i) => !/^-/.test(a) && args[i - 1] !== '-C' && args[i - 1] !== '-c')[0];
      seen.push({ cmd: cmd, auth: auth && auth.header ? 'Basic' : '' });
      execFile('git', ['-c', 'url.' + bare + '.insteadOf=' + URL].concat(args), { env: Object.assign({}, process.env, { HOME: tmp, GIT_CONFIG_NOSYSTEM: '1' }) },
        (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    });
    const enc = (t) => Buffer.from('enc:' + t);
    const dec = (b) => b.toString().slice(4);
    const file = path.join(tmp, 'data', 'vbs.json');
    const st = V.open({ file: file, encrypt: enc, decrypt: dec, git: realGit, fetch: async () => ({ ok: false, status: 404, text: async () => '' }) });
    const WS = { orgKey: HOST + '/' + ORG, project: PID, projectName: 'Rebuild_App', workspace: 'Dev_One', repo: 'App', branch: 'dev-one' };

    T.section('no working copy yet; not set up');
    T.check('none yet: said', !(await st.workStatus('')).ok && st.work().current === null);
    const n0 = await st.workUse(WS);
    T.check('its organization not set up: said (Build.Rite clones with its sign-in)', !n0.ok && /Set up the organization first/.test(n0.error));
    st.saveOrg({ name: 'Rite demo', url: 'https://' + HOST + '/' + ORG + '/', user: 'demo.user', password: 'S3cret!#' });

    T.section('a workspace made the working copy: cloned at its branch');
    seen.length = 0;
    const u = await st.workUse(WS);
    const dir = path.join(tmp, 'data', 'vbs-work', 'rebuild-app', 'dev_one');
    T.check('cloned into this app\'s data folder (vbs-work/<project>/<workspace>), at the workspace\'s branch, made current', u.ok && u.cloned && u.copy.path === dir && u.branch === 'dev-one' && u.copy.current && st.work().current.workspace === 'Dev_One'
      && fs.existsSync(path.join(dir, 'page.html')) && u.changedCount === 0 && u.ahead === 0 && u.behind === 0, JSON.stringify(u).slice(0, 400));
    const cfg = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
    T.check('…its address VB Studio\'s; the sign-in never in its config (only in git\'s environment, for VB Studio)', cfg.indexOf('url = ' + URL) !== -1 && !/authorization|extraheader|S3cret|demo\.user/i.test(cfg) && seen[0].cmd === 'clone' && seen[0].auth === 'Basic', cfg);
    T.check('…its last commit read', u.last && u.last.subject === 'first');

    T.section('a change: seen, committed (by who made it), pushed to the workspace\'s branch');
    fs.writeFileSync(path.join(dir, 'page.html'), '<h1>Customer dashboard</h1>\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'new\n');
    const s1 = await st.workStatus('');
    T.check('its changes: a file changed, a new one', s1.ok && s1.changed.map((c) => c.label + ' ' + c.path).join(', ') === 'changed page.html, new notes.md', JSON.stringify(s1.changed));
    T.check('a commit without a message: refused (what it is: a story, an issue)', /Write what the change is/.test((await st.workCommit('', '  ', 'javeed.shaik')).error));
    const c1 = await st.workCommit('', 'EQP-901: titles on the customer dashboard', 'javeed.shaik');
    T.check('committed: by who made it; one commit to push, nothing left changed', c1.ok && c1.committed && c1.ahead === 1 && c1.changedCount === 0 && c1.last.subject === 'EQP-901: titles on the customer dashboard' && c1.last.author === 'javeed.shaik', JSON.stringify(c1).slice(0, 300));
    T.check('…nothing more to commit: said', /Nothing to commit/.test((await st.workCommit('', 'again', 'x')).error));
    seen.length = 0;
    const p1 = await st.workPush('');
    T.check('pushed to the workspace\'s branch in VB Studio (with the sign-in); nothing left to push', p1.ok && p1.pushed && p1.ahead === 0 && g(bare, ['log', '-1', '--format=%s', 'dev-one']).trim() === 'EQP-901: titles on the customer dashboard'
      && seen.filter((x) => x.cmd === 'push')[0].auth === 'Basic' && g(bare, ['log', '-1', '--format=%s', 'main']).trim() === 'first', JSON.stringify(p1).slice(0, 300));

    T.section('VB Studio moved on: the push refused (never forced); pulled first, then pushed');
    g(mate, ['pull', '-q', 'origin', 'dev-one']);
    fs.writeFileSync(path.join(mate, 'other.js'), 'x\n');
    g(mate, ['add', '.']); g(mate, ['commit', '-q', '-m', 'a team mate\'s change']); g(mate, ['push', '-q', 'origin', 'dev-one']);
    const s2 = await st.workStatus('', { fetch: true });
    T.check('checked against VB Studio: 1 newer commit there', s2.ok && s2.behind === 1 && s2.ahead === 0, JSON.stringify(s2).slice(0, 200));
    fs.writeFileSync(path.join(dir, 'notes.md'), 'more\n');
    await st.workCommit('', 'more notes', 'javeed.shaik');
    const p2 = await st.workPush('');
    T.check('a push while VB Studio has newer commits: refused, said (Pull first); its branch not overwritten', !p2.ok && /Pull from VB Studio first/.test(p2.error) && g(bare, ['log', '-1', '--format=%s', 'dev-one']).trim() === 'a team mate\'s change', p2.error);
    const l2 = await st.workPull('');
    T.check('…pulled: fast-forward only, so with commits on both sides it says a merge is needed (nothing rewritten)', !l2.ok && /need merging/.test(l2.error), l2.error);
    g(dir, ['-c', 'user.name=x', '-c', 'user.email=x@x', 'reset', '-q', '--hard', 'origin/dev-one']); // that commit undone here: only VB Studio's left
    const l3 = await st.workPull('');
    T.check('pulled when only VB Studio moved: its commit brought in', l3.ok && l3.pulled && l3.behind === 0 && fs.existsSync(path.join(dir, 'other.js')), JSON.stringify(l3).slice(0, 200));

    T.section('made again: the copy on this PC reused; forgotten (its folder deleted only inside Build.Rite\'s folder)');
    const again = await st.workUse(WS);
    T.check('the same workspace again: the copy on this PC reused (checked against VB Studio), not cloned again', again.ok && again.reused && !again.cloned && st.work().copies.length === 1);
    const f = st.workForget(st.work().current.id, true);
    T.check('forgotten, its folder deleted', f.ok && f.current === null && f.copies.length === 0 && !fs.existsSync(dir));
    const missing = await st.workUse(Object.assign({}, WS, { branch: 'not-pushed' }));
    T.check('a workspace whose branch is not pushed yet: said', !missing.ok && /not in App\.git yet/.test(missing.error), missing.error);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
