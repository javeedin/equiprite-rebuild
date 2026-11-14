'use strict';
/**
 * Your workspace, running in Build.Rite: its working folder built with the app's own build tool (grunt vb-clean
 * vb-process-local, as the Issues sandboxes are) into a folder of Build.Rite's beside it — never inside the working
 * folder, so git there sees nothing new — and served like the app itself (o.serve). Capture screenshot opens a page
 * there, and Run in your workspace shows it, so what you see is your working folder's code (your changes), not
 * Build.Rite's own copy of the app.
 *
 * Built again only when the code changed (a fingerprint of the working folder's webApps files and
 * visual-application.json); one build at a time (a second ask waits for the first and uses it). The build folder is
 * emptied before each build (the build tool will not delete outside its own folder) — only a folder named PREVIEW_DIR.
 * Each build has a version folder of its own, so the server is started again after one.
 *
 *   open({ buildTool, build?(src, target), serve({ dir, buildDir, webApp }) → { url, close }, log?, now? })
 *     .ensure({ folder, out, app })  → { ok, url, built, ms, builtAt } | { ok: false, error }
 *     .status(folder)               → { built, builtAt, fresh, building }
 *     .stop(folder?)                  its servers closed (all, without a folder)
 *   outOf(workingFolder) → the build folder beside it
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREVIEW_DIR = 'build-rite-preview';
const str = (v) => (v == null ? '' : String(v));
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const outOf = (working) => path.join(path.dirname(path.resolve(str(working))), PREVIEW_DIR);

/** The code's fingerprint: every file under webApps (its path, size and time) and visual-application.json. */
function fingerprint(folder) {
  const h = crypto.createHash('sha1');
  const walk = (dir, rel) => {
    let names = [];
    try { names = fs.readdirSync(dir).sort(); } catch (e) { return; }
    names.forEach((n) => {
      if (n === '.git' || n === 'node_modules') return;
      const p = path.join(dir, n);
      let st;
      try { st = fs.statSync(p); } catch (e) { return; }
      if (st.isDirectory()) walk(p, rel + n + '/');
      else h.update(rel + n + '|' + st.size + '|' + Math.floor(st.mtimeMs) + '\n');
    });
  };
  try { const st = fs.statSync(path.join(folder, 'visual-application.json')); h.update('visual-application.json|' + st.size + '|' + Math.floor(st.mtimeMs) + '\n'); } catch (e) { /* none */ }
  walk(path.join(folder, 'webApps'), 'webApps/');
  return h.digest('hex');
}

function open(opts) {
  const o = opts || {};
  const now = o.now || (() => new Date());
  const log = (t) => { if (typeof o.log === 'function') { try { o.log(t); } catch (e) { /* no log */ } } };
  const state = {};   // folder → { fp, out, builtAt }
  const servers = {}; // folder|app → Promise<{ url, close }>
  let chain = Promise.resolve();
  let building = '';

  /** The app's own build tool, from the working folder into the build folder (emptied first: ours, by its name). */
  function build(src, target) {
    if (path.basename(target) !== PREVIEW_DIR) return Promise.resolve({ ok: false, error: 'Not a preview folder: ' + target });
    try { fs.rmSync(target, { recursive: true, force: true }); } catch (e) { return Promise.resolve({ ok: false, error: 'Its last build could not be cleared (' + (e.code || e.message) + '): ' + target }); }
    if (typeof o.build === 'function') return Promise.resolve(o.build(src, target)).catch((e) => ({ ok: false, error: str(e && e.message) }));
    const tool = path.resolve(o.buildTool || path.join(__dirname, '..', '..'));
    const grunt = path.join(tool, 'node_modules', 'grunt', 'bin', 'grunt');
    if (!isFile(grunt)) return Promise.resolve({ ok: false, error: 'The build tool is not installed: run npm install in ' + tool + '.' });
    return new Promise((resolve) => {
      const t0 = Date.now();
      const env = Object.assign({}, process.env, process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {});
      require('child_process').execFile(process.execPath, [grunt, 'vb-clean', 'vb-process-local', '--git-sources=' + src, '--target=' + target],
        { cwd: tool, env: env, timeout: 600000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
          const out = (str(stdout) + str(stderr)).replace(/\x1b\[[0-9;]*m/g, '');
          resolve({ ok: !err, ms: Date.now() - t0, error: err ? (out.split('\n').filter((l) => /error|fatal|warning:/i.test(l)).slice(-6).join(' ').trim() || str(err.message)).slice(0, 600) : '' });
        });
    });
  }
  function closeServers(folder) {
    Object.keys(servers).filter((k) => !folder || k.indexOf(folder + '|') === 0).forEach((k) => {
      const p = servers[k];
      delete servers[k];
      Promise.resolve(p).then((s) => s && s.close && s.close()).catch(() => {});
    });
  }

  function ensure(w) {
    w = w || {};
    const folder = path.resolve(str(w.folder)), out = path.resolve(str(w.out) || outOf(folder)), app = str(w.app);
    if (!w.folder || !isFile(path.join(folder, 'visual-application.json'))) return Promise.resolve({ ok: false, error: 'Your working folder has no visual-application.json, so its app cannot be built: ' + folder });
    if (!/^[\w.-]+$/.test(app)) return Promise.resolve({ ok: false, error: 'Which app? (' + app + ')' });
    if (typeof o.serve !== 'function') return Promise.resolve({ ok: false, error: 'Running your workspace needs the desktop app.' });
    const run = chain.then(async () => {
      const index = path.join(out, 'processed', 'webApps', app, 'index.html');
      const fp = fingerprint(folder);
      const st = state[folder];
      let built = false, ms = 0;
      if (!st || st.fp !== fp || st.out !== out || !isFile(index)) {
        building = folder;
        log('your workspace: building ' + folder + ' → ' + out);
        closeServers(folder); // a new build: its version folder is new
        const r = await build(folder, out);
        building = '';
        if (!r || !r.ok) { delete state[folder]; return { ok: false, error: 'Your workspace could not be built: ' + ((r && r.error) || 'the build failed') }; }
        state[folder] = { fp: fp, out: out, builtAt: now().toISOString() };
        built = true; ms = r.ms || 0;
      }
      if (!isFile(index)) return { ok: false, error: 'The build has no app "' + app + '": is this page\'s app in your workspace?' };
      const k = folder + '|' + app;
      if (!servers[k]) servers[k] = Promise.resolve(o.serve({ dir: folder, buildDir: out, webApp: app })).catch((e) => { delete servers[k]; throw e; });
      try {
        const s = await servers[k];
        return { ok: true, url: str(s.url).replace(/\/$/, ''), built: built, ms: ms, builtAt: state[folder].builtAt };
      } catch (e) { return { ok: false, error: 'Your workspace\'s app could not be started: ' + str(e && e.message) }; }
    });
    chain = run.catch(() => {});
    return run.catch((e) => ({ ok: false, error: str(e && e.message) }));
  }

  function status(folder) {
    const f = path.resolve(str(folder)), st = state[f];
    return { built: !!st, builtAt: st ? st.builtAt : '', fresh: !!st && st.fp === fingerprint(f), building: building === f };
  }

  return { ensure: ensure, status: status, stop: closeServers, fingerprint: fingerprint };
}

module.exports = { open, outOf, fingerprint, PREVIEW_DIR };
