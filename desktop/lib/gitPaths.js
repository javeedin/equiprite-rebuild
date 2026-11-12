'use strict';
/**
 * Committing and pushing a few project folders from the app (the FDD library, the Application pages catalog), and
 * nothing else: only those paths are added and committed (`git commit -- <the files that changed>`, so anything else
 * someone has staged stays staged), and they are pushed to the branch the project is on. A refused push (someone
 * pushed first) or a missing git identity is said, with what to do; nothing is rebased, pulled or forced.
 *
 *   create({ root, paths, git, gitPath, message }) →
 *     status()               { available, branch, upstream, pending: [paths], unpushed: [commits], reason }
 *     save({ message, push }) { ok, committed, pushed, nothing, branch, upstream, error, hint }
 *   runGit(gitPath, cwd, args) → Promise<{ code, stdout, stderr }>
 */
function str(v) { return v == null ? '' : String(v); }

function runGit(gitPath, cwd, args) {
  return new Promise((resolve) => {
    let cp;
    try { cp = require('child_process'); } catch (e) { resolve({ code: -1, stdout: '', stderr: 'No child_process here.' }); return; }
    cp.execFile(gitPath || 'git', args, { cwd: cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: str(stdout), stderr: str(stderr) || (err && err.code === 'ENOENT' ? 'git is not installed (or not on PATH).' : (err ? str(err.message) : '')) }));
  });
}

function create(o) {
  const PATHS = o.paths;
  const git = o.git || ((args) => runGit(o.gitPath, o.root, args));

  async function status() {
    const inside = await git(['rev-parse', '--is-inside-work-tree']);
    if (inside.code !== 0 || !/true/.test(inside.stdout)) return { available: false, pending: [], unpushed: [], reason: /not installed|ENOENT/.test(inside.stderr) ? 'git is not installed on this PC.' : 'This project folder is not a git repository.' };
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const upstream = up.code === 0 ? up.stdout.trim() : '';
    const st = await git(['status', '--porcelain', '--untracked-files=all', '--'].concat(PATHS));
    const pending = st.stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
    let unpushed = [];
    if (upstream) {
      const lg = await git(['log', '--format=%h %s', upstream + '..HEAD', '--'].concat(PATHS));
      unpushed = lg.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    }
    return { available: true, branch: branch, upstream: upstream, pending: pending, unpushed: unpushed };
  }

  async function save(b) {
    b = b || {};
    const st = await status();
    if (!st.available) return { ok: false, error: st.reason };
    let committed = '';
    if (st.pending.length) {
      const add = await git(['add', '-A', '--'].concat(PATHS));
      if (add.code !== 0) return { ok: false, error: 'git add failed: ' + add.stderr.trim() };
      const msg = str(b.message).trim() || o.message || 'Update';
      // the exact paths that changed (a rename "a -> b" is both), so nothing else that is staged goes into this commit
      const files = [];
      st.pending.forEach((p) => p.split(' -> ').forEach((f) => { f = f.replace(/^"|"$/g, ''); if (f && files.indexOf(f) === -1) files.push(f); }));
      const c = await git(['commit', '-m', msg, '--'].concat(files));
      if (c.code !== 0) {
        const why = (c.stderr || c.stdout).trim();
        return { ok: false, error: 'git commit failed: ' + why, hint: /user\.(name|email)|identity/i.test(why) ? 'Tell git who you are: git config --global user.name "Your Name" and git config --global user.email you@example.com' : '' };
      }
      committed = (await git(['rev-parse', '--short', 'HEAD'])).stdout.trim();
    }
    if (b.push === false) return { ok: true, committed: committed, pushed: false, branch: st.branch, upstream: st.upstream };
    if (!committed && !st.unpushed.length) return { ok: true, committed: '', pushed: false, nothing: true, branch: st.branch, upstream: st.upstream };
    const p = st.upstream ? await git(['push']) : await git(['push', '-u', 'origin', 'HEAD']);
    if (p.code !== 0) {
      const why = (p.stderr || p.stdout).trim();
      return { ok: false, committed: committed, pushed: false, branch: st.branch, upstream: st.upstream, error: 'git push failed: ' + why,
        hint: /rejected|fetch first|non-fast-forward/i.test(why) ? 'Someone pushed first. Run git pull in the project, then Commit & push again.'
          : /could not read|authentication|permission|403|denied/i.test(why) ? 'git could not sign in to the remote. Push once from a terminal (git push) to save your credentials, then try again.' : '' };
    }
    const after = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return { ok: true, committed: committed, pushed: true, branch: st.branch, upstream: after.code === 0 ? after.stdout.trim() : st.upstream };
  }

  return { status: status, save: save };
}

module.exports = { create, runGit };
