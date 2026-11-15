#!/usr/bin/env node
'use strict';
/**
 * Run a VB application from its own folder — your workspace's working copy, or any VB Studio app on this PC — without
 * opening Build.Rite, from any terminal (VS Code's too):
 *   - built with Build.Rite's build tool, from a copy of the folder (its Component Exchange list emptied: the components
 *     load from Oracle's CDN, the paths in its app-flow.json) — the folder itself is never changed
 *   - served on this PC at one address, its backends proxied (as `npm run serve`)
 *   - built again each time you save a file in it: reload the page to see the change
 *
 *   node C:\path\to\equiprite-rebuild\tools\run-vb-app.js [folder] [--app <name>] [--port 8890] [--open]
 *        [--user <name>] [--roles RT_EQP_ADMINISTRATOR,RT_EQP_MANAGER]
 *   npm run vb -- <folder> [--app <name>] [--port 8890] [--open] [--user …] [--roles …]   (from Build.Rite's own folder)
 *
 * folder: the VB app's folder (with visual-application.json) — the current one when left out; a workspace's folder
 * (with main and working inside) runs its working copy. Who the app runs as: --user and --roles (or EQP_USER, EQP_ROLES;
 * EQP_FUSION_USER / EQP_FUSION_PASSWORD to read the user's own roles from Fusion), as with `npm run serve`; else anonymous
 * (pages that need access stay hidden). A user with no roles sees "You don't have access": --roles answers them here.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WP = require(path.join(ROOT, 'desktop', 'lib', 'workPreview'));
const DS = require(path.join(ROOT, 'desktop', 'lib', 'devserver'));

const tty = process.stdout.isTTY;
const paint = (code, s) => (tty ? '\x1b[' + code + 'm' + s + '\x1b[0m' : s);
const say = (s) => console.log(s);
const fail = (s) => { console.error(paint('31', '✗ ' + s)); process.exit(1); };

/** --flags and the folder. */
function argsOf(argv) {
  const o = { folder: '', app: '', port: 8890, open: false, user: '', roles: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app') o.app = String(argv[++i] || '');
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--open') o.open = true;
    else if (a === '--user' || a === '--as') o.user = String(argv[++i] || '');
    else if (a === '--roles' || a === '--role') o.roles = String(argv[++i] || '');
    else if (a === '--help' || a === '-h') o.help = true;
    else if (!o.folder) o.folder = a;
  }
  return o;
}
/** The VB app's folder: the one given (or the current one); a workspace's folder → its working copy. */
function folderOf(given) {
  const f = path.resolve(given || process.cwd());
  if (fs.existsSync(path.join(f, 'visual-application.json'))) return f;
  if (fs.existsSync(path.join(f, 'working', 'visual-application.json'))) return path.join(f, 'working');
  return '';
}
const appsIn = (f) => { try { return fs.readdirSync(path.join(f, 'webApps')).filter((a) => fs.existsSync(path.join(f, 'webApps', a, 'app-flow.json'))).sort(); } catch (e) { return []; } };
/** Who the app runs as, said: { text, warn } — anonymous, or a user with no roles, is a warning (what to add, said). */
function whoLine(identity) {
  const id = identity || {};
  if (!id.username) return { warn: true, text: 'runs anonymous: pages that need access stay hidden — run as someone with --user <name> --roles RT_EQP_ADMINISTRATOR' };
  if (id.roles && id.roles.length) return { warn: false, text: 'runs as ' + id.username + ' with the roles ' + id.roles.join(', ') + ' (answered here)' };
  if (id.fusion) return { warn: false, text: 'runs as ' + id.username + ', with their roles read from Fusion' };
  return { warn: true, text: 'runs as ' + id.username + ' with NO roles: the app will say "You don\'t have access" — add --roles RT_EQP_ADMINISTRATOR (or one of: ' + DS.KNOWN_ROLES.join(', ') + ')' };
}
/** Where it is built: beside a workspace's working copy (as ▶ Run), else in .build-rite/<name>/ beside the app's folder. */
const outFor = (f) => (path.basename(f) === 'working' ? WP.outOf(f) : path.join(path.dirname(f), '.build-rite', path.basename(f), WP.PREVIEW_DIR));

async function main() {
  const o = argsOf(process.argv.slice(2));
  if (o.help) { say(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*\*/, '').replace(/^ \* ?/gm, '')); return; }
  const folder = folderOf(o.folder);
  if (!folder) fail('Not a VB app\'s folder (no visual-application.json): ' + path.resolve(o.folder || process.cwd()) + '\n  Give the app\'s folder, e.g. node tools/run-vb-app.js C:\\work\\my-project-my_ws\\working');
  const apps = appsIn(folder);
  if (!apps.length) fail('No app in ' + folder + ' (webApps/<app>/app-flow.json).');
  const app = o.app ? o.app : (apps.length === 1 ? apps[0] : (apps.indexOf('vbredwoodapp') !== -1 ? 'vbredwoodapp' : apps[0]));
  if (apps.indexOf(app) === -1) fail('No app "' + app + '" in ' + folder + ' — its apps: ' + apps.join(', '));
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) fail('Not a port: ' + o.port);
  // who it runs as: --user / --roles first, else EQP_USER / EQP_ROLES (as npm run serve)
  const identity = DS.identityFromEnv(Object.assign({}, process.env, o.user ? { EQP_USER: o.user } : {}, o.roles ? { EQP_ROLES: o.roles } : {}));
  const unknown = (identity.roles || []).filter((r) => DS.KNOWN_ROLES.indexOf(r) === -1);
  if (unknown.length) say(paint('33', '  roles not known here: ' + unknown.join(', ') + ' — the known ones: ' + DS.KNOWN_ROLES.join(', ')));

  // one server for the whole run (the address stays the same: a rebuild only changes the files it serves)
  let srv = null;
  const serve = async (s) => {
    if (!srv) srv = await DS.createDevServer({ buildDir: s.buildDir, repoRoot: s.dir, webApp: s.webApp, port: o.port, getIdentity: () => identity,
      backendOverrides: DS.backendOverridesFromEnv(process.env), onLog: (l) => say(paint('36', '  server │ ') + l) });
    return { url: srv.url, close: () => {} };
  };
  const wp = WP.open({ buildTool: ROOT, serve: serve, onLine: (l) => say(paint('2', '  build  │ ') + l), log: (l) => say(paint('2', '  ' + l)) });
  const out = outFor(folder);
  say(paint('1', '▶ ' + app) + ' from ' + folder + (apps.length > 1 ? '  (its apps: ' + apps.join(', ') + ' — --app <name> for another)' : ''));
  say('  built into ' + out + ' — the folder itself is never changed');
  const t0 = Date.now();
  const r = await wp.ensure({ folder: folder, out: out, app: app });
  if (!r.ok) fail(r.error);
  say('');
  say(paint('32;1', '✓ running at ' + r.url + '/') + paint('2', '   (built in ' + Math.round((Date.now() - t0) / 100) / 10 + ' s)'));
  const who = whoLine(identity);
  say(who.warn ? paint('33', '  ' + who.text) : '  ' + who.text);
  say('  save a file in ' + folder + ' and it is built again: reload the page (F5) to see it.  Ctrl+C stops.');
  if (o.open) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', r.url + '/']] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [r.url + '/']];
    try { require('child_process').spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch (e) { /* open it yourself */ }
  }

  // built again when a file in it changes (saved): its webApps and visual-application.json
  let timer = null, busy = false, again = false;
  const rebuild = async () => {
    if (busy) { again = true; return; }
    busy = true;
    const t1 = Date.now();
    const rr = await wp.ensure({ folder: folder, out: out, app: app });
    if (!rr.ok) say(paint('31', '✗ ' + rr.error));
    else if (rr.built) say(paint('32;1', '✓ built again in ' + Math.round((Date.now() - t1) / 100) / 10 + ' s — reload the page (F5) to see it'));
    busy = false;
    if (again) { again = false; rebuild(); }
  };
  const changed = () => { clearTimeout(timer); timer = setTimeout(rebuild, 700); };
  let watching = false;
  try { fs.watch(path.join(folder, 'webApps'), { recursive: true }, changed); fs.watch(path.join(folder, 'visual-application.json'), changed); watching = true; } catch (e) { watching = false; }
  if (!watching) setInterval(() => { if (!busy && wp.status(folder).fresh === false) rebuild(); }, 1500); // no file watching here: looked at
  process.on('SIGINT', () => { say('\n  stopped.'); try { if (srv) srv.close(); } catch (e) { /* gone */ } process.exit(0); });
}

if (require.main === module) main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
module.exports = { argsOf, folderOf, appsIn, outFor, whoLine };
