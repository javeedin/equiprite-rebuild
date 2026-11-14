#!/usr/bin/env node
'use strict';
/**
 * Setting your workspace up, its progress (desktop/lib/vbs.js parseProgress, workProgress, workCancel): git's own progress
 * (clone --progress) read line by line as git writes it — its phase, percentage, counts, size, speed — and each step's state
 * (connect, download, check, unpack into main, make working); with real git through the store's own runner (a process,
 * its stderr streamed); Cancel stops it and keeps nothing.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const V = require('../desktop/lib/vbs');

const T = H.makeAsserter();
const HOST = 'acme-dev1-demo-phx.developer.ocp.oraclecloud.com';
const ORG = 'acme-dev1-demo-phx';
const PID = 'rebuild-app_100010';
const URL = 'https://' + HOST + '/' + ORG + '/s/' + ORG + '_' + PID + '/scm/App.git';

(async () => {
  T.section('git\'s progress lines');
  const P = V.parseProgress;
  T.check('VB Studio getting it ready (remote: counting, compressing): connect', P('remote: Counting objects:  45% (556/1234)').phase === 'connect' && P('remote: Counting objects:  45% (556/1234)').pct === 45 && P('remote: Enumerating objects: 1234, done.').pct === 100);
  const rcv = P('Receiving objects:  62% (765/1234), 48.30 MiB | 2.10 MiB/s');
  T.check('Receiving objects: download — its percentage, counts, size, speed', rcv.phase === 'download' && rcv.pct === 62 && rcv.done === 765 && rcv.total === 1234 && rcv.size === '48.30 MiB' && rcv.speed === '2.10 MiB/s', JSON.stringify(rcv));
  T.check('Resolving deltas: check; Updating files: unpack (into main); anything else: none', P('Resolving deltas:  30% (300/1000)').phase === 'check' && P('Updating files:  60% (600/1000)').phase === 'unpack' && P('Cloning into \'main\'...') === null && P('') === null);

  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-vbs-prog-'));
  const keepEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
  try {
    // VB Studio's repository stood in for by a local one, reached over git's own protocol (file://, so it sends a pack and
    // says how it goes) — VB Studio's address rewritten to it by git's config; the store runs git itself (no stand-in)
    const bare = path.join(tmp, 'App.git');
    const src = path.join(tmp, 'src');
    const g = (cwd, args) => execFileSync('git', args, { cwd: cwd, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x' }) }).toString();
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare]);
    execFileSync('git', ['init', '-q', '-b', 'dev-one', src]);
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(src, 'file' + i + '.txt'), 'line ' + i + '\n'.repeat(50));
    g(src, ['add', '.']); g(src, ['commit', '-q', '-m', 'first']);
    g(src, ['push', '-q', bare, 'dev-one']);
    const cfg = path.join(tmp, 'gitconfig');
    fs.writeFileSync(cfg, '[url "file://' + bare + '"]\n\tinsteadOf = ' + URL + '\n[protocol "file"]\n\tallow = always\n');
    process.env.GIT_CONFIG_GLOBAL = cfg;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    const enc = (t) => Buffer.from('enc:' + t);
    const dec = (b) => b.toString().slice(4);
    const st = V.open({ file: path.join(tmp, 'data', 'vbs.json'), encrypt: enc, decrypt: dec, gitPath: 'git', fetch: async () => ({ ok: false, status: 404, text: async () => '' }) });
    st.saveOrg({ name: 'Rite demo', url: 'https://' + HOST + '/' + ORG + '/', user: 'demo.user', password: 'S3cret!#' });
    const WS = { orgKey: HOST + '/' + ORG, project: PID, projectName: 'Rebuild_App', workspace: 'Dev_One', repo: 'App', branch: 'dev-one', folder: path.join(tmp, 'Projects') };

    T.section('real git: the progress read as it goes');
    T.check('nothing being set up: said so', st.workProgress().active === false && !st.workCancel().ok);
    const seen = [];
    const watch = setInterval(() => { const p = st.workProgress(); if (p.active) seen.push(p); }, 5);
    const u = await st.workUse(WS);
    clearInterval(watch);
    const done = st.workProgress();
    T.check('set up (git run by the store itself, its stderr streamed)', u.ok && u.set && fs.existsSync(path.join(WS.folder, 'rebuild-app-dev_one', 'working', 'file1.txt')), u.error || '');
    T.check('…while it ran: active, with a phase, a percentage, each step\'s state', seen.length > 0 && seen.every((p) => p.active && typeof p.overall === 'number' && p.steps.length === 5) && seen.some((p) => p.steps[0].state === 'active' || p.steps[0].state === 'done'), String(seen.length));
    T.check('…at the end: done, 100%, every step done, how long it took', done.done && !done.active && done.overall === 100 && done.steps.every((s) => s.state === 'done') && done.elapsedMs >= 0 && done.lines > 0, JSON.stringify(done).slice(0, 300));
    T.check('…git\'s own lines read (Receiving objects: the download, its counts)', done.phase === 'working' && done.lines >= 1, String(done.lines));

    T.section('Cancel: git stopped, nothing kept');
    let release = null;
    const st2 = V.open({ file: path.join(tmp, 'd2', 'vbs.json'), encrypt: enc, decrypt: dec, fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
      git: (args, auth, onLine) => new Promise((resolve) => {
        if (args[0] !== 'clone') { resolve({ code: 0, stdout: '', stderr: '' }); return; }
        fs.mkdirSync(path.join(args[args.length - 1], '.git'), { recursive: true });
        onLine('remote: Counting objects:  50% (50/100)');
        onLine('Receiving objects:  40% (400/1000), 12.00 MiB | 1.50 MiB/s');
        release = () => resolve({ code: 128, stdout: '', stderr: 'killed' });
      }) });
    st2.saveOrg({ name: 'Rite demo', url: 'https://' + HOST + '/' + ORG + '/', user: 'demo.user', password: 'S3cret!#' });
    const W2 = Object.assign({}, WS, { folder: path.join(tmp, 'Other') });
    const running = st2.workUse(W2);
    await new Promise((r) => setTimeout(r, 20));
    const mid = st2.workProgress();
    T.check('while it downloads: Download the code active (40%, its counts, size, speed); overall between', mid.active && mid.phase === 'download' && mid.pct === 40 && mid.count === '400 / 1000' && mid.size === '12.00 MiB' && mid.speed === '1.50 MiB/s'
      && mid.overall > 10 && mid.overall < 75 && mid.steps.map((s) => s.state).join() === 'done,active,todo,todo,todo', JSON.stringify(mid).slice(0, 300));
    T.check('…another set-up meanwhile: refused (one at a time)', /being set up already/.test((await st2.workUse(W2)).error));
    const c = st2.workCancel();
    T.check('Cancel: said (stopping)', c.ok && c.cancelled);
    release();
    const r = await running;
    T.check('…stopped: cancelled, nothing kept (its folder removed), no workspace set', !r.ok && r.cancelled && /Cancelled: nothing was kept/.test(r.error) && !fs.existsSync(path.join(W2.folder, 'rebuild-app-dev_one')) && st2.work().current === null && !st2.workProgress().active, JSON.stringify(r));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    Object.keys(keepEnv).forEach((k) => { if (keepEnv[k] === undefined) delete process.env[k]; else process.env[k] = keepEnv[k]; });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
