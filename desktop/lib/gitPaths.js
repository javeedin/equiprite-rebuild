'use strict';
/**
 * Committing and pushing a few project folders from the app (the FDD library, the Application pages catalog), and
 * nothing else: only those paths are added and committed (`git commit -- <the files that changed>`, so anything else
 * someone has staged stays staged), and they are pushed to the branch the project is on. A refused push (someone
 * pushed first) or a missing git identity is said, with what to do; nothing is rebased, pulled or forced.
 *
 * With `sync` (the app's data branch, lib/dataBranch.js — never the code): before a push, what others pushed is merged
 * in (git merge, never a rebase or a force), a conflicted data file merged by `sync.resolve` (or the side that has it
 * kept), and a push refused because someone pushed meanwhile is merged and tried once more.
 *
 *   create({ root, paths, git, gitPath, message, sync: { resolve(file, ours, theirs) → text|null, after() } }) →
 *     status()               { available, branch, upstream, pending: [paths], unpushed: [commits], reason }
 *     save({ message, push }) { ok, committed, pushed, nothing, branch, upstream, merged, error, hint }
 *     pull()                 { ok, merged, resolved: [files], error }   (sync only: fetch, and merge what came)
 *   runGit(gitPath, cwd, args) → Promise<{ code, stdout, stderr }>
 */
function str(v) { return v == null ? '' : String(v); }

// A git command is given a time to finish: one that talks to the remote (fetch, push, pull…) 2 minutes, others 1 — a push
// waiting on a sign-in window nobody sees, or a dead network, ends instead of holding the app's work forever.
const NETWORK = /^(fetch|push|pull|clone|ls-remote)$/;
// a whole checkout (a worktree for a branch), a merge: many files written — 5 minutes, for a PC whose antivirus reads each
const SLOW = /^(worktree|checkout|merge|gc|repack)$/;
function runGit(gitPath, cwd, args, timeoutMs) {
  const ms = timeoutMs || (SLOW.test(args[0]) ? 300000 : NETWORK.test(args[0]) ? 120000 : 60000);
  return new Promise((resolve) => {
    let cp;
    try { cp = require('child_process'); } catch (e) { resolve({ code: -1, stdout: '', stderr: 'No child_process here.' }); return; }
    cp.execFile(gitPath || 'git', args, { cwd: cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: ms, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) },
      (err, stdout, stderr) => {
        const late = !!(err && err.killed);
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: str(stdout), timedOut: late,
          stderr: late ? 'git ' + args[0] + ' did not finish in ' + Math.round(ms / 1000) + ' s' + (NETWORK.test(args[0]) ? ': it may be waiting for you to sign in to GitHub (look for a Git window behind this one), or the network is slow' : '') + '.'
            : (str(stderr) || (err && err.code === 'ENOENT' ? 'git is not installed (or not on PATH).' : (err ? str(err.message) : ''))) });
      });
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

  // ── sync: merge what others pushed (the data branch only) ──
  const LAST = /(^|\/)(catalog|library)\.json$/; // summaries of other files: merged after them
  async function pull() {
    if (!o.sync) return { ok: true, merged: false };
    const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (up.code !== 0) return { ok: true, merged: false }; // not pushed anywhere yet
    const upstream = up.stdout.trim();
    const slash = upstream.indexOf('/');
    const f = await git(['fetch', '--quiet', upstream.slice(0, slash), upstream.slice(slash + 1)]);
    if (f.code !== 0) return { ok: false, merged: false, error: 'git fetch failed: ' + (f.stderr || f.stdout).trim() };
    const behind = (await git(['rev-list', '--count', 'HEAD..' + upstream])).stdout.trim();
    if (!behind || behind === '0') return { ok: true, merged: false };
    const m = await git(['merge', '--no-edit', '-m', 'Merge ' + upstream + ' (data from others)', upstream]);
    if (m.code === 0) { try { if (o.sync.after) o.sync.after(); } catch (e) { /* the next start catches up */ } return { ok: true, merged: true, resolved: [] }; }
    const u = await git(['diff', '--name-only', '--diff-filter=U']);
    const files = u.stdout.split('\n').map((x) => x.trim()).filter(Boolean).sort((a, b) => (LAST.test(a) ? 1 : 0) - (LAST.test(b) ? 1 : 0));
    if (!files.length) { await git(['merge', '--abort']); return { ok: false, merged: false, error: 'git merge failed: ' + (m.stderr || m.stdout).trim() }; }
    const fs = require('fs'), path = require('path');
    for (const file of files) {
      const ours = await git(['show', ':2:' + file]), theirs = await git(['show', ':3:' + file]);
      let text = null;
      if (/\.json$/i.test(file) && o.sync.resolve) {
        try { text = o.sync.resolve(file, ours.code === 0 ? ours.stdout : null, theirs.code === 0 ? theirs.stdout : null); } catch (e) { text = null; }
      }
      if (text != null) { fs.mkdirSync(path.dirname(path.join(o.root, file)), { recursive: true }); fs.writeFileSync(path.join(o.root, file), text); await git(['add', '--', file]); }
      else if (ours.code === 0) { await git(['checkout', '--ours', '--', file]); await git(['add', '--', file]); }
      else if (theirs.code === 0) { await git(['checkout', '--theirs', '--', file]); await git(['add', '--', file]); }
      else await git(['rm', '-q', '--cached', '--ignore-unmatch', '--', file]);
    }
    const c = await git(['commit', '--no-edit']);
    if (c.code !== 0) { await git(['merge', '--abort']); return { ok: false, merged: false, error: 'git merge failed: ' + (c.stderr || c.stdout).trim() }; }
    try { if (o.sync.after) o.sync.after(); } catch (e) { /* the next start catches up */ }
    return { ok: true, merged: true, resolved: files };
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
    // (the data branch, never pushed yet: pushed now, with its upstream set)
    if (!committed && !st.unpushed.length && (st.upstream || !o.sync)) return { ok: true, committed: '', pushed: false, nothing: true, branch: st.branch, upstream: st.upstream };
    let merged = false;
    if (o.sync && st.upstream) { const pl = await pull(); if (!pl.ok) return { ok: false, committed: committed, pushed: false, branch: st.branch, upstream: st.upstream, error: pl.error }; merged = pl.merged; }
    let p = st.upstream ? await git(['push']) : await git(['push', '-u', 'origin', 'HEAD']);
    if (p.code !== 0 && o.sync && st.upstream && /rejected|fetch first|non-fast-forward/i.test(p.stderr + p.stdout)) {
      // someone pushed in the meantime: theirs merged in, then once more
      const pl = await pull();
      if (pl.ok) { merged = merged || pl.merged; p = await git(['push']); }
    }
    if (p.code !== 0) {
      const why = (p.stderr || p.stdout).trim();
      return { ok: false, committed: committed, pushed: false, branch: st.branch, upstream: st.upstream, error: 'git push failed: ' + why,
        hint: /rejected|fetch first|non-fast-forward/i.test(why) ? 'Someone pushed first. Run git pull in the project, then Commit & push again.'
          : /could not read|authentication|permission|403|denied/i.test(why) ? 'git could not sign in to the remote. Push once from a terminal (git push) to save your credentials, then try again.' : '' };
    }
    const after = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return { ok: true, committed: committed, pushed: true, merged: merged, branch: st.branch, upstream: after.code === 0 ? after.stdout.trim() : st.upstream };
  }

  return { status: status, save: save, pull: pull };
}

module.exports = { create, runGit };
