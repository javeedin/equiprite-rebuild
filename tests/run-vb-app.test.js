#!/usr/bin/env node
'use strict';
/**
 * Run a VB application from its own folder (tools/run-vb-app.js), for real: a VB app's folder as VB Studio has it (its
 * Component Exchange list, no build of its own) —
 *   - started from that folder: built (no exchange needed), served, its address said, who it runs as said (anonymous)
 *   - the page served is that folder's code; a file saved there: built again, said, and the page served has the change
 *   - the folder itself never changed (its list as VB Studio has it, nothing new in it); not a VB app's folder: said
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const H = require('./_harness');
const R = require('../tools/run-vb-app');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const CE_DEPS = JSON.stringify({ 'component-dependencies': { 'oj-sp': { version: '2601.0.3', components: { card: '2601.0.3' } } } }, null, 2) + '\n';
const files = (dir) => { const out = []; const walk = (d, rel) => fs.readdirSync(d).forEach((n) => { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p, rel + n + '/'); else out.push(rel + n + ':' + fs.statSync(p).size); }); walk(dir, ''); return out.sort().join('\n'); };

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'grunt', 'bin', 'grunt'))) { T.check('the build tool is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-runvb-'));
  let child = null;
  try {
    // a VB Studio app's folder (another app on this PC, not a workspace): visual-application.json, one app, its exchange list
    const app = path.join(tmp, 'apps', 'ledger-app');
    fs.mkdirSync(path.join(app, 'webApps'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'visual-application.json'), path.join(app, 'visual-application.json'));
    fs.cpSync(path.join(ROOT, 'webApps', 'equiprite-mobile'), path.join(app, 'webApps', 'equiprite-mobile'), { recursive: true });
    fs.mkdirSync(path.join(app, 'webApps', 'equiprite-mobile', 'settings'), { recursive: true });
    fs.writeFileSync(path.join(app, 'webApps', 'equiprite-mobile', 'settings', 'dependencies.json'), CE_DEPS);
    const before = files(app);

    T.section('what it runs, where it builds');
    T.check('the folder given, the current one, or a workspace\'s folder (its working copy); not a VB app\'s folder: none', R.folderOf(app) === app && R.folderOf(path.join(tmp, 'apps')) === ''
      && R.argsOf(['x', '--app', 'a', '--port', '9000', '--open']).folder === 'x' && R.argsOf(['--port', '9000']).port === 9000 && R.argsOf([]).port === 8890);
    T.check('…built beside it (.build-rite/<name>/build-rite-preview), or beside a workspace\'s working copy (as ▶ Run)', R.outFor(app) === path.join(tmp, 'apps', '.build-rite', 'ledger-app', 'build-rite-preview')
      && R.outFor(path.join(tmp, 'ws', 'working')) === path.join(tmp, 'ws', 'build-rite-preview'));
    const bad = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'run-vb-app.js'), path.join(tmp, 'apps')], { encoding: 'utf8', timeout: 20000 });
    T.check('not a VB app\'s folder: said (no visual-application.json), and how to give one', bad.status === 1 && /Not a VB app's folder/.test(bad.stderr), bad.stderr);

    T.section('run from its own folder');
    const env = Object.assign({}, process.env); delete env.EQP_USER;
    child = spawn(process.execPath, [path.join(ROOT, 'tools', 'run-vb-app.js'), '--port', '0'], { cwd: app, env: env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const until = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(out)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
    const up = await until(/running at (http:\/\/localhost:\d+)\//, 120000);
    const url = ((/running at (http:\/\/localhost:\d+)\//.exec(out)) || [])[1] || '';
    T.check('started in the app\'s folder (no folder given): built — no Component Exchange needed — and running at an address', up && !!url && /▶ equiprite-mobile from /.test(out) && /build {2}│ /.test(out), out.slice(-800));
    T.check('…who it runs as said: anonymous (pages that need access hidden), and how to run as someone', /runs anonymous: pages that need access stay hidden — set EQP_USER/.test(out));
    const home = await fetch(url + '/');
    const html = await home.text();
    T.check('…the page served: that folder\'s app', home.status === 200 && /<html/i.test(html), home.status + ' ' + html.slice(0, 120));
    const idx = path.join(app, 'webApps', 'equiprite-mobile', 'index.html');
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('</head>', '<!-- saved in the folder -->\n</head>'));
    const again = await until(/built again in [\d.]+ s — reload the page/, 120000);
    const after = await (await fetch(url + '/')).text();
    T.check('a file saved there: built again (said), the page served has the change (same address)', again && /saved in the folder/.test(after), out.slice(-600));
    const now = files(app).split('\n').filter((l) => !/index\.html:/.test(l)).join('\n');
    T.check('…the folder itself never changed (its exchange list as VB Studio has it, nothing new in it)', now === before.split('\n').filter((l) => !/index\.html:/.test(l)).join('\n')
      && fs.readFileSync(path.join(app, 'webApps', 'equiprite-mobile', 'settings', 'dependencies.json'), 'utf8') === CE_DEPS);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    if (child) { try { child.kill(); } catch (e) { /* gone */ } }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
