'use strict';
/**
 * The Application pages catalog: every Visual Builder page in the project, each with a technical sheet — its screenshot,
 * features, business logic, integrations and links (lib/pageScan.js reads them from the page's own files), an
 * AI-written explanation — and the Jira stories mapped to it. Kept in git, so everyone (and the app in VBCS) has the same
 * sheets and mappings. A page mapped to a second story keeps its sheet: only the story number is added.
 *
 * In the project (all in git, shipped with EquipRite Next so its pages can read them anywhere):
 *   webApps/equiprite-next/resources/pages/catalog.json        { scannedAt, pages: [{ id, app, appName, flow, page, label,
 *                                                               route, stories: [KEY], sheet: { at, by, codeHash,
 *                                                               screenshot, ai } | null }] }
 *   webApps/equiprite-next/resources/pages/sheets/<file>.json  the sheet: { id, facts, ai, screenshot, stories, at, by, codeHash }
 *   webApps/equiprite-next/resources/pages/screens/<file>.<n>.jpg  its screenshots (several)
 *
 *   open({ root, git, gitPath, now, capture, mirror }) → store
 *     catalog()                       the catalog, with any page added to the code since (a fresh scan)
 *     rescan()                        writes that catalog (every page, labels as the code has them now)
 *     sheet(id)                       { ok, sheet, codeChanged } (the saved sheet, or the facts read now when there is none)
 *     build(id, { by })               reads the facts again and saves the sheet (keeping its screenshot, AI text, stories)
 *     assign(id, key, { by })         maps a Jira story to the page (building the sheet first when it has none) → { ok, sheet, built }
 *     unassign(id, key)               → { ok }
 *     forStory(key)                   [{ id, label, appName, sheet }] the pages a story is mapped to
 *     saveShot(id, { base64, mime, source, caption, by })   adds a screenshot (a page keeps several) → { ok, file, shot }
 *     removeShot(id, shotId)          → { ok }
 *     remove(id) / restore(id)        deletes a page from the catalog (its sheet, screenshots, mappings; hidden from the
 *                                     lists) / brings it back
 *     capture(id, { by })             opens the page in the desktop app (o.capture) and saves what it shows → { ok, file }
 *     saveAi(id, { text, provider, by })            → { ok }
 *     gitStatus() / gitSave({ message, push })      only these files, to the branch the project is on (lib/gitPaths.js)
 *     setMirror(dir | fn)             also write into the running app's build copy (and copy the project's there now)
 */
const fs = require('fs');
const path = require('path');
const scan = require('./pageScan');
const gitPaths = require('./gitPaths');

const RES = 'webApps/equiprite-next/resources/pages';
function str(v) { return v == null ? '' : String(v); }
const fileOf = (id) => str(id).split('/').map((x) => x || '_root').join('.');
const keyOf = (k) => { const s = str(k).trim().toUpperCase(); return /^[A-Z][A-Z0-9]*-\d+$/.test(s) ? s : ''; };

function open(opts) {
  const o = opts || {};
  const root = path.resolve(o.root || path.join(__dirname, '..', '..'));
  const resDir = path.join(root, RES);
  const now = o.now || (() => new Date());
  let mirror = o.mirror || '';
  const repo = gitPaths.create({ root: root, paths: [RES], git: o.git, gitPath: o.gitPath, message: 'Application pages: update' });

  const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return dflt; } };
  const mirrorDir = () => { try { return typeof mirror === 'function' ? mirror() : mirror; } catch (e) { return ''; } };
  function write(relPath, data) {
    const abs = path.join(resDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
    const m = mirrorDir();
    if (m) { try { const mm = path.join(m, relPath); fs.mkdirSync(path.dirname(mm), { recursive: true }); fs.writeFileSync(mm, data); } catch (e) { /* the next build catches up */ } }
  }
  function removeFile(relPath) { [resDir, mirrorDir()].filter(Boolean).forEach((d) => { try { fs.unlinkSync(path.join(d, relPath)); } catch (e) { /* gone */ } }); }
  function sync() {
    const m = mirrorDir();
    if (!m || !fs.existsSync(resDir)) return;
    const copy = (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      fs.readdirSync(from).forEach((f) => {
        const a = path.join(from, f), b = path.join(to, f);
        if (fs.statSync(a).isDirectory()) copy(a, b); else fs.copyFileSync(a, b);
      });
    };
    try { copy(resDir, m); } catch (e) { /* the next build catches up */ }
  }

  const saved = () => readJson(path.join(resDir, 'catalog.json'), { pages: [] });
  const sheetFile = (id) => 'sheets/' + fileOf(id) + '.json';
  const readSheet = (id) => readJson(path.join(resDir, sheetFile(id)), null);

  /** The catalog: every page the code has now, with what was saved for it (stories, sheet); pages gone from the code
   *  but still mapped to stories stay, marked missing. */
  function catalog() {
    const old = {};
    (saved().pages || []).forEach((p) => { old[p.id] = p; });
    const live = scan.list(root);
    const pages = live.map((p) => Object.assign({}, p, { stories: (old[p.id] && old[p.id].stories) || [], sheet: (old[p.id] && old[p.id].sheet) || null,
      deleted: !!(old[p.id] && old[p.id].deleted) }));
    Object.keys(old).forEach((id) => { if (!pages.some((p) => p.id === id) && (old[id].stories || []).length) pages.push(Object.assign({}, old[id], { missing: true })); });
    return { scannedAt: now().toISOString(), pages: pages };
  }
  function writeCatalog(cat) {
    const slim = { scannedAt: cat.scannedAt, pages: cat.pages.map((p) => ({ id: p.id, app: p.app, appName: p.appName, flow: p.flow, page: p.page, label: p.label,
      route: p.route, stories: p.stories || [], sheet: p.sheet || null, missing: p.missing || undefined, deleted: p.deleted || undefined })) };
    write('catalog.json', JSON.stringify(slim, null, 1) + '\n');
  }
  /** The sheet's screenshots (a sheet from before several were kept had one, as `screenshot`). */
  function shotsOf(sh) {
    if (Array.isArray(sh.screenshots)) return sh.screenshots;
    sh.screenshots = sh.screenshot && sh.screenshot.file ? [Object.assign({ id: 's1' }, sh.screenshot)] : [];
    delete sh.screenshot;
    return sh.screenshots;
  }
  function summaryOf(sh) {
    const shots = shotsOf(sh);
    return { at: sh.at, by: sh.by || '', codeHash: sh.codeHash, screenshots: shots.length, ai: !!(sh.ai && sh.ai.text),
      rest: (sh.facts && sh.facts.integrations.rest.length) || 0, chains: (sh.facts && sh.facts.logic.chains.length) || 0 };
  }
  function saveSheet(sh) {
    write(sheetFile(sh.id), JSON.stringify(sh, null, 1) + '\n');
    const cat = catalog();
    cat.pages.forEach((p) => { if (p.id === sh.id) { p.stories = sh.stories || []; p.sheet = summaryOf(sh); } });
    writeCatalog(cat);
  }

  function sheet(id) {
    const sh = readSheet(id);
    if (sh) {
      const facts = scan.analyze(root, id);
      shotsOf(sh);
      return { ok: true, sheet: sh, codeChanged: !!(facts && facts.codeHash !== sh.codeHash), saved: true };
    }
    const facts = scan.analyze(root, id);
    if (!facts) return { ok: false, error: 'There is no page "' + id + '" in the project.' };
    const entry = (saved().pages || []).filter((p) => p.id === id)[0];
    return { ok: true, sheet: { id: id, facts: facts, ai: null, screenshots: [], stories: (entry && entry.stories) || [], at: '', by: '', codeHash: facts.codeHash }, codeChanged: false, saved: false, deleted: !!(entry && entry.deleted) };
  }

  function build(id, b) {
    const facts = scan.analyze(root, id);
    if (!facts) return { ok: false, error: 'There is no page "' + id + '" in the project.' };
    const old = readSheet(id) || {};
    const entry = (saved().pages || []).filter((p) => p.id === id)[0];
    const sh = { id: id, facts: facts, ai: old.ai || null, screenshots: old.id ? shotsOf(old) : [],
      stories: old.stories || (entry && entry.stories) || [], at: now().toISOString(), by: str((b && b.by) || ''), codeHash: facts.codeHash };
    if (entry && entry.deleted) restore(id);
    saveSheet(sh);
    return { ok: true, sheet: sh };
  }

  function assign(id, key, b) {
    const k = keyOf(key);
    if (!k) return { ok: false, error: 'Give a Jira story key, like EQP-12.' };
    let sh = readSheet(id);
    let built = false;
    if (!sh) { const r = build(id, b); if (!r.ok) return r; sh = r.sheet; built = true; }
    if (sh.stories.indexOf(k) === -1) sh.stories = sh.stories.concat([k]).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    saveSheet(sh);
    return { ok: true, sheet: sh, built: built };
  }

  function unassign(id, key) {
    const k = keyOf(key);
    const sh = readSheet(id);
    if (!sh || !k) return { ok: false, error: 'Nothing to unmap.' };
    sh.stories = sh.stories.filter((x) => x !== k);
    saveSheet(sh);
    return { ok: true, sheet: sh };
  }

  function forStory(key) {
    const k = keyOf(key);
    return (saved().pages || []).filter((p) => (p.stories || []).indexOf(k) !== -1).map((p) => ({ id: p.id, label: p.label, appName: p.appName, sheet: p.sheet }));
  }

  function saveShot(id, b) {
    b = b || {};
    let sh = readSheet(id);
    if (!sh) { const r = build(id, b); if (!r.ok) return r; sh = r.sheet; }
    const buf = Buffer.from(str(b.base64).replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length) return { ok: false, error: 'There is no image.' };
    if (buf.length > 8 * 1024 * 1024) return { ok: false, error: 'The image is larger than 8 MB.' };
    const shots = shotsOf(sh);
    if (shots.length >= 30) return { ok: false, error: 'A page keeps up to 30 screenshots: delete one first.' };
    const ext = /png/i.test(str(b.mime)) ? '.png' : /webp/i.test(str(b.mime)) ? '.webp' : '.jpg';
    let n = shots.length + 1;
    while (shots.some((x) => x.id === 's' + n)) n++;
    const file = 'screens/' + fileOf(id) + '.' + n + ext;
    write(file, buf);
    const shot = { id: 's' + n, file: file, at: now().toISOString(), by: str(b.by), source: b.source === 'capture' ? 'capture' : 'upload',
      caption: str(b.caption).slice(0, 120), bytes: buf.length };
    shots.push(shot);
    saveSheet(sh);
    return { ok: true, file: file, shot: shot, sheet: sh };
  }

  function removeShot(id, shotId) {
    const sh = readSheet(id);
    if (!sh) return { ok: false, error: 'This page has no sheet.' };
    const shots = shotsOf(sh);
    const s1 = shots.filter((x) => x.id === shotId)[0];
    if (!s1) return { ok: false, error: 'There is no such screenshot.' };
    removeFile(s1.file);
    sh.screenshots = shots.filter((x) => x.id !== shotId);
    saveSheet(sh);
    return { ok: true, sheet: sh };
  }

  /** Deletes a page from the catalog: its sheet, screenshots and story mappings go, and it is hidden from the lists
   *  (the code still has it: restore brings it back, without a sheet). */
  function remove(id) {
    const entry = (saved().pages || []).filter((p) => p.id === id)[0];
    const live = scan.list(root).some((p) => p.id === id);
    if (!entry && !live) return { ok: false, error: 'There is no page "' + id + '".' };
    const sh = readSheet(id);
    if (sh) { shotsOf(sh).forEach((x) => removeFile(x.file)); removeFile(sheetFile(id)); }
    const cat = catalog();
    cat.pages = cat.pages.filter((p) => !(p.id === id && p.missing));
    cat.pages.forEach((p) => { if (p.id === id) { p.stories = []; p.sheet = null; p.deleted = true; } });
    writeCatalog(cat);
    return { ok: true, removed: { stories: (entry && entry.stories) || [], screenshots: sh ? shotsOf(sh).length : 0 } };
  }
  function restore(id) {
    const cat = catalog();
    let found = false;
    cat.pages.forEach((p) => { if (p.id === id) { p.deleted = false; found = true; } });
    if (!found) return { ok: false, error: 'There is no page "' + id + '".' };
    writeCatalog(cat);
    return { ok: true };
  }

  async function capture(id, b) {
    if (typeof o.capture !== 'function') return { ok: false, error: 'Capturing works in the EquipRite desktop app. Upload a screenshot instead.' };
    const facts = scan.analyze(root, id);
    if (!facts) return { ok: false, error: 'There is no page "' + id + '" in the project.' };
    if (!facts.route.url) return { ok: false, error: facts.route.needs || 'This page has no address of its own: upload a screenshot.' };
    const shot = await o.capture(facts.app, facts.route.url);
    if (!shot || !shot.ok) return { ok: false, error: (shot && shot.error) || 'The page could not be captured.' };
    return saveShot(id, { base64: shot.base64, mime: shot.mime, source: 'capture', by: b && b.by });
  }

  function saveAi(id, b) {
    b = b || {};
    let sh = readSheet(id);
    if (!sh) { const r = build(id, b); if (!r.ok) return r; sh = r.sheet; }
    if (!str(b.text).trim()) return { ok: false, error: 'There is no text to save.' };
    sh.ai = { text: str(b.text).slice(0, 200000), provider: str(b.provider).slice(0, 120), at: now().toISOString(), by: str(b.by), codeHash: sh.codeHash };
    saveSheet(sh);
    return { ok: true, sheet: sh };
  }

  /** Writes the catalog as the code is now (new pages listed, labels current): what the Rescan button does. */
  function rescan() { const cat = catalog(); writeCatalog(cat); return { ok: true, pages: cat.pages.length }; }

  return {
    remove: remove, restore: restore, removeShot: removeShot,
    catalog: catalog, rescan: rescan, sheet: sheet, build: build, assign: assign, unassign: unassign, forStory: forStory,
    saveShot: saveShot, capture: capture, saveAi: saveAi, canCapture: () => typeof o.capture === 'function',
    canWrite: () => { try { return fs.statSync(path.join(root, 'webApps', 'equiprite-next')).isDirectory(); } catch (e) { return false; } },
    gitStatus: () => repo.status(), gitSave: (b) => repo.save(b),
    setMirror: (dir) => { mirror = dir || ''; sync(); },
    RES: RES, root: root,
  };
}

module.exports = { open, fileOf, RES };
