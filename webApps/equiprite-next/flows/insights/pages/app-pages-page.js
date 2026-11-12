define(['resources/js/pagesClient', 'resources/js/storyAnalysis', 'resources/js/shellBus', 'resources/js/pageMap', 'resources/js/codeFixClient', 'resources/js/codeView'], (PC, SA, bus, PM, FX, CV) => {
  'use strict';

  // Application pages: binding helpers. The facts come from desktop/lib/pageScan.js (via the catalog, resources/pages);
  // the work is the chains. None uses `this` (a binding may call a function detached).
  const APPS = [['all', 'All'], ['vbredwoodapp', 'Old EquipRite'], ['equiprite', 'New EquipRite'], ['equiprite-next', 'EquipRite Next'], ['equiprite-mobile', 'Mobile'], ['equiprite-future', 'Future']];
  const SHORT = { vbredwoodapp: 'OLD', equiprite: 'NEW', 'equiprite-next': 'NEXT', 'equiprite-mobile': 'MOB', 'equiprite-future': 'FUT' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = (at) => { const d = new Date(at); if (isNaN(d.getTime())) return ''; const p2 = (n) => (n < 10 ? '0' : '') + n; return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  let shownKept = { k: '', v: [] };
  const mapKept = { page: { k: '', v: null }, app: { k: '', v: null } };
  const codeKept = { k: '', v: '' };
  // Screenshots for a Code fix request: pasted (Ctrl+V), dropped or picked in its box. The clipboard can only be read
  // during the paste, so this module reads it (one set of listeners, whichever page instance is live) and hands the
  // images to the chain through codeFixClient's queue and the fixImages event.
  let fireImages = null;
  function listenForImages() {
    if (typeof document === 'undefined' || window.__nxFixImages) return;
    window.__nxFixImages = true;
    const inAsk = (t) => !!(t && t.closest && t.closest('#fxAsk'));
    const filesOf = (dt) => {
      if (!dt) return [];
      const fromItems = Array.prototype.filter.call(dt.items || [], (i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile()).filter(Boolean);
      return fromItems.length ? fromItems : Array.prototype.filter.call(dt.files || [], (f) => /^image\//.test(f.type));
    };
    const take = (files) => {
      if (!files.length) return false;
      Promise.all(files.map((f) => FX.prepImage(f))).then((imgs) => { FX.queueImages(imgs.filter(Boolean)); if (fireImages) fireImages(); });
      return true;
    };
    document.addEventListener('paste', (ev) => { if (inAsk(ev.target) && take(filesOf(ev.clipboardData))) ev.preventDefault(); });
    document.addEventListener('dragover', (ev) => { if (inAsk(ev.target)) { ev.preventDefault(); const a = ev.target.closest('#fxAsk'); if (a) a.classList.add('nx-fx-ask--drop'); } });
    document.addEventListener('dragleave', (ev) => { const a = ev.target && ev.target.closest && ev.target.closest('#fxAsk'); if (a && !a.contains(ev.relatedTarget)) a.classList.remove('nx-fx-ask--drop'); });
    document.addEventListener('drop', (ev) => { if (!inAsk(ev.target)) return; ev.preventDefault(); const a = ev.target.closest('#fxAsk'); if (a) a.classList.remove('nx-fx-ask--drop'); take(filesOf(ev.dataTransfer)); });
    document.addEventListener('change', (ev) => { if (ev.target && ev.target.id === 'fxImgFile') { take(Array.prototype.slice.call(ev.target.files || [])); ev.target.value = ''; } });
  }

  class PageModule {
    constructor(context) {
      // a Jira story hands this screen a page to open (bus.focus('app-pages', { id })): the focusRequest event takes it
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('app-pages', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
      fireImages = () => { if (helper) helper.fireCustomEvent('fixImages', {}); };
      listenForImages();
      // the maps' lines follow the boxes: drawn again when the window changes size
      if (typeof window !== 'undefined') { let t = 0; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => PM.redraw(), 120); }); }
    }
    // ── Page code (read only; resources/js/codeView.js) ──
    codeGroups(info) {
      const files = (info && info.files) || [];
      return [['page', 'The page'], ['chain', 'Action chains'], ['module', 'Rules modules it uses']]
        .map((g) => ({ id: g[0], title: g[1], files: files.filter((f) => f.group === g[0]) })).filter((g) => g.files.length);
    }
    codeDoc(text, path, find) {
      const k = path + '|' + find + '|' + (text || '').length + '|' + (text || '').slice(0, 64);
      if (codeKept.k !== k) { codeKept.k = k; codeKept.v = CV.doc(text, path, find); }
      return codeKept.v;
    }
    codeHits(text, find) { const n = CV.hits(text, find); return String(find || '').trim().length < 2 ? '' : (n ? n + ' match' + (n === 1 ? '' : 'es') : 'Not in this file'); }
    codeLines(text) { const n = String(text || '').split('\n').length; return text ? n + ' lines' : ''; }
    codeFileClass(f, sel) { return 'nx-cv-file' + (f.path === sel ? ' nx-cv-file--on' : ''); }
    fixImgUrl(f, n) { return FX.imgUrl(f, n); }
    fixImgSize(x) { return (x.w ? x.w + '×' + x.h + ' · ' : '') + Math.max(1, Math.round((x.size || 0) / 1024)) + ' KB'; }
    // ── Code Fix (desktop/lib/codeFix.js) ──
    fixKinds() { return [{ id: 'fix', label: 'Fix a bug' }, { id: 'enhance', label: 'Enhance' }, { id: 'change', label: 'Change' }]; }
    fixStatus(s) {
      return { proposed: 'Proposed — waiting for your approval', 'needs-redo': 'Not usable as it is (see below): ask again', questions: 'The AI has questions first', applied: 'Applied — not committed yet',
        committed: 'Committed', undone: 'Undone', discarded: 'Discarded', stale: 'Out of date: the code changed' }[s] || s;
    }
    fixStatusClass(s) { return 'nx-fx-st nx-fx-st--' + (s || 'none'); }
    fixFolder(i) { return !i ? '' : (i.branch ? 'branch ' + i.branch + (i.upstream ? ' → ' + i.upstream : ' (not pushed anywhere)') : '') + (i.isDefault ? ' · the project this app runs from' : ''); }
    fixWhen(at) { return when(at); }
    fixMeta(f) { return !f ? '' : (f.provider || 'AI') + (f.model ? ' (' + f.model + ')' : '') + ' · ' + when(f.at) + (f.by ? ' · asked by ' + f.by : '') + (f.ms ? ' · ' + Math.round(f.ms / 1000) + ' s' : '') + (f.retried ? ' · asked twice' : ''); }
    fixSent(f) { return !f || !f.sent ? '' : 'The AI read ' + f.sent.files.length + ' files of this page (' + Math.round(f.sent.chars / 1000) + 'k characters)' + (f.sent.skipped.length ? '; too large to send: ' + f.sent.skipped.join(', ') : '') + '.'; }
    fixStats(f) {
      const d = (f && f.diff) || [];
      return d.length + ' file' + (d.length === 1 ? '' : 's') + ' · +' + d.reduce((n, x) => n + x.added, 0) + ' −' + d.reduce((n, x) => n + x.removed, 0);
    }
    fixLine(t) { return 'nx-fx-l nx-fx-l--' + (t === '+' ? 'add' : t === '-' ? 'del' : 'ctx'); }
    fixSign(t) { return t === ' ' ? '' : (t === '-' ? '−' : t); }
    fixCheck(c) { return c.ok ? '✓' : (c.warn ? '⚠' : (c.already ? '•' : '✗')); }
    fixCheckClass(c) { return 'nx-fx-check ' + (c.ok ? 'nx-fx-check--ok' : (c.warn ? 'nx-fx-check--warn' : (c.already ? 'nx-fx-check--old' : 'nx-fx-check--bad'))); }
    fixCheckText(c) { return c.name + (c.detail ? ': ' + c.detail : '') + (!c.ok && c.already ? ' (already so before the change)' : ''); }
    fixChecksOk(list) { return (list || []).every((c) => c.ok || c.already); }
    fixUnit(u) { return u.ok ? '✓ ' + u.passed + ' passed' : (u.newFailures.length ? '✗ ' + u.newFailures.length + ' new failure' + (u.newFailures.length === 1 ? '' : 's') : '• ' + u.failed + ' failing, as before the fix'); }
    fixUnitClass(u) { return 'nx-fx-check ' + (u.ok ? 'nx-fx-check--ok' : (u.newFailures.length ? 'nx-fx-check--bad' : 'nx-fx-check--old')); }
    fixTestsText(t) {
      if (!t) return '';
      return (t.ok ? '✓ Nothing broke' : '✗ Something broke') + ' — tested ' + when(t.at) + (t.none ? '. No unit test names this page; the checks ran.' : '.');
    }
    fixShot(f, which) { return FX.shotUrl(f, which); }
    fixCanApply(f) { return !!f && !f.shared && (f.status === 'proposed' || f.status === 'undone'); }
    // ── the change history ──
    histShown(list, q) {
      const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
      return (list || []).filter((r) => !words.length || words.every((w) => [r.label, r.page, r.request, r.by, r.approvedBy, r.status, r.commit && r.commit.sha].join(' ').toLowerCase().indexOf(w) !== -1));
    }
    histMeta(r) {
      const parts = ['asked by ' + (r.by || 'someone') + ' · ' + when(r.at)];
      if (r.approvedBy || r.approvedAt) parts.push('approved by ' + (r.approvedBy || 'someone') + ' · ' + when(r.approvedAt) + (r.branch ? ' on ' + r.branch : ''));
      if (r.tests) parts.push(r.tests.ok ? 'tests ✓' : 'tests ✗');
      if (r.commit) parts.push('committed ' + r.commit.sha + (r.commit.pushed ? ', pushed' : ''));
      if (r.undone) parts.push('undone');
      if (r.shared) parts.push('from another PC');
      return parts.join(' · ');
    }
    histCount(list, q, info) {
      const n = (list || []).length;
      const shown = (list || []).filter((r) => !String(q || '').trim() || [r.label, r.page, r.request, r.by, r.approvedBy, r.status, r.commit && r.commit.sha].join(' ').toLowerCase().indexOf(String(q).toLowerCase().trim()) !== -1).length;
      return (shown === n ? n + ' change' + (n === 1 ? '' : 's') : shown + ' of ' + n + ' changes') + (info && info.shared ? ' · shared with everyone on ' + info.branch : ' · on this PC (no data branch)');
    }
    histStatus(st) { return { proposed: 'waiting for approval', applied: 'applied', committed: 'committed', undone: 'undone', discarded: 'discarded', 'needs-redo': 'not usable', questions: 'questions', stale: 'out of date' }[st] || st; }
    stepText(e) { return (e.by ? e.by + ' · ' : '') + when(e.at); }
    fixListText(x) { return (x.status ? ({ proposed: 'proposed', applied: 'applied', committed: 'committed', undone: 'undone', discarded: 'discarded', 'needs-redo': 'not usable', questions: 'questions', stale: 'out of date' }[x.status] || x.status) : '') + ' · ' + when(x.at) + (x.by ? ' · ' + x.by : ''); }
    // ── the navigation maps (resources/js/pageMap.js) ──
    /** One page's map: Comes from → This page → Goes to → Then. */
    pageMap(pages, id, sheet) {
      const via = (sheet && sheet.facts && sheet.facts.next) || [];
      const k = (pages || []).length + '|' + id + '|' + JSON.stringify(via);
      if (mapKept.page.k === k && mapKept.page.pages === pages) return mapKept.page.v;
      const v = PM.pageMap(pages, id, via);
      mapKept.page = { k: k, v: v, pages: pages };
      return v;
    }
    /** The whole app's map (the open page's app), the open page marked. */
    appMap(pages, id) {
      const p = (pages || []).filter((x) => x.id === id)[0];
      const app = p ? p.app : '';
      const k = (pages || []).length + '|' + app + '|' + id;
      if (mapKept.app.k === k && mapKept.app.pages === pages) return mapKept.app.v;
      const v = app ? PM.appMap(pages, app, id) : { cols: [], edges: [], counts: { pages: 0, links: 0, linked: 0, menu: 0 } };
      mapKept.app = { k: k, v: v, pages: pages };
      return v;
    }
    edges(map) { return JSON.stringify((map && map.edges) || []); }
    mapLinks(map) { const c = map && map.cols ? map.cols : []; const n = (i) => (c[i] ? c[i].nodes.length : 0); return n(0) + n(2); }
    nodeClass(n, selId) { return 'nx-pm-node nx-pm-node--' + n.kind + (n.id && n.id === selId && n.kind !== 'self' ? ' nx-pm-node--sel' : ''); }
    nodeTitle(n) { return n.kind === 'menu' ? 'In the menu: ' + n.sub : n.kind === 'self' ? 'The page open now' : 'Open ' + n.label + ' (' + n.sub + ')'; }
    appMapText(m, appName) {
      const c = (m && m.counts) || { pages: 0, links: 0, linked: 0, menu: 0 };
      return (appName || 'This app') + ': ' + c.pages + ' pages · ' + c.menu + ' in the menu · ' + c.links + ' links between pages · ' + (c.pages - c.linked) + ' with no link either way';
    }
    subText(pages) {
      const ps = pages || [];
      const deleted = ps.filter((p) => p.deleted).length;
      const sheets = ps.filter((p) => p.sheet).length;
      const stories = [];
      ps.forEach((p) => (p.stories || []).forEach((k) => { if (stories.indexOf(k) === -1) stories.push(k); }));
      return (ps.length - deleted) + ' pages in the code · ' + sheets + ' with a technical sheet · ' + stories.length + ' Jira stories mapped' + (deleted ? ' · ' + deleted + ' deleted' : '');
    }
    gitText(g) {
      if (!g || !g.available) return '';
      const where = g.branch + (g.upstream ? ' → ' + g.upstream : ' (not pushed anywhere yet)');
      if (g.pending && g.pending.length) return 'Branch ' + where + ' · ' + g.pending.length + ' file' + (g.pending.length === 1 ? '' : 's') + ' not committed';
      if (g.unpushed && g.unpushed.length) return 'Branch ' + where + ' · ' + g.unpushed.length + ' commit' + (g.unpushed.length === 1 ? '' : 's') + ' not pushed';
      return 'Branch ' + where + ' · everything is in git ✓';
    }
    needsPush(g) { return !!(g && g.available && ((g.pending && g.pending.length) || (g.unpushed && g.unpushed.length))); }
    appChips(pages, showDeleted) {
      const ps = (pages || []).filter((p) => showDeleted || !p.deleted);
      return APPS.map((a) => ({ id: a[0], label: a[1], n: a[0] === 'all' ? ps.length : ps.filter((p) => p.app === a[0]).length })).filter((c) => c.id === 'all' || c.n > 0);
    }
    shown(pages, q, appF, onlyMapped, onlySheet, showDeleted) {
      const k = JSON.stringify([(pages || []).length, (pages || []).map((p) => (p.stories || []).length + (p.sheet ? 's' + (p.sheet.screenshots || 0) : '') + (p.deleted ? 'd' : '')).join(''), q, appF, onlyMapped, onlySheet, showDeleted]);
      if (shownKept.k === k && shownKept.pages === pages) return shownKept.v;
      const s = String(q || '').trim().toLowerCase();
      const v = (pages || []).filter((p) => (showDeleted || !p.deleted) && (appF === 'all' || !appF || p.app === appF) && (!onlyMapped || (p.stories || []).length) && (!onlySheet || p.sheet)
        && (!s || [p.label, p.id, p.appName, (p.stories || []).join(' ')].join(' ').toLowerCase().indexOf(s) !== -1));
      shownKept = { k: k, v: v, pages: pages };
      return v;
    }
    /** How many screenshots a page has (a catalog entry from before several were kept may have one, as `screenshot`). */
    shotCount(p) { const sh = p && p.sheet; return !sh ? 0 : (typeof sh.screenshots === 'number' ? sh.screenshots : (sh.screenshot ? 1 : 0)); }
    /** The screenshots, each with its index (the button's data-key) and its number. */
    indexed(list) { return (list || []).map((x, i) => Object.assign({ i: String(i), n: String(i + 1) }, x)); }
    shotAt(sheet, i) { const l = (sheet && sheet.screenshots) || []; const k = Number(i); return k >= 0 && k < l.length ? l[k] : null; }
    shot(base, s) { return PC.shotUrl(base, s); }
    shotText(s) { return s ? (s.caption ? s.caption + ' · ' : '') + (s.source === 'capture' ? 'Captured' : 'Uploaded') + ' ' + when(s.at) + (s.by ? ' by ' + s.by : '') : ''; }
    appShort(app) { return SHORT[app] || 'VB'; }
    firstStories(list) { const l = list || []; return l.length > 4 ? l.slice(0, 4).concat(['+' + (l.length - 4)]) : l; }
    stateText(sh, saved) {
      if (!sh) return '';
      if (!saved) return 'No technical sheet saved yet — these facts are read from the code now.';
      return 'Sheet built ' + when(sh.at) + (sh.by ? ' by ' + sh.by : '') + ' · code ' + sh.codeHash;
    }
    routeText(r) { return r ? (r.menu ? 'Menu: ' + r.menu + ' · ' : '') + (r.url ? 'Opens at ' + r.url : '') : ''; }
    aiText(ai) { return ai ? 'Explained by ' + (ai.provider || 'AI') + ' · ' + when(ai.at) + (ai.by ? ' by ' + ai.by : '') : ''; }
    usesText(c) {
      return [c.calls.length ? 'calls ' + c.calls.join(', ') : '', c.reports.length ? 'reports ' + c.reports.join(', ') : '', c.opens.length ? 'opens ' + c.opens.join(', ') : ''].filter(Boolean).join(' · ');
    }
    method(m) { const k = String(m || '').toLowerCase(); return /^(get|post|patch|put|delete)$/.test(k) ? k : 'other'; }
    /** The AI explanation in a small styled document for its sandboxed iframe. */
    doc(text) {
      return '<!doctype html><meta charset="utf-8"><style>'
        + 'body{font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#161513;margin:0;padding:14px}'
        + 'h2,h3,h4{color:#00688c;margin:16px 0 6px;font-size:15px;font-weight:700}h3:first-child{margin-top:0}'
        + 'ul,ol{margin:0 0 12px;padding-left:20px}li{margin-bottom:5px}p{margin:0 0 10px}code{background:#eef2f4;padding:1px 5px;border-radius:4px;font-size:12px}'
        + '</style>' + SA.renderHtml(text || '');
    }
  }
  return PageModule;
});
