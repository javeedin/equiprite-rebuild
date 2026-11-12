/*
 * Application pages: the page code analyzer (desktop/lib/pageScan.js) on the project's own pages, the catalog kept in
 * git (desktop/lib/pages.js: sheets, mapped Jira stories, screenshots, AI text, commit + push of only its files), and
 * the words the AI is given (resources/js/pageSheet.js, storyAnalysis.js with mapped pages).
 *
 * The analyzer reads the real webApps/; the catalog works on a throwaway copy that is a git repository with a bare origin.
 *
 * Run:  node tests/app-pages.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const S = require('../desktop/lib/pageScan');
const P = require('../desktop/lib/pages');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
function load(file) {
  let out;
  const sb = { console, define: (d, f) => { out = f(); } };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'webApps', 'equiprite-next', 'resources', 'js', file), 'utf8'), sb, { filename: file });
  return out;
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

T.section('every page of every app');
const all = S.list(ROOT);
const byApp = {};
all.forEach((p) => { byApp[p.app] = (byApp[p.app] || 0) + 1; });
T.check('all five apps, each page once, ids "<app>/<flow>/<page>"', ['vbredwoodapp', 'equiprite', 'equiprite-next', 'equiprite-mobile', 'equiprite-future'].every((a) => byApp[a] > 0)
  && new Set(all.map((p) => p.id)).size === all.length && all.every((p) => /^[a-z-]+\/[a-z0-9-]*\/[a-z0-9-]+$/.test(p.id)), JSON.stringify(byApp));
const nx = all.filter((p) => p.id === 'equiprite-next/insights/app-pages')[0];
T.check('a Next page takes its menu name, and opens with ?open=', nx && nx.label === 'Application pages' && nx.route.url === '/?open=app-pages' && /Insights › Application pages/.test(nx.route.menu), JSON.stringify(nx));
const old = all.filter((p) => p.id === 'vbredwoodapp/equipment-foundation/equipment-workbench')[0];
T.check('an Old EquipRite page takes its page title, and opens at /vp/shell/<flow>/<page>', old && old.label === 'Equipment Manager Workbench' && old.route.url === '/vp/shell/equipment-foundation/equipment-workbench');
const rec = all.filter((p) => p.id === 'equiprite-next/insights/jira-analysis')[0];
T.check('a screen opened from another (a record) says how to get its screenshot', rec && rec.route.url === '' && /record "jira-analysis"/.test(rec.route.needs));

T.section('one page\'s facts, from its files');
const wb = S.analyze(ROOT, 'vbredwoodapp/equipment-foundation/equipment-workbench');
T.check('features: its title, table columns, what reacts (row picked, tab changed, filter), when it runs', wb.features.sections[0] === 'Equipment Manager Workbench'
  && wb.features.columns.indexOf('Request #') !== -1 && wb.features.actions.some((a) => /first selected row changed/.test(a.label) && a.chains.indexOf('RowClickChain') !== -1)
  && wb.features.lifecycle.some((l) => l.when === 'when the page opens' && l.chains.indexOf('WorkbenchInitChain') !== -1));
T.check('business logic: each chain with what its own comment says, and what it calls', wb.logic.chains.length >= 3 && wb.logic.chains.every((c) => typeof c.about === 'string')
  && wb.logic.chains.some((c) => c.name === 'WorkbenchInitChain' && c.calls.indexOf('eqp-v1/getEquipriteV1ViewsWorkbenchRequests') !== -1));
const call = wb.integrations.rest.filter((r) => r.endpoint === 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests')[0];
T.check('integrations: the endpoint → GET and its path → EquipRite REST (eqpt), used by its chain', call && call.method === 'GET' && call.path === '/equiprite/v1/views/workbench-requests'
  && call.backend === 'eqpt' && call.backendLabel === 'EquipRite REST (eqpt)' && call.usedBy.indexOf('WorkbenchInitChain') !== -1, JSON.stringify(call));
T.check('links: the screen it opens; files and a code hash', wb.links.indexOf('page request-detail') !== -1 && wb.files.length >= 4 && /^[0-9a-f]{16}$/.test(wb.codeHash));
const an = S.analyze(ROOT, 'equiprite-next/insights/jira-analysis');
T.check('a Next page: rules modules (two levels deep) and the desktop services they use; buttons by the words they show', an.logic.modules.some((m) => m.name === 'storyAnalysisRun')
  && an.logic.modules.some((m) => m.name === 'analysisStore') && an.integrations.local.some((l) => l.route === '/__ai/') && an.integrations.local.some((l) => l.route === '/__fdd/')
  && an.features.actions.some((a) => /Re-run analysis/.test(a.label)));
const bipPage = all.map((p) => S.analyze(ROOT, p.id)).filter((f) => f.integrations.reports.length)[0];
T.check('BI Publisher reports are named (…_RP)', !!bipPage && bipPage.integrations.reports.every((r) => /_RP$|^[A-Z0-9_]+$/.test(r)) && bipPage.integrations.backends.indexOf('Oracle BI Publisher (SOAP)') !== -1);
let unresolved = 0;
all.forEach((p) => { unresolved += S.analyze(ROOT, p.id).integrations.rest.filter((r) => !r.method).length; });
T.eq('every REST endpoint any page calls is in services/', unresolved, 0);
T.eq('a header comment', S.headerComment("// Opens the drawer.\n// Then reads it.\n\nconst x = 1;"), 'Opens the drawer. Then reads it.');
T.eq('the analyzer reads, never writes: an unknown page is null', S.analyze(ROOT, 'nope/x/y'), null);

T.section('the catalog in git: map a story (the sheet built once), reuse it for another, unmap');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-pages-'));
const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-pages-remote-'));
fs.cpSync(path.join(ROOT, 'webApps'), path.join(tmp, 'webApps'), { recursive: true, filter: (src) => { try { return fs.statSync(src).isDirectory() || /\.(json|html|js)$/.test(src); } catch (e) { return false; } } });
fs.cpSync(path.join(ROOT, 'services'), path.join(tmp, 'services'), { recursive: true });
let clock = Date.parse('2026-11-12T10:00:00Z');
let haveGit = true;
try { git(tmp, '--version'); } catch (e) { haveGit = false; }
if (haveGit) {
  git(remote, 'init', '--bare', '-q');
  git(tmp, 'init', '-q', '-b', 'pages/test'); git(tmp, 'config', 'user.email', 't@example.com'); git(tmp, 'config', 'user.name', 'T'); git(tmp, 'config', 'commit.gpgsign', 'false');
  git(tmp, 'add', '-A'); git(tmp, 'commit', '-q', '-m', 'start'); git(tmp, 'remote', 'add', 'origin', remote); git(tmp, 'push', '-q', '-u', 'origin', 'pages/test');
}
const shots = [];
const store = P.open({ root: tmp, now: () => new Date(clock += 60000), capture: async (app, url) => { shots.push(app + ' ' + url); return { ok: true, base64: Buffer.from('jpegbytes').toString('base64'), mime: 'image/jpeg' }; } });
const ID = 'vbredwoodapp/equipment-foundation/equipment-workbench';
(async () => {
  T.check('the catalog lists every page, none mapped yet', store.catalog().pages.length === all.length && store.catalog().pages.every((p) => !(p.stories || []).length));
  const before = store.sheet(ID);
  T.check('before a sheet is built: the facts read now, not saved', before.ok && !before.saved && before.sheet.facts.integrations.rest.length > 0);
  const a1 = store.assign(ID, 'eqp-93', { by: 'javeed' });
  T.check('mapping the first story builds and saves the sheet', a1.ok && a1.built === true && a1.sheet.stories.join() === 'EQP-93' && a1.sheet.by === 'javeed'
    && fs.existsSync(path.join(tmp, P.RES, 'sheets', P.fileOf(ID) + '.json')));
  const builtAt = a1.sheet.at;
  const a2 = store.assign(ID, 'EQP-285', { by: 'someone' });
  T.check('a second story reuses the sheet: only its number is added (not rebuilt)', a2.ok && a2.built === false && a2.sheet.at === builtAt && a2.sheet.stories.join() === 'EQP-93,EQP-285');
  T.check('the same story twice is kept once; a key that is not a key is refused', store.assign(ID, 'EQP-93').sheet.stories.length === 2 && !store.assign(ID, 'nonsense').ok);
  const cat = JSON.parse(fs.readFileSync(path.join(tmp, P.RES, 'catalog.json'), 'utf8'));
  const entry = cat.pages.filter((p) => p.id === ID)[0];
  T.check('the page table (catalog.json) holds the story numbers and the sheet\'s summary', entry.stories.join() === 'EQP-93,EQP-285' && entry.sheet && entry.sheet.rest >= 1 && entry.sheet.chains >= 3);
  T.check('a story\'s pages', store.forStory('eqp-285').map((p) => p.id).join() === ID && store.forStory('EQP-1').length === 0);
  const cap = await store.capture(ID, { by: 'javeed' });
  T.check('a screenshot captured at the page\'s address, saved beside the sheet', cap.ok && shots[0] === 'vbredwoodapp /vp/shell/equipment-foundation/equipment-workbench'
    && fs.existsSync(path.join(tmp, P.RES, cap.file)) && store.sheet(ID).sheet.screenshots[0].source === 'capture');
  const recap = await store.capture('equiprite-next/insights/jira-analysis', {});
  T.check('a screen with no address of its own: not captured, says to upload', !recap.ok && /upload/i.test(recap.error));
  const up = store.saveShot(ID, { base64: Buffer.from('png').toString('base64'), mime: 'image/png', by: 'j', caption: 'Filters open' });
  const up2 = store.saveShot(ID, { base64: Buffer.from('jpg2').toString('base64'), mime: 'image/jpeg', by: 'j' });
  const list = store.sheet(ID).sheet.screenshots;
  T.check('several screenshots: an upload is added (the capture kept), each its own file and caption', up.ok && up2.ok && list.length === 3 && list.map((x) => x.id).join() === 's1,s2,s3'
    && list[1].caption === 'Filters open' && list[1].file.endsWith('.2.png') && list.every((x) => fs.existsSync(path.join(tmp, P.RES, x.file))));
  T.check('the page table counts them', JSON.parse(fs.readFileSync(path.join(tmp, P.RES, 'catalog.json'), 'utf8')).pages.filter((x) => x.id === ID)[0].sheet.screenshots === 3);
  const delShot = store.removeShot(ID, 's2');
  T.check('one deleted: its file gone, the others kept', delShot.ok && store.sheet(ID).sheet.screenshots.map((x) => x.id).join() === 's1,s3' && !fs.existsSync(path.join(tmp, P.RES, up.file)) && !store.removeShot(ID, 's9').ok);
  const s4 = store.saveShot(ID, { base64: Buffer.from('x').toString('base64'), mime: 'image/jpeg' });
  T.check('a new one after a delete gets a new number (a number never names two images)', s4.ok && s4.shot.id === 's4' && store.sheet(ID).sheet.screenshots.map((x) => x.id).join() === 's1,s3,s4');
  T.check('the AI explanation is kept with the sheet', store.saveAi(ID, { text: '## What this page is for\n- the workbench', provider: 'Claude', by: 'j' }).ok && store.sheet(ID).sheet.ai.provider === 'Claude');
  const rb = store.build(ID, { by: 'j' });
  T.check('refreshing the sheet keeps its stories, screenshots and AI text', rb.ok && rb.sheet.stories.length === 2 && rb.sheet.screenshots.length === 3 && rb.sheet.ai && rb.sheet.at > builtAt);
  T.check('unmapping a story', store.unassign(ID, 'EQP-285').ok && store.sheet(ID).sheet.stories.join() === 'EQP-93');
  // the code changes: the sheet says so
  const chain = path.join(tmp, 'webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-workbench-page-chains/RowClickChain.js');
  fs.appendFileSync(chain, '\n// changed\n');
  T.check('when the page\'s code changes, its sheet says so', store.sheet(ID).codeChanged === true);
  T.check('rescan writes every page into the catalog', store.rescan().pages === all.length);
  // a sheet saved before several screenshots were kept had one, as "screenshot": read as the first of a list
  const OLDID = 'vbredwoodapp/main/rate-schedule';
  store.build(OLDID, {});
  const oldFile = path.join(tmp, P.RES, 'sheets', P.fileOf(OLDID) + '.json');
  const oj = JSON.parse(fs.readFileSync(oldFile, 'utf8')); delete oj.screenshots; oj.screenshot = { file: 'screens/old.jpg', at: '2026-11-01T00:00:00Z', source: 'upload' };
  fs.writeFileSync(oldFile, JSON.stringify(oj));
  T.check('an older sheet\'s single screenshot reads as a list of one', store.sheet(OLDID).sheet.screenshots.length === 1 && store.sheet(OLDID).sheet.screenshots[0].id === 's1');

  T.section('delete a page from the catalog, and restore it');
  store.assign(OLDID, 'EQP-7', {});
  const del = store.remove(OLDID);
  const cat2 = JSON.parse(fs.readFileSync(path.join(tmp, P.RES, 'catalog.json'), 'utf8')).pages.filter((x) => x.id === OLDID)[0];
  T.check('deleted: its sheet and screenshots gone, its stories unmapped, marked deleted (the code still has it)', del.ok && del.removed.stories.join() === 'EQP-7'
    && !fs.existsSync(oldFile) && cat2.deleted === true && cat2.stories.length === 0 && cat2.sheet === null && store.forStory('EQP-7').length === 0);
  T.check('…and stays deleted after a rescan', store.rescan() && JSON.parse(fs.readFileSync(path.join(tmp, P.RES, 'catalog.json'), 'utf8')).pages.filter((x) => x.id === OLDID)[0].deleted === true);
  T.check('opening it says it was deleted', store.sheet(OLDID).deleted === true && store.sheet(OLDID).saved === false);
  T.check('restored: back in the lists', store.restore(OLDID).ok && !JSON.parse(fs.readFileSync(path.join(tmp, P.RES, 'catalog.json'), 'utf8')).pages.filter((x) => x.id === OLDID)[0].deleted);
  store.remove(OLDID);
  T.check('mapping a story to a deleted page brings it back, with a new sheet', store.assign(OLDID, 'EQP-8', {}).built === true
    && !JSON.parse(fs.readFileSync(path.join(tmp, P.RES, 'catalog.json'), 'utf8')).pages.filter((x) => x.id === OLDID)[0].deleted);
  T.check('an unknown page cannot be deleted', !store.remove('nope/x/y').ok);

  if (haveGit) {
    fs.writeFileSync(path.join(tmp, 'other.txt'), 'staged'); git(tmp, 'add', 'other.txt');
    const g = await store.gitSave({ message: 'Application pages: map EQP-93' });
    const files = git(tmp, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean);
    T.check('git: only resources/pages is committed, then pushed; other staged work stays staged', g.ok && g.pushed && files.length > 0 && files.every((f) => f.indexOf(P.RES + '/') === 0)
      && git(tmp, 'diff', '--cached', '--name-only') === 'other.txt' && git(remote, 'log', '-1', '--format=%s', 'pages/test') === 'Application pages: map EQP-93', files.join(','));
  } else T.check('git is installed (skipping the git checks)', true);

  T.section('what the AI is given');
  const PS = load('pageSheet.js');
  const SA = load('storyAnalysis.js');
  const sh = store.sheet(ID).sheet;
  const pr = PS.prompt(sh.facts);
  T.check('"explain this page": its five headings, only the facts', ['What this page is for', 'How people use it', 'Business logic', 'Integrations', 'Things to watch'].every((h) => pr.system.indexOf('## ' + h) !== -1)
    && /ONLY on the facts/.test(pr.system) && /PAGE Equipment Manager Workbench \(Old EquipRite/.test(pr.user) && /GET \/equiprite\/v1\/views\/workbench-requests — EquipRite REST \(eqpt\)/.test(pr.user));
  const mt = PS.storyPagesText([sh]);
  T.check('a story\'s mapped pages: the essentials and the saved AI explanation', /PAGE Equipment Manager Workbench/.test(mt) && /WorkbenchInitChain/.test(mt) && /What the page does \(AI explanation/.test(mt) && /the workbench/.test(mt));
  const sp = SA.prompt({ key: 'EQP-93', summary: 'Workbench filters' }, [], '', mt);
  T.check('the story\'s analysis carries them, and is told to name chains and endpoints', /EQUIPRITE PAGES MAPPED TO THIS/.test(sp.user) && /name the chains and endpoints/.test(sp.system));
  T.check('…and without mapped pages, nothing changes', SA.prompt({ key: 'EQP-1', summary: 'x' }, [], '').system === SA.SYSTEM);
  T.check('a set too', /EQUIPRITE PAGES MAPPED TO THIS/.test(SA.promptSet([{ key: 'EQP-1' }, { key: 'EQP-2' }], [], '', mt).user));

  [tmp, remote].forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tmp */ } });
  T.report();
})().catch((e) => { console.error(e); process.exit(1); });
