'use strict';
/**
 * Your workspace, running in Build.Rite: its working folder built with the app's own build tool (grunt vb-clean
 * vb-process-local, as the Issues sandboxes are) into a folder of Build.Rite's beside it — never inside the working
 * folder, so git there sees nothing new — and served like the app itself (o.serve). Capture screenshot opens a page
 * there, and Run in your workspace shows it, so what you see is your working folder's code (your changes), not
 * Build.Rite's own copy of the app.
 *
 * Built from a copy of the working folder (PREVIEW_DIR/src, without .git), in which each app's
 * settings/dependencies.json is emptied: a VB Studio app lists the Component Exchange components it uses there (oj-sp…),
 * and the build tool then insists on the exchange's address (--url:ce) to download them. The app loads them from Oracle's
 * public CDN instead (the paths pinned in its app-flow.json) — as Build.Rite's own copy of the app is built. The working
 * folder itself is never changed: VB Studio keeps its list. Built into PREVIEW_DIR/build.
 *
 * Built again only when the code changed (a fingerprint of the working folder's webApps files and
 * visual-application.json); one build at a time (a second ask waits for the first and uses it). The preview folder is
 * emptied before each build (the build tool will not delete outside its own folder) — only a folder named PREVIEW_DIR.
 * Each build has a version folder of its own, so the server is started again after one.
 *
 *   open({ buildTool, build?(src, target), serve({ dir, buildDir, webApp }) → { url, close }, log?, onLine?, now? })
 *     onLine(text): the build tool's output, line by line, as it builds (the Run console shows it)
 *     onStep({ key, state, text }): each step as it goes — check (did the code change?), copy (the working folder into
 *       the preview's src), prepare (its Component Exchange list emptied), build (Oracle's VB build tool), serve (the
 *       app's local server); state: running | done | skipped | failed
 *     .ensure({ folder, out, app })  → { ok, url, built, ms, builtAt } | { ok: false, error }
 *     .status(folder)               → { built, builtAt, fresh, building }
 *     .stop(folder?)                  its servers closed (all, without a folder)
 *   outOf(workingFolder) → the build folder beside it
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREVIEW_DIR = 'build-rite-preview';
const SRC = 'src', BUILD = 'build';
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
  const step = (key, st, text) => { if (typeof o.onStep === 'function') { try { o.onStep({ key: key, state: st, text: str(text) }); } catch (e) { /* no screen */ } } };
  const secs = (ms) => (Math.round(ms / 100) / 10) + ' s';
  const servers = {}; // folder|app → Promise<{ url, close }>
  let chain = Promise.resolve();
  let building = '';

  /** The copy built from: the working folder without .git (or node_modules), each app's Component Exchange list emptied. */
  async function stage(folder, root) {
    const src = path.join(root, SRC);
    // copied without blocking: the desktop app answers its screens meanwhile (a big working folder takes a moment)
    await fs.promises.cp(folder, src, { recursive: true, filter: (p) => { const b = path.basename(p); return b !== '.git' && b !== 'node_modules'; } });
    const emptied = [];
    const apps = path.join(src, 'webApps');
    (fs.existsSync(apps) ? fs.readdirSync(apps) : []).forEach((a) => {
      const f = path.join(apps, a, 'settings', 'dependencies.json');
      if (!isFile(f)) return;
      try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (j && j['component-dependencies'] && Object.keys(j['component-dependencies']).length) {
          fs.writeFileSync(f, JSON.stringify(Object.assign({}, j, { 'component-dependencies': {} }), null, 2) + '\n');
          emptied.push(a);
        }
      } catch (e) { /* not JSON: left for the build tool to say */ }
    });
    return { src: src, emptied: emptied };
  }
  /** The app's own build tool: the preview folder (ours, by its name) emptied, the working folder copied into it, built. */
  async function build(folder, root) {
    if (path.basename(root) !== PREVIEW_DIR) return { ok: false, error: 'Not a preview folder: ' + root };
    const t0 = Date.now();
    step('copy', 'running', 'copying ' + folder + ' → ' + path.join(root, SRC) + ' (without .git and node_modules)');
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { step('copy', 'failed', 'its last build could not be cleared'); return { ok: false, error: 'Its last build could not be cleared (' + (e.code || e.message) + '): ' + root }; }
    let st;
    try { st = await stage(folder, root); } catch (e) { step('copy', 'failed', String(e.code || e.message)); return { ok: false, error: 'Your working folder could not be copied to build it (' + (e.code || e.message) + ').' }; }
    step('copy', 'done', 'copied in ' + secs(Date.now() - t0));
    step('prepare', 'done', st.emptied.length ? 'the Component Exchange list of ' + st.emptied.join(', ') + ' emptied in the copy — its components load from Oracle\'s CDN (your folder keeps its list)' : 'nothing to change in the copy');
    if (st.emptied.length) log('your workspace: Component Exchange components (' + st.emptied.join(', ') + ') loaded from the CDN, as in Build.Rite');
    step('build', 'running', 'Oracle\'s VB build tool: grunt vb-clean vb-process-local (the copy → ' + path.join(root, BUILD) + ')');
    const r = await run(st.src, path.join(root, BUILD));
    step('build', r && r.ok ? 'done' : 'failed', r && r.ok ? 'built in ' + secs(r.ms || 0) : ((r && r.error) || 'the build failed'));
    return Object.assign(r || {}, { emptied: st.emptied });
  }
  function run(src, target) {
    if (typeof o.build === 'function') return Promise.resolve(o.build(src, target)).catch((e) => ({ ok: false, error: str(e && e.message) }));
    const tool = path.resolve(o.buildTool || path.join(__dirname, '..', '..'));
    const grunt = path.join(tool, 'node_modules', 'grunt', 'bin', 'grunt');
    if (!isFile(grunt)) return Promise.resolve({ ok: false, error: 'The build tool is not installed: run npm install in ' + tool + '.' });
    return new Promise((resolve) => {
      const t0 = Date.now();
      const env = Object.assign({}, process.env, process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {});
      // its output line by line as it comes (onLine: the Run console), the whole kept for the error
      const p = require('child_process').spawn(process.execPath, [grunt, 'vb-clean', 'vb-process-local', '--git-sources=' + src, '--target=' + target], { cwd: tool, env: env, windowsHide: true });
      let out = '', part = '';
      const line = (l) => { if (typeof o.onLine === 'function') { try { o.onLine(l); } catch (e) { /* no console */ } } };
      const feed = (chunk) => {
        const t = String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
        out = (out + t).slice(-200000);
        part += t;
        const ls = part.split(/\r?\n/);
        part = ls.pop();
        ls.forEach(line);
      };
      p.stdout.on('data', feed);
      p.stderr.on('data', feed);
      const timer = setTimeout(() => { try { p.kill(); } catch (e) { /* gone */ } }, 600000);
      p.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, ms: Date.now() - t0, error: 'The build tool did not start: ' + str(e && e.message) }); });
      p.on('close', (code) => {
        clearTimeout(timer);
        if (part) line(part);
        const ok = code === 0;
        resolve({ ok: ok, ms: Date.now() - t0, error: ok ? '' : (out.split('\n').filter((l) => /error|fatal|warning:/i.test(l)).slice(-6).join(' ').trim() || 'the build tool stopped (' + code + ')').slice(0, 600) });
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
    const job = chain.then(async () => {
      const index = path.join(out, BUILD, 'processed', 'webApps', app, 'index.html');
      const fp = fingerprint(folder);
      const st = state[folder];
      let built = false, ms = 0;
      step('check', 'running', 'did the working folder change since its last build?');
      if (!st || st.fp !== fp || st.out !== out || !isFile(index)) {
        step('check', 'done', !st ? 'not built yet: building it' : 'it changed since its last build: building it again');
        building = folder;
        log('your workspace: building ' + folder + ' → ' + out);
        closeServers(folder); // a new build: its version folder is new
        const r = await build(folder, out);
        building = '';
        if (!r || !r.ok) { delete state[folder]; return { ok: false, error: 'Your workspace could not be built: ' + ((r && r.error) || 'the build failed') }; }
        state[folder] = { fp: fp, out: out, builtAt: now().toISOString() };
        built = true; ms = r.ms || 0;
      } else {
        step('check', 'done', 'no change since its last build (' + st.builtAt + '): nothing to build');
        ['copy', 'prepare', 'build'].forEach((k) => step(k, 'skipped', 'not needed'));
      }
      if (!isFile(index)) return { ok: false, error: 'The build has no app "' + app + '": is this page\'s app in your workspace?' };
      const k = folder + '|' + app;
      const had = !!servers[k];
      step('serve', 'running', had ? 'the app\'s local server is running' : 'starting the app\'s local server');
      if (!servers[k]) servers[k] = Promise.resolve(o.serve({ dir: folder, buildDir: path.join(out, BUILD), webApp: app })).catch((e) => { delete servers[k]; throw e; });
      try {
        const s = await servers[k];
        step('serve', 'done', (had ? 'running at ' : 'started at ') + str(s.url).replace(/\/$/, ''));
        return { ok: true, url: str(s.url).replace(/\/$/, ''), built: built, ms: ms, builtAt: state[folder].builtAt };
      } catch (e) { step('serve', 'failed', str(e && e.message)); return { ok: false, error: 'Your workspace\'s app could not be started: ' + str(e && e.message) }; }
    });
    chain = job.catch(() => {});
    return job.catch((e) => ({ ok: false, error: str(e && e.message) }));
  }

  /** quick: without reading the code's fingerprint (fresh: null) — for a screen that asks often. */
  function status(folder, quick) {
    const f = path.resolve(str(folder)), st = state[f];
    return { built: !!st, builtAt: st ? st.builtAt : '', fresh: quick ? null : !!st && st.fp === fingerprint(f), building: building === f };
  }

  /** Built again from scratch next time (Rebuild): what was built is forgotten, its servers closed. */
  function forget(folder) { const f = path.resolve(str(folder)); delete state[f]; closeServers(f); }

  return { ensure: ensure, status: status, stop: closeServers, forget: forget, fingerprint: fingerprint };
}

module.exports = { open, outOf, fingerprint, PREVIEW_DIR, SRC, BUILD };
