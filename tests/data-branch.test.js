#!/usr/bin/env node
'use strict';
/**
 * The app's data on its own git branch (desktop/lib/dataBranch.js, lib/gitPaths.js sync): with real git, a bare
 * "origin" and two people's project folders.
 *   - the first start makes the branch (data only, no code) and pushes it; the code folder is never committed to
 *   - the Application pages and the FDD library write there, commit and push there
 *   - a second person's first start: the branch from the remote, and data an older app saved in their project folder
 *     (not pushed) moved onto it
 *   - both change the same page at once: merged (stories of both), the catalog rebuilt, the FDD library of both, pushed;
 *     the build copy refreshed with what came
 *   - a start again; a folder in the way; not a git repository
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const DB = require('../desktop/lib/dataBranch');
const P = require('../desktop/lib/pages');
const F = require('../desktop/lib/fdd');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const ID = 'vbredwoodapp/equipment-foundation/equipment-workbench';
const SHEET = 'webApps/equiprite-next/resources/pages/sheets/' + P.fileOf(ID) + '.json';
const CAT = 'webApps/equiprite-next/resources/pages/catalog.json';
const LIB = 'webApps/equiprite-next/resources/fdd/library.json';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (base, rel, text) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); };
const read = (base, rel) => { try { return fs.readFileSync(path.join(base, rel), 'utf8'); } catch (e) { return null; } };
const json = (base, rel) => { try { return JSON.parse(read(base, rel)); } catch (e) { return null; } };
const onRemote = (remote, rel) => { try { return git(remote, 'show', DB.DEFAULT_BRANCH + ':' + rel); } catch (e) { return null; } };
const ident = (cwd) => { git(cwd, 'config', 'user.name', 'Tester'); git(cwd, 'config', 'user.email', 'tester@example.com'); };

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-data-'));
  const remote = path.join(tmp, 'origin.git');
  const A = path.join(tmp, 'a'), B = path.join(tmp, 'b');
  try {
    // the code repository, as on the code branch today: code, and the data an older app saved there
    git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    fs.mkdirSync(A);
    git(A, 'init', '-q', '-b', 'main'); ident(A);
    put(A, '.gitignore', '/.equiprite-data/\n');
    put(A, 'code.js', 'console.log("code");\n');
    put(A, 'webApps/equiprite-next/index.html', '<!doctype html>\n');
    put(A, 'docs/fdd/README.md', '# FDD (code doc)\n');
    put(A, CAT, JSON.stringify({ scannedAt: '2026-11-01T00:00:00.000Z', pages: [{ id: ID, app: 'vbredwoodapp', label: 'Equipment Manager Workbench', stories: [], sheet: null }] }, null, 1) + '\n');
    put(A, LIB, JSON.stringify({ latest: '', docs: [] }, null, 2) + '\n');
    git(A, 'add', '-A'); git(A, 'commit', '-q', '-m', 'code'); git(A, 'remote', 'add', 'origin', remote); git(A, 'push', '-q', '-u', 'origin', 'main');
    const codeHead = git(A, 'rev-parse', 'HEAD');

    T.section('the first start: the data branch made, data only, pushed');
    const logs = [];
    const dA = await DB.open({ root: A, log: (l) => logs.push(l) }).ensure();
    T.check('ok: its own worktree in .equiprite-data, on ' + DB.DEFAULT_BRANCH, dA.ok && dA.created && dA.dir === path.join(A, '.equiprite-data') && git(dA.dir, 'rev-parse', '--abbrev-ref', 'HEAD') === DB.DEFAULT_BRANCH, JSON.stringify(dA.info()) + ' ' + logs.join(' | '));
    T.check('the data copied, a README, no code (and not the code\'s own docs)', !!json(dA.dir, CAT) && !!json(dA.dir, LIB) && /EquipRite data/.test(read(dA.dir, 'README.md') || '')
      && read(dA.dir, 'code.js') === null && read(dA.dir, 'docs/fdd/README.md') === null, JSON.stringify([!!json(dA.dir, CAT), !!json(dA.dir, LIB), read(dA.dir, 'README.md') && read(dA.dir, 'README.md').slice(0, 20), read(dA.dir, 'code.js'), read(dA.dir, 'docs/fdd/README.md'), fs.readdirSync(dA.dir)]));
    T.check('a branch with no history of the code, pushed to origin', !!onRemote(remote, CAT) && git(remote, 'rev-list', '--count', DB.DEFAULT_BRANCH) === '1'
      && (() => { try { git(remote, 'merge-base', 'main', DB.DEFAULT_BRANCH); return false; } catch (e) { return true; } })() && git(dA.dir, 'rev-parse', '--abbrev-ref', '@{u}') === 'origin/' + DB.DEFAULT_BRANCH);
    T.check('the code folder untouched: same commit, nothing to commit', git(A, 'rev-parse', 'HEAD') === codeHead && git(A, 'status', '--porcelain') === '');
    T.eq('info: separate, the branch, the folder', JSON.stringify([dA.info().separate, dA.info().branch, dA.info().dir]), JSON.stringify([true, DB.DEFAULT_BRANCH, '.equiprite-data']));

    T.section('the Application pages and the FDD library write, commit and push on the data branch');
    let clock = Date.parse('2026-11-12T10:00:00Z');
    const pA = P.open({ root: ROOT, data: dA, now: () => new Date(clock += 60000) });
    T.check('the store reads the code from the project, keeps its data on the branch', pA.root === ROOT && pA.dataRoot === dA.dir && pA.dataInfo().separate);
    const r1 = pA.assign(ID, 'EQP-1', { by: 'Asha' });
    const s1 = await pA.gitSave({ message: 'Application pages: map EQP-1' });
    T.check('mapped, committed and pushed to the data branch', r1.ok && s1.ok && s1.pushed && s1.upstream === 'origin/' + DB.DEFAULT_BRANCH && /EQP-1/.test(onRemote(remote, SHEET) || ''), JSON.stringify(s1));
    T.check('…the code folder still untouched (the old place not written)', git(A, 'rev-parse', 'HEAD') === codeHead && git(A, 'status', '--porcelain') === '' && read(A, SHEET) === null);
    const fA = F.open({ root: A, data: dA, now: () => new Date(clock += 60000) });
    const up1 = await fA.upload({ fileName: 'rental.md', base64: Buffer.from('# Rental\n\n## 1 Scope\n\nRentals of equipment.\n').toString('base64'), name: 'Rental FDD' });
    const s2 = await fA.gitSave({ message: 'FDD library: Rental FDD' });
    T.check('an FDD uploaded: on the data branch (document and outline), pushed', up1.ok && s2.ok && s2.pushed && /rental-fdd/.test(onRemote(remote, LIB) || '') && !!onRemote(remote, 'docs/fdd/' + up1.doc.id + '.md'), JSON.stringify([up1.error, s2.error]));

    T.section('a second person\'s first start: the branch from origin, their unpushed data moved onto it');
    git(tmp, 'clone', '-q', remote, B); ident(B);
    // what an older app saved in B's project folder (committed on the code branch, never pushed)
    put(B, 'webApps/equiprite-next/resources/pages/sheets/vbredwoodapp._root.shell.json', JSON.stringify({ id: 'vbredwoodapp//shell', stories: ['EQP-9'], at: '2026-11-12T09:00:00.000Z', screenshots: [] }, null, 1) + '\n');
    put(B, LIB, JSON.stringify({ latest: 'old-fdd', docs: [{ id: 'old-fdd', name: 'Old FDD', uploadedAt: '2026-11-11T09:00:00.000Z' }] }, null, 2) + '\n');
    git(B, 'add', '-A'); git(B, 'commit', '-q', '-m', 'sheets saved by an older app');
    const dB = await DB.open({ root: B }).ensure();
    T.check('ok: the branch checked out from origin (tracking it), with what A pushed', dB.ok && dB.created && git(dB.dir, 'rev-parse', '--abbrev-ref', '@{u}') === 'origin/' + DB.DEFAULT_BRANCH && /EQP-1/.test(read(dB.dir, SHEET) || ''));
    const libB = json(dB.dir, LIB) || { docs: [] };
    T.check('their unpushed data moved onto it: the missing sheet copied, the library merged (both FDDs)', dB.moved === 2 && !!json(dB.dir, 'webApps/equiprite-next/resources/pages/sheets/vbredwoodapp._root.shell.json')
      && libB.docs.map((d) => d.id).sort().join() === ['old-fdd', up1.doc.id].sort().join(), 'moved ' + dB.moved + ' ' + JSON.stringify(libB.docs.map((d) => d.id)));
    T.check('…and pushed', /old-fdd/.test(onRemote(remote, LIB) || '') && !!onRemote(remote, 'webApps/equiprite-next/resources/pages/sheets/vbredwoodapp._root.shell.json'));

    T.section('both change the same page at once: merged, nothing lost, pushed');
    const mirror = path.join(tmp, 'build-copy');
    pA.setMirror(mirror);
    const pB = P.open({ root: ROOT, data: dB, now: () => new Date(clock += 60000) });
    pB.assign(ID, 'EQP-3', { by: 'Ben' });
    const sB = await pB.gitSave({ message: 'Application pages: map EQP-3' });
    pA.assign(ID, 'EQP-2', { by: 'Asha' });
    const sA = await pA.gitSave({ message: 'Application pages: map EQP-2' });
    const merged = json(dA.dir, SHEET) || {};
    T.check('B pushed first; A\'s push merged B in and went through', sB.ok && sB.pushed && sA.ok && sA.pushed && sA.merged, JSON.stringify([sB.error, sA.error, sA.merged]));
    T.check('the sheet: the stories of both', JSON.stringify(merged.stories) === JSON.stringify(['EQP-1', 'EQP-2', 'EQP-3']), JSON.stringify(merged.stories));
    const cat = json(dA.dir, CAT) || { pages: [] };
    const cp = cat.pages.filter((p) => p.id === ID)[0] || {};
    T.check('the catalog rebuilt from the merged sheet (and the shell page B brought)', JSON.stringify(cp.stories) === JSON.stringify(['EQP-1', 'EQP-2', 'EQP-3']) && !!cp.sheet && cat.pages.length >= 1, JSON.stringify(cp.stories));
    T.check('…pushed: origin has the merge', JSON.stringify((JSON.parse(onRemote(remote, SHEET) || '{}')).stories) === JSON.stringify(['EQP-1', 'EQP-2', 'EQP-3']) && /Merge origin\//.test(git(remote, 'log', '-3', '--format=%s', DB.DEFAULT_BRANCH)));
    await pA.synced(); // refreshed in the background
    T.check('the build copy refreshed with what came (EQP-3 from B)', /EQP-3/.test(read(mirror, 'sheets/' + P.fileOf(ID) + '.json') || ''));
    const fB = F.open({ root: B, data: dB, now: () => new Date(clock += 60000) });
    await fB.gitPull();
    const up2 = await fB.upload({ fileName: 'billing.md', base64: Buffer.from('# Billing\n\n## 1 Invoices\n\nMonthly.\n').toString('base64'), name: 'Billing FDD' });
    const sFB = await fB.gitSave({ message: 'FDD library: Billing FDD' });
    const up3 = await fA.upload({ fileName: 'yard.md', base64: Buffer.from('# Yard\n\n## 1 Gate\n\nIn and out.\n').toString('base64'), name: 'Yard FDD' });
    const sFA = await fA.gitSave({ message: 'FDD library: Yard FDD' });
    const libR = JSON.parse(onRemote(remote, LIB) || '{"docs":[]}');
    T.check('two FDDs uploaded at once: the library has both (and the earlier ones)', up2.ok && up3.ok && sFB.pushed && sFA.pushed
      && [up1.doc.id, up2.doc.id, up3.doc.id, 'old-fdd'].every((id) => libR.docs.some((d) => d.id === id)), JSON.stringify([sFA.error, libR.docs.map((d) => d.id)]));

    T.section('a start again, a folder in the way, not a git repository');
    const dA2 = await DB.open({ root: A }).ensure();
    T.check('a start again: the same worktree, what others pushed merged in', dA2.ok && !dA2.created && (json(dA2.dir, LIB) || { docs: [] }).docs.some((d) => d.id === up2.doc.id));
    fs.mkdirSync(path.join(A, 'plain'));
    const dX = await DB.open({ root: A, dir: path.join(A, 'plain') }).ensure();
    T.check('a folder that is not the data branch: not used, said why (the stores keep the project folder)', !dX.ok && /is not the data branch/.test(dX.reason) && P.open({ root: ROOT, data: dX }).dataRoot === ROOT, dX.reason);
    const plain = path.join(tmp, 'not-git');
    fs.mkdirSync(plain);
    const dN = await DB.open({ root: plain }).ensure();
    T.check('not a git repository: said so', !dN.ok && /not a git repository/.test(dN.reason), dN.reason);
    T.check('through all of it, nothing committed to the code branch', git(A, 'rev-parse', 'HEAD') === codeHead && git(remote, 'rev-parse', 'main') === codeHead);

    T.section('the merges, by what the file is');
    const ms = JSON.parse(P.mergeSheet(JSON.stringify({ at: '2026-11-12T10:00:00Z', stories: ['EQP-1'], ai: { text: 'old', at: '1' }, screenshots: [{ file: 'a.jpg', at: '1' }] }),
      JSON.stringify({ at: '2026-11-12T11:00:00Z', stories: ['EQP-2'], ai: { text: 'new', at: '2' }, screenshot: { file: 'b.jpg', at: '2' } })));
    T.check('a sheet: the newer build, stories and screenshots of both, the newer AI text', ms.at === '2026-11-12T11:00:00Z' && ms.stories.join() === 'EQP-1,EQP-2' && ms.ai.text === 'new' && ms.screenshots.map((s) => s.file).join() === 'a.jpg,b.jpg' && !ms.screenshot);
    const mc = JSON.parse(P.mergeCatalog(JSON.stringify({ pages: [{ id: 'x', stories: ['EQP-1'] }, { id: 'y', deleted: true, stories: [] }] }), JSON.stringify({ pages: [{ id: 'x', stories: ['EQP-2'] }, { id: 'z', stories: [] }] }), () => null));
    T.check('the catalog: every page of either, stories of both, a deletion kept', mc.pages.map((p) => p.id).join() === 'x,y,z' && mc.pages[0].stories.join() === 'EQP-1,EQP-2' && mc.pages[1].deleted === true);
    const ml = JSON.parse(F.mergeLibrary(JSON.stringify({ latest: 'b', docs: [{ id: 'b', uploadedAt: '2' }] }), JSON.stringify({ latest: 'a', docs: [{ id: 'a', uploadedAt: '1' }] })));
    T.check('the FDD library: the documents of both, ours "latest"', ml.docs.map((d) => d.id).join() === 'b,a' && ml.latest === 'b');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
