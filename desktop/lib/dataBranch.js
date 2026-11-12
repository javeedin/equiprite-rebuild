'use strict';
/**
 * The app's data on its own git branch, apart from the code.
 *
 * What the app saves for everyone — the Application pages catalog (technical sheets, screenshots, AI explanations, Jira
 * stories mapped), the FDD library — is committed and pushed by the app. On the code branch that collided with code
 * pushes: whoever pushed code made the app's next push fail ("fetch first"). So the data lives on a branch of its own
 * (claude/equiprite-data by default; EQUIPRITE_DATA_BRANCH changes it), checked out next to the code as a git worktree
 * in <project>/.equiprite-data (ignored by the code branch). The app reads and writes the data there, and commits and
 * pushes only there: the project folder — the code — is never changed by the app, so `git pull` of the code stays
 * clean. The data branch holds the same paths as before (docs/fdd, webApps/equiprite-next/resources/fdd and …/pages),
 * so nothing else moves.
 *
 * Two people saving at once: before a push, what others pushed is merged in (lib/gitPaths.js sync; a merge, never a
 * rebase or a force); a data file changed on both sides is merged by what it is (resolve below): a page's sheet (the
 * newer build, both sides' stories and screenshots), the catalog (rebuilt from the sheets), the FDD library (both
 * sides' documents).
 *
 *   open({ root, branch, dir, remote, git, gitPath, log }) → data
 *     data.ensure()        → Promise<data>: the worktree made (from the remote branch, or a new branch seeded with the
 *                            data in the project folder), data saved in the project folder on this PC and not pushed
 *                            moved onto it, what others pushed merged in. Never throws: data.ok false, data.reason why
 *                            (the stores then keep the data in the project folder, as before).
 *     data.ok, data.dir, data.branch, data.info() { separate, branch, dir, reason, created, moved }
 *     data.resolve(file, ours, theirs) → text|null     a conflicted data file, merged
 *     data.onMerged(fn), data.merged()                 the stores refresh their build copies when others' data came
 */
const fs = require('fs');
const path = require('path');
const gitPaths = require('./gitPaths');

const DEFAULT_BRANCH = 'claude/equiprite-data';
const PAGES_RES = 'webApps/equiprite-next/resources/pages';
const FDD_RES = 'webApps/equiprite-next/resources/fdd';
const FDD_DOCS = 'docs/fdd';
const CODE_HISTORY = 'code-history';
const DATA_PATHS = [FDD_DOCS, FDD_RES, PAGES_RES, CODE_HISTORY];
const README = [
  '# EquipRite data',
  '',
  'What the EquipRite desktop app saves for everyone, kept apart from the code (the app commits and pushes here, never',
  'to a code branch):',
  '',
  '- `webApps/equiprite-next/resources/pages`: Application pages: every VB page\'s technical sheet, screenshots, AI',
  '  explanation and the Jira stories mapped to it (`catalog.json`, `sheets/`, `screens/`).',
  '- `docs/fdd` and `webApps/equiprite-next/resources/fdd`: the FDD library: the documents and their outlines.',
  '- `code-history`: Code fix: every change made to a page\'s code from the app — what was asked, the AI\'s analysis, the',
  '  diff, who approved and applied it, the tests, the commit (or the undo).',
  '',
  'The app checks this branch out next to the code, in `<project>/.equiprite-data` (a git worktree), and merges what',
  'others pushed before it pushes. Nothing here is code: do not merge this branch into a code branch.',
  '',
].join('\n');

function str(v) { return v == null ? '' : String(v); }
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const real = (p) => { try { return fs.realpathSync(path.resolve(p)); } catch (e) { return path.resolve(p); } };
const samePath = (a, b) => (process.platform === 'win32' ? real(a).toLowerCase() === real(b).toLowerCase() : real(a) === real(b));
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };

function runGit(gitPath, cwd, args, timeoutMs, env, input) {
  return new Promise((resolve) => {
    const cp = require('child_process').execFile(gitPath || 'git', args, { cwd: cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs || 0,
      env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }, env || {}) },
    (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: str(stdout),
      stderr: str(stderr) || (err && err.code === 'ENOENT' ? 'git is not installed (or not on PATH).' : (err ? (err.killed ? 'git took too long (no answer from the remote).' : str(err.message)) : '')) }));
    if (input != null && cp.stdin) { cp.stdin.end(input); }
  });
}

function open(opts) {
  const o = opts || {};
  const root = path.resolve(o.root || path.join(__dirname, '..', '..'));
  const branch = str(o.branch || process.env.EQUIPRITE_DATA_BRANCH || DEFAULT_BRANCH).trim();
  const dir = path.resolve(o.dir || path.join(root, '.equiprite-data'));
  const remote = str(o.remote || 'origin');
  const log = typeof o.log === 'function' ? o.log : () => {};
  const g = o.git ? (cwd, args) => o.git(cwd, args) : (cwd, args, ms, env, input) => runGit(o.gitPath, cwd, args, ms, env, input);
  const listeners = [];
  const relDir = path.relative(root, dir).split(path.sep).join('/') || dir;

  const data = {
    ok: false, dir: dir, branch: branch, reason: '', created: false, moved: 0,
    info: () => ({ separate: data.ok, branch: branch, dir: relDir, reason: data.reason, created: data.created, moved: data.moved }),
    onMerged: (fn) => { if (typeof fn === 'function') listeners.push(fn); },
    merged: () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* the next start catches up */ } }),
    resolve: resolve,
    ensure: ensure,
  };

  // ── a data file changed on both sides ──
  function resolve(file, ours, theirs) {
    if (ours == null) return theirs;
    if (theirs == null) return ours;
    const pages = require('./pages');
    try {
      if (file === PAGES_RES + '/catalog.json') {
        return pages.mergeCatalog(ours, theirs, (id) => { try { return JSON.parse(fs.readFileSync(path.join(dir, PAGES_RES, 'sheets', pages.fileOf(id) + '.json'), 'utf8')); } catch (e) { return null; } });
      }
      if (file.indexOf(PAGES_RES + '/sheets/') === 0) return pages.mergeSheet(ours, theirs);
      if (file === FDD_RES + '/library.json') return require('./fdd').mergeLibrary(ours, theirs);
      if (file.indexOf(CODE_HISTORY + '/') === 0) { const a = JSON.parse(ours), b = JSON.parse(theirs); return str(a.updatedAt) >= str(b.updatedAt) ? ours : theirs; } // the later state of a change
    } catch (e) { /* not JSON as expected: keep ours */ }
    return null;
  }

  const repo = () => gitPaths.create({ root: dir, paths: DATA_PATHS.concat(['README.md']), git: o.git ? (args) => o.git(dir, args) : undefined, gitPath: o.gitPath,
    message: 'EquipRite data: update', sync: { resolve: resolve, after: data.merged } });

  const fail = (why) => { data.ok = false; data.reason = why; log('data branch: ' + why); return data; };

  /** Data saved in the project folder on this PC and not on the code branch's remote (an older app saved it there):
   *  onto the data branch — a file it lacks copied, a sheet / the catalog / the library merged; nothing deleted. */
  async function moveLocal() {
    const up = await g(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    let base = 'HEAD';
    if (up.code === 0) { const mb = await g(root, ['merge-base', 'HEAD', up.stdout.trim()]); if (mb.code === 0 && mb.stdout.trim()) base = mb.stdout.trim(); }
    const changed = (await g(root, ['diff', '--name-only', base, '--'].concat(DATA_PATHS))).stdout.split('\n')
      .concat((await g(root, ['ls-files', '--others', '--exclude-standard', '--'].concat(DATA_PATHS))).stdout.split('\n'))
      .map((x) => x.trim()).filter((x) => x && !/(^|\/)README\.md$/i.test(x));
    const LAST = /(^|\/)(catalog|library)\.json$/;
    const files = changed.filter((x, i) => changed.indexOf(x) === i && isFile(path.join(root, x))).sort((a, b) => (LAST.test(a) ? 1 : 0) - (LAST.test(b) ? 1 : 0));
    let n = 0;
    files.forEach((f) => {
      const from = path.join(root, f), to = path.join(dir, f);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (!isFile(to)) { fs.copyFileSync(from, to); n++; return; }
      if (!/\.json$/i.test(f)) return; // a screenshot or a document already there: the data branch's
      const mine = fs.readFileSync(from, 'utf8'), there = fs.readFileSync(to, 'utf8');
      if (mine === there) return;
      const merged = resolve(f, mine, there);
      if (merged != null && merged !== there) { fs.writeFileSync(to, merged); n++; }
    });
    return n;
  }

  let busy = null;
  function ensure() {
    if (data.ok) return Promise.resolve(data);
    if (busy) return busy;
    busy = (async () => {
      try {
        const top = await g(root, ['rev-parse', '--show-toplevel']);
        if (top.code !== 0) return fail(/not installed/.test(top.stderr) ? 'git is not installed on this PC.' : 'The project folder is not a git repository.');
        if (isDir(dir)) {
          // made before: it must be the data branch's own worktree
          let me = await g(dir, ['rev-parse', '--show-toplevel']);
          if (me.code !== 0) { await g(root, ['worktree', 'repair', dir]); me = await g(dir, ['rev-parse', '--show-toplevel']); }
          const br = await g(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
          if (me.code !== 0 || !samePath(me.stdout.trim(), dir) || br.stdout.trim() !== branch) {
            return fail(relDir + ' is there but is not the data branch ' + branch + ': move that folder away and start the app again.');
          }
          const pl = await repo().pull();
          if (!pl.ok) log('data branch: could not get what others pushed (' + pl.error + ')');
          data.ok = true; data.reason = '';
          return data;
        }
        await g(root, ['worktree', 'prune']);
        const remotes = (await g(root, ['remote'])).stdout.split('\n').map((x) => x.trim());
        let onRemote = false, reached = remotes.indexOf(remote) === -1;
        if (!reached) {
          const f = await g(root, ['fetch', '--quiet', remote, '+refs/heads/' + branch + ':refs/remotes/' + remote + '/' + branch], 60000);
          if (f.code === 0) { onRemote = true; reached = true; } else if (/couldn.t find remote ref|not our ref|no such ref/i.test(f.stderr)) reached = true;
          else log('data branch: fetch failed: ' + f.stderr.trim());
        }
        const local = (await g(root, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch])).code === 0;
        let add;
        if (local) add = await g(root, ['worktree', 'add', dir, branch]);
        else if (onRemote) add = await g(root, ['worktree', 'add', '--track', '-b', branch, dir, remote + '/' + branch]);
        else if (reached) {
          // a new branch, with no history of the code: the data in the project folder as it is now. Built with a
          // separate index (nothing of the code is ever checked out there), then checked out.
          const idx = path.join(dir + '.index-' + process.pid);
          const env = { GIT_INDEX_FILE: idx };
          try {
            add = await g(root, ['add', '-f', '--'].concat(DATA_PATHS.filter((p) => isDir(path.join(root, p)))), 0, env);
            if (add.code === 0) await g(root, ['rm', '-q', '--cached', '--ignore-unmatch', '--', FDD_DOCS + '/README.md'], 0, env);
            const readme = add.code === 0 ? await g(root, ['hash-object', '-w', '--stdin'], 0, null, README) : add;
            if (readme.code === 0) add = await g(root, ['update-index', '--add', '--cacheinfo', '100644,' + readme.stdout.trim() + ',README.md'], 0, env); else add = readme;
            const tree = add.code === 0 ? await g(root, ['write-tree'], 0, env) : add;
            const commit = tree.code === 0 ? await g(root, ['commit-tree', tree.stdout.trim(), '-m', 'EquipRite data: the app\'s data, apart from the code']) : tree;
            add = commit.code === 0 ? await g(root, ['branch', branch, commit.stdout.trim()]) : commit;
            if (add.code === 0) add = await g(root, ['worktree', 'add', dir, branch]);
          } finally { try { fs.unlinkSync(idx); } catch (e) { /* none */ } }
        } else return fail('Could not reach ' + remote + ' to find the data branch ' + branch + ' (offline?): saved in the project folder for now.');
        if (add.code !== 0) return fail('Could not check out the data branch ' + branch + ': ' + (add.stderr || add.stdout).trim());
        data.created = true;
        DATA_PATHS.forEach((p) => fs.mkdirSync(path.join(dir, p), { recursive: true }));
        if (local) { const pl = await repo().pull(); if (!pl.ok) log('data branch: could not get what others pushed (' + pl.error + ')'); }
        if (onRemote || local) {
          data.moved = await moveLocal();
          if (data.moved) log('data branch: ' + data.moved + ' file(s) saved in the project folder moved onto it');
        }
        if (data.moved || !onRemote) {
          const s = await repo().save({ message: data.moved ? 'EquipRite data: ' + data.moved + ' file(s) saved in the project folder on this PC' : 'EquipRite data: update' });
          if (!s.ok) log('data branch: not pushed yet (' + s.error + ')');
        }
        data.ok = true; data.reason = '';
        return data;
      } catch (e) {
        return fail('The data branch could not be set up: ' + str(e && e.message));
      } finally { busy = null; }
    })();
    return busy;
  }

  return data;
}

module.exports = { open, DEFAULT_BRANCH, DATA_PATHS, PAGES_RES, FDD_RES, FDD_DOCS, CODE_HISTORY, README };
