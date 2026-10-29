/*
 * Local-run harness: the build preflight and the desktop shell's navigation rule.
 *
 * Until 2026-10-29 "npm run desktop:install" put Electron in desktop/node_modules. vb-process-local copies
 * every project folder but build, .git, node_modules, mobileApps, webApps and services into build/processed,
 * so once Electron was installed the copy died on desktop/node_modules/.bin/electron (EISDIR) and both
 * "npm run desktop:fresh" and "npm run serve" stopped at the build. Electron now installs with the root
 * "npm install" (the root node_modules is never copied), and the preflight stops on a leftover one.
 *
 * Runs the REAL tools/check-tools.js and desktop/lib/hosts.js.
 *
 * Run:  node tests/local-run-harness.test.js
 */
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const H    = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const { checkTools, strayNodeModules, strayMessage } = require(path.join(ROOT, 'tools', 'check-tools.js'));
const { navAllowed } = require(path.join(ROOT, 'desktop', 'lib', 'hosts.js'));

// ── preflight: build tool version ────────────────────────────────────

T.section('preflight — build tool version');
T.eq('matching tool passes', checkTools('2701', '2701.0.3').ok, true);
T.eq('older tool stops', checkTools('2701', '2610.0.1').ok, false);
T.eq('missing tool stops', checkTools('2701', '').ok, false);

// ── preflight: node_modules inside a copied folder ───────────────────

T.section('preflight — node_modules inside a copied folder');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-harness-'));
try {
  for (const d of ['node_modules', 'build/x/node_modules', 'webApps/node_modules', 'desktop/lib', 'tools']) {
    fs.mkdirSync(path.join(tmp, d), { recursive: true });
  }
  T.eq('clean project has none', strayNodeModules(tmp).length, 0);
  fs.mkdirSync(path.join(tmp, 'desktop', 'node_modules', '.bin'), { recursive: true });
  const stray = strayNodeModules(tmp);
  T.eq('desktop/node_modules is caught', stray.join(','), 'desktop/node_modules');
  T.check('message says how to delete it', /rm -rf desktop\/node_modules/.test(strayMessage(stray)));
  T.check('message gives the Windows command', /rmdir \/s \/q desktop\\node_modules/.test(strayMessage(stray)));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── wiring: Electron lives in the root node_modules ──────────────────

T.section('wiring — Electron installs at the root');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const desktopPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'));
T.check('root devDependencies carry electron', !!rootPkg.devDependencies.electron);
T.check('desktop/package.json installs nothing',
  !desktopPkg.dependencies && !desktopPkg.devDependencies);
T.check('desktop:fresh builds, then runs the shell', /^npm run build && electron desktop$/.test(rootPkg.scripts['desktop:fresh']));
T.check('no script installs into desktop/', !Object.values(rootPkg.scripts).some((s) => /--prefix desktop/.test(s)));

// ── desktop window: what stays in the window ─────────────────────────

T.section('desktop — navigation');
const APP = 'http://localhost:18888';
T.eq('the app itself stays', navAllowed(APP + '/?page=equipment', APP), true);
T.eq('a different local port leaves', navAllowed('http://localhost:9999/', APP), false);
T.eq('Oracle CDN stays', navAllowed('https://static.oracle.com/cdn/x.js', APP), true);
T.eq('Fusion pod stays', navAllowed('https://abc-test.fa.us2.oraclecloud.com/fscmUI/', APP), true);
T.eq('plain http to Oracle leaves', navAllowed('http://static.oracle.com/', APP), false);
T.eq('look-alike host leaves', navAllowed('https://static.oracle.com.evil.example/', APP), false);
T.eq('garbage leaves', navAllowed('not a url', APP), false);

T.report();
