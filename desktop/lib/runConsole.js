'use strict';
/**
 * The Run console (Build.Rite → Run console): what happens when your workspace runs, as it happens, and commands to drive
 * it — like an editor's terminal, without a shell (nothing typed is ever run as a program: each command is one of a few,
 * done by the desktop app itself; git only as status, log, diff and branch, read only).
 *
 * The lines (newest kept, up to `max`): build (the build tool's own output, line by line), server (the requests the
 * workspace's app makes of its local server), app (the app's own console in its window), nav (where its window went),
 * warn, error, info, cmd (what you typed) — each { seq, at, kind, text }.
 *
 *   open({ max?, now? }) → { push(kind, text), lines(after) → { lines, last, dropped }, clear(), command(text, does) }
 *   command(text, does) → { ok, text?, lines? }: does = the desktop app's { run(route), build(force), reload(), devtools(),
 *     stop(), git(args), changes(), signin(), code(), folder(), status(), runAs(user, roles | null), roles() } — each returns
 *     { ok, text?, lines? }
 */
const KINDS = ['build', 'server', 'app', 'nav', 'warn', 'error', 'info', 'cmd'];
const str = (v) => (v == null ? '' : String(v));

const HELP = [
  'Commands (nothing is run as a program — each is done by Build.Rite itself):',
  '  run                    your workspace\'s app, from its start page (built when its code changed)',
  '  run <page>             straight on a page: equipment-foundation/equipment-create, or /vp/shell/…',
  '  build                  build the working copy now (only if its code changed)',
  '  rebuild                build it again from scratch',
  '  reload                 reload the app\'s window',
  '  devtools               the app window\'s developer tools (its console, network, elements)',
  '  stop                   close the app\'s window and stop its local server',
  '  status                 who you are signed in as, the workspace, the build, the window',
  '  changes                the working copy\'s files changed since VB Studio',
  '  git status | git log | git diff | git branch     (read only, in the working copy)',
  '  as <user> <ROLE,…>      who the app runs as: a user and roles answered here (e.g. as priya.raman RT_EQP_ADMINISTRATOR)',
  '  as                     who it runs as now      as signin   back to the EquipRite sign-in',
  '  roles                  the roles the app knows (RT_EQP_…)',
  '  signin                 sign in to EquipRite as someone (File → Sign in as…): the app runs as them',
  '  code                   open the working folder in VS Code',
  '  folder                 open the working folder',
  '  clear                  clear this console',
];
const GIT = { status: ['status', '--short', '--branch'], log: ['log', '--oneline', '--decorate', '-20'], diff: null, branch: ['branch', '-vv'] };

/** A page given as flow/page, app/flow/page or an address → the address to open (/vp/shell/<flow>/<page>…). */
function routeOf(arg) {
  const a = str(arg).trim();
  if (!a) return '';
  if (a.charAt(0) === '/') return /^\/[\w\-./?=&%#]*$/.test(a) ? a : '';
  const parts = a.split('/').filter(Boolean);
  if (!parts.every((p) => /^[\w-]+$/.test(p))) return '';
  if (parts.length === 2) return '/vp/shell/' + parts[0] + '/' + parts[1];
  if (parts.length === 3) return '/vp/shell/' + parts[1] + '/' + parts[2]; // app/flow/page
  return '';
}

function open(opts) {
  const o = opts || {};
  const max = o.max || 3000;
  const now = o.now || (() => new Date());
  let buf = [], seq = 0, dropped = 0;

  function push(kind, text) {
    const k = KINDS.indexOf(kind) === -1 ? 'info' : kind;
    str(text).replace(/\r\n?/g, '\n').split('\n').forEach((t) => {
      if (!t.trim() && k === 'build') return; // the build tool's blank lines
      buf.push({ seq: ++seq, at: now().toISOString(), kind: k, text: t.slice(0, 2000) });
    });
    if (buf.length > max) { dropped += buf.length - max; buf = buf.slice(buf.length - max); }
    return seq;
  }
  function lines(after) {
    const a = Number(after) || 0;
    return { lines: buf.filter((l) => l.seq > a), last: seq, dropped: dropped };
  }
  function clear() { buf = []; return seq; }

  async function command(text, does) {
    const d = does || {};
    const line = str(text).trim();
    if (!line) return { ok: true };
    push('cmd', '> ' + line);
    const [verb, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    const call = async (name, ...args) => {
      if (typeof d[name] !== 'function') return { ok: false, text: 'Not here: ' + name + ' needs the desktop app.' };
      try { return (await d[name](...args)) || { ok: true }; } catch (e) { return { ok: false, text: str(e && e.message) || 'It failed.' }; }
    };
    let r;
    switch (verb.toLowerCase()) {
      case 'help': case '?': r = { ok: true, lines: HELP }; break;
      case 'clear': case 'cls': clear(); return { ok: true, cleared: true };
      case 'run': case 'open': {
        const route = arg ? routeOf(arg) : '';
        if (arg && !route) { r = { ok: false, text: 'Not a page: ' + arg + ' (flow/page, app/flow/page, or an address starting with /)' }; break; }
        r = await call('run', route);
        break;
      }
      case 'build': r = await call('build', false); break;
      case 'rebuild': r = await call('build', true); break;
      case 'reload': case 'refresh': r = await call('reload'); break;
      case 'devtools': case 'inspect': r = await call('devtools'); break;
      case 'stop': case 'close': r = await call('stop'); break;
      case 'status': case 'whoami': r = await call('status'); break;
      case 'changes': case 'changed': r = await call('changes'); break;
      case 'signin': case 'login': r = await call('signin'); break;
      case 'as': case 'runas': {
        // as → who now; as signin|anonymous|none → back to the EquipRite sign-in; as <user> <ROLE[,ROLE…]>
        if (!rest.length) { r = await call('runAs', null, null); break; }
        if (/^(signin|sign-in|anonymous|none|clear)$/i.test(rest[0])) { r = await call('runAs', '', []); break; }
        const roles = rest.slice(1).join(',').split(',').map((x) => x.trim()).filter(Boolean);
        r = await call('runAs', rest[0], roles);
        break;
      }
      case 'roles': r = await call('roles'); break;
      case 'code': case 'vscode': r = await call('code'); break;
      case 'folder': case 'explorer': r = await call('folder'); break;
      case 'git': {
        const sub = (rest[0] || 'status').toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(GIT, sub)) { r = { ok: false, text: 'git ' + sub + ': only git status, git log, git diff and git branch here (read only).' }; break; }
        r = await call('git', sub, GIT[sub]);
        break;
      }
      default: r = { ok: false, text: 'Not a command: ' + verb + ' — type help.' };
    }
    if (r && r.lines) r.lines.forEach((l) => push(r.ok === false ? 'error' : 'info', l));
    if (r && r.text) push(r.ok === false ? 'error' : 'info', r.text);
    return r || { ok: true };
  }

  return { push: push, lines: lines, clear: clear, command: command };
}

module.exports = { open, routeOf, HELP, GIT, KINDS };
