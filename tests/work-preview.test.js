#!/usr/bin/env node
'use strict';
/**
 * Your workspace running in Build.Rite (desktop/lib/workPreview.js): what Capture screenshot and Run it open, so they show
 * your working folder's code — not Build.Rite's own copy of the app:
 *   - built beside the working folder (build-rite-preview), never inside it (git there sees nothing new); served
 *   - the code unchanged: not built again, the same server; changed: built again, the server started again (a new
 *     version folder)
 *   - two asks at once: one build; a failed build said, and tried again next time
 *   - an app not in the build, a folder that is not a VB app: said; only its own build folder is ever emptied
 *   - for real, with the app's build tool (the second build too: the tool will not empty a folder outside its own)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const WP = require('../desktop/lib/workPreview');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const files = (dir) => { const out = []; const walk = (d, rel) => fs.readdirSync(d).forEach((n) => { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p, rel + n + '/'); else out.push(rel + n + ':' + fs.statSync(p).size); }); walk(dir, ''); return out.sort().join('\n'); };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-wprev-'));
  try {
    // a workspace's working folder (as the set-up wizard makes it): visual-application.json and one small app
    const base = path.join(tmp, 'BuildRite', 'rebuild-app-dev-one');
    const working = path.join(base, 'working');
    fs.mkdirSync(path.join(working, 'webApps'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'visual-application.json'), path.join(working, 'visual-application.json'));
    fs.cpSync(path.join(ROOT, 'webApps', 'equiprite-mobile'), path.join(working, 'webApps', 'equiprite-mobile'), { recursive: true });
    const before = files(working);

    T.section('built beside the working folder, served');
    const builds = [], served = [], closed = [];
    let failNext = false;
    const store = WP.open({
      build: async (src, target) => {
        builds.push([src, target]);
        await new Promise((r) => setTimeout(r, 30));
        if (failNext) { failNext = false; return { ok: false, error: 'Running "vb-process-local" failed: a broken file' }; }
        const v = path.join(target, 'processed', 'webApps', 'equiprite-mobile');
        fs.mkdirSync(v, { recursive: true });
        fs.writeFileSync(path.join(v, 'index.html'), '<html>build ' + builds.length + '</html>');
        return { ok: true, ms: 30 };
      },
      serve: async (s) => { served.push(s); const n = served.length; return { url: 'http://127.0.0.1:4' + n + '00/', close: () => closed.push(n) }; },
    });
    const out = WP.outOf(working);
    const r1 = await store.ensure({ folder: working, out: out, app: 'equiprite-mobile' });
    T.check('the build folder: build-rite-preview beside working (not inside it); built and served', r1.ok && r1.built && out === path.join(base, 'build-rite-preview') && builds.length === 1 && builds[0][0] === path.resolve(working)
      && builds[0][1] === out && served.length === 1 && served[0].buildDir === out && served[0].webApp === 'equiprite-mobile' && r1.url === 'http://127.0.0.1:4100' && !!r1.builtAt, JSON.stringify(r1));
    T.check('…the working folder: nothing new in it (git there sees no change)', files(working) === before);

    T.section('built again only when the code changed');
    const r2 = await store.ensure({ folder: working, out: out, app: 'equiprite-mobile' });
    T.check('unchanged: not built again, the same server', r2.ok && !r2.built && builds.length === 1 && served.length === 1 && r2.url === r1.url && store.status(working).fresh);
    const page = path.join(working, 'webApps', 'equiprite-mobile', 'index.html');
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8') + '\n<!-- a change in the working folder -->\n');
    T.check('…changed: it says so (not fresh)', !store.status(working).fresh && store.status(working).built);
    const r3 = await store.ensure({ folder: working, out: out, app: 'equiprite-mobile' });
    T.check('…built again; the old server closed, a new one started (a new version folder)', r3.ok && r3.built && builds.length === 2 && closed.join() === '1' && served.length === 2 && r3.url === 'http://127.0.0.1:4200');

    T.section('two asks at once; a failed build');
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8') + '<!-- another -->\n');
    const both = await Promise.all([store.ensure({ folder: working, out: out, app: 'equiprite-mobile' }), store.ensure({ folder: working, out: out, app: 'equiprite-mobile' })]);
    T.check('two at once: one build, both answered with the same server', both[0].ok && both[1].ok && builds.length === 3 && both[0].built && !both[1].built && both[0].url === both[1].url);
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8') + '<!-- broken -->\n');
    failNext = true;
    const bad = await store.ensure({ folder: working, out: out, app: 'equiprite-mobile' });
    T.check('a failed build: said, with the build tool\'s words', !bad.ok && /Your workspace could not be built: .*a broken file/.test(bad.error), bad.error);
    const again = await store.ensure({ folder: working, out: out, app: 'equiprite-mobile' });
    T.check('…tried again next time (and built)', again.ok && again.built && builds.length === 5);

    T.section('what is said, what is never touched');
    const noApp = await store.ensure({ folder: working, out: out, app: 'vbredwoodapp' });
    T.check('an app not in the build: said', !noApp.ok && /no app "vbredwoodapp"/.test(noApp.error), noApp.error);
    const notVb = await store.ensure({ folder: path.join(tmp, 'BuildRite'), app: 'equiprite-mobile' });
    T.check('a folder that is not a VB app (no visual-application.json): said', !notVb.ok && /no visual-application\.json/.test(notVb.error));
    const precious = path.join(base, 'my-own-folder');
    fs.mkdirSync(precious); fs.writeFileSync(path.join(precious, 'keep.txt'), 'mine');
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8') + '<!-- once more -->\n');
    const wrongOut = await store.ensure({ folder: working, out: precious, app: 'equiprite-mobile' });
    T.check('only its own build folder (build-rite-preview) is ever emptied: another folder is refused, kept', !wrongOut.ok && /Not a preview folder/.test(wrongOut.error) && fs.readFileSync(path.join(precious, 'keep.txt'), 'utf8') === 'mine', wrongOut.error);
    store.stop();
    T.check('stopped: its servers closed', closed.length === served.length, closed.join() + ' / ' + served.length);

    T.section('for real: the app\'s build tool, built twice');
    if (!fs.existsSync(path.join(ROOT, 'node_modules', 'grunt', 'bin', 'grunt'))) T.check('the build tool is installed (skipping)', true);
    else {
      const real = WP.open({ buildTool: ROOT, serve: async () => ({ url: 'http://127.0.0.1:4900', close: () => {} }) });
      const realOut = path.join(base, 'build-rite-preview');
      fs.rmSync(realOut, { recursive: true, force: true });
      const b1 = await real.ensure({ folder: working, out: realOut, app: 'equiprite-mobile' });
      const v1 = fs.existsSync(path.join(realOut, 'processed', 'webApps', 'equiprite-mobile')) ? fs.readdirSync(path.join(realOut, 'processed', 'webApps', 'equiprite-mobile')).filter((n) => /^version_/.test(n)) : [];
      T.check('built: the app\'s index and a version folder in build-rite-preview; the working folder unchanged by it', b1.ok && b1.built && v1.length === 1 && fs.existsSync(path.join(realOut, 'processed', 'webApps', 'equiprite-mobile', 'index.html'))
        && !fs.existsSync(path.join(working, 'build')) && !fs.existsSync(path.join(working, 'processed')), JSON.stringify(b1));
      fs.writeFileSync(page, fs.readFileSync(page, 'utf8') + '<!-- for real -->\n');
      const b2 = await real.ensure({ folder: working, out: realOut, app: 'equiprite-mobile' });
      // the change, somewhere in the new build (its files read)
      const has = (dir) => fs.readdirSync(dir).some((n) => { const q = path.join(dir, n); return fs.statSync(q).isDirectory() ? has(q) : /for real/.test(fs.readFileSync(q, 'utf8')); });
      T.check('…built again after a change (its build folder emptied first — the tool would not): the change is in the build', b2.ok && b2.built && has(path.join(realOut, 'processed', 'webApps', 'equiprite-mobile')), JSON.stringify(b2));
    }
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
