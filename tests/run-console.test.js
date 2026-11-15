#!/usr/bin/env node
'use strict';
/**
 * The Run console (desktop/lib/runConsole.js): what happens when your workspace runs, and commands to drive it — none run
 * as a program:
 *   - the lines: kinds kept (an unknown one is info), several lines in one split, the build tool's blank lines left out,
 *     read after the last one seen, the oldest dropped past the limit (counted)
 *   - a page to run: flow/page, app/flow/page or an address — anything else refused (no way out of the app's addresses)
 *   - each command handed to the desktop app's own doing; git only as status, log, diff, branch (read only); an unknown
 *     command, a missing doing, one that fails: said; help; clear empties it; what is typed is shown first
 */
const H = require('./_harness');
const RC = require('../desktop/lib/runConsole');

const T = H.makeAsserter();

(async () => {
  try {
    T.section('the lines');
    let clock = Date.parse('2026-11-15T09:00:00Z');
    const c = RC.open({ max: 10, now: () => new Date(clock += 1000) });
    c.push('build', 'Running "vb-process-local" task\n\n  done');
    c.push('server', 'GET /eqp/v1/requests -> 200 (120 ms)');
    c.push('weird', 'what kind?');
    const all = c.lines(0);
    T.check('kinds kept (an unknown one is info); several lines split; the build tool\'s blank lines left out; each numbered and timed', all.lines.length === 4 && all.lines.map((l) => l.kind).join() === 'build,build,server,info'
      && all.lines[1].text === '  done' && all.lines.every((l, i) => l.seq === i + 1 && /^2026-11-15T09:00:0\dZ$/.test(l.at.replace(/\.\d+Z$/, 'Z'))) && all.last === 4, JSON.stringify(all.lines));
    T.check('read after the last one seen: only the new ones', c.lines(3).lines.length === 1 && c.lines(3).lines[0].kind === 'info' && c.lines(4).lines.length === 0 && c.lines(4).last === 4);
    for (let i = 0; i < 12; i++) c.push('app', 'line ' + i);
    const kept = c.lines(0);
    T.check('past the limit: the oldest dropped (counted), the numbering goes on', kept.lines.length === 10 && kept.dropped === 6 && kept.lines[9].text === 'line 11' && kept.last === 16);

    T.section('a page to run');
    T.check('flow/page, app/flow/page, an address: its address', RC.routeOf('equipment-foundation/equipment-create') === '/vp/shell/equipment-foundation/equipment-create'
      && RC.routeOf('vbredwoodapp/equipment-foundation/equipment-detail') === '/vp/shell/equipment-foundation/equipment-detail' && RC.routeOf('/vp/shell/main/main-equiprite?x=1') === '/vp/shell/main/main-equiprite?x=1');
    T.check('…anything else refused (no way out of the app\'s addresses)', ['../../etc/passwd', 'a/b/c/d', 'flow page', '/vp/shell/a b', 'javascript:alert(1)', 'http://evil.example/x', 'a;rm -rf'].every((x) => RC.routeOf(x) === ''));

    T.section('the commands');
    const did = [];
    const does = {
      run: async (route) => { did.push('run ' + route); return { ok: true, text: '▶ opened ' + (route || '/') }; },
      build: async (force) => { did.push('build ' + force); return { ok: true, text: force ? 'rebuilt' : 'up to date' }; },
      reload: async () => { did.push('reload'); return { ok: true, text: 'reloaded' }; },
      devtools: async () => { did.push('devtools'); return { ok: false, text: 'No app window: type run first.' }; },
      git: async (sub, args) => { did.push('git ' + sub + ' ' + JSON.stringify(args)); return { ok: true, lines: ['## buildrite-working', ' M webApps/x.html'] }; },
      status: async () => { throw new Error('the desktop app had a problem'); },
    };
    const k = RC.open();
    const h = await k.command('help', does);
    T.check('help: the commands listed (in the log too); what was typed shown first', h.ok && h.lines.length > 10 && k.lines(0).lines[0].kind === 'cmd' && k.lines(0).lines[0].text === '> help' && /run <page>/.test(k.lines(0).lines.map((l) => l.text).join('\n')));
    await k.command('run', does);
    await k.command('run equipment-foundation/equipment-create', does);
    await k.command('open /vp/shell/main/main-equiprite', does);
    const bad = await k.command('run ../../secret', does);
    T.check('run: from the start page, or straight on a page (flow/page, an address); a page that is not one: refused, nothing run', did.slice(0, 3).join(' | ') === 'run  | run /vp/shell/equipment-foundation/equipment-create | run /vp/shell/main/main-equiprite'
      && !bad.ok && /Not a page/.test(bad.text) && did.length === 3, did.join(' | '));
    await k.command('build', does); await k.command('rebuild', does); await k.command('reload', does);
    const dt = await k.command('devtools', does);
    T.check('build, rebuild (from scratch), reload; a doing that says no: said in red', did.slice(3).join(' | ') === 'build false | build true | reload | devtools' && !dt.ok && k.lines(0).lines.some((l) => l.kind === 'error' && /type run first/.test(l.text)), did.join(' | '));
    await k.command('git status', does); await k.command('git log', does); await k.command('git diff', does);
    const push = await k.command('git push --force', does);
    const reset = await k.command('git reset --hard', does);
    T.check('git: status, log, diff (its own stat, against VB Studio) — read only; push, reset… refused, never run', did.filter((d) => /^git /.test(d)).join(' | ') === 'git status ["status","--short","--branch"] | git log ["log","--oneline","--decorate","-20"] | git diff null'
      && !push.ok && /only git status, git log, git diff and git branch/.test(push.text) && !reset.ok && !did.some((d) => /push|reset/.test(d)), did.join(' | '));
    T.check('…its answer\'s lines in the log', k.lines(0).lines.some((l) => l.text === ' M webApps/x.html' && l.kind === 'info'));
    const st = await k.command('status', does);
    const nope = await k.command('signin', does);
    const what = await k.command('rm -rf /', does);
    T.check('a doing that fails, one not here (it needs the desktop app), a command that is not one: each said, nothing run', !st.ok && /the desktop app had a problem/.test(st.text) && !nope.ok && /needs the desktop app/.test(nope.text)
      && !what.ok && /Not a command: rm — type help/.test(what.text) && !did.some((d) => /rm/.test(d)));
    const cl = await k.command('clear', does);
    T.check('clear: the log emptied (the numbering goes on)', cl.cleared && k.lines(0).lines.length === 0 && k.lines(0).last > 0);
    T.check('nothing typed: nothing done', (await k.command('   ', does)).ok && k.lines(0).lines.length === 0);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  }
  T.report();
})();
