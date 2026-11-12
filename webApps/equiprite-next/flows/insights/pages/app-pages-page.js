define(['resources/js/pagesClient', 'resources/js/storyAnalysis', 'resources/js/shellBus'], (PC, SA, bus) => {
  'use strict';

  // Application pages: binding helpers. The facts come from desktop/lib/pageScan.js (via the catalog, resources/pages);
  // the work is the chains. None uses `this` (a binding may call a function detached).
  const APPS = [['all', 'All'], ['vbredwoodapp', 'Old EquipRite'], ['equiprite', 'New EquipRite'], ['equiprite-next', 'EquipRite Next'], ['equiprite-mobile', 'Mobile'], ['equiprite-future', 'Future']];
  const SHORT = { vbredwoodapp: 'OLD', equiprite: 'NEW', 'equiprite-next': 'NEXT', 'equiprite-mobile': 'MOB', 'equiprite-future': 'FUT' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = (at) => { const d = new Date(at); if (isNaN(d.getTime())) return ''; const p2 = (n) => (n < 10 ? '0' : '') + n; return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  let shownKept = { k: '', v: [] };

  class PageModule {
    constructor(context) {
      // a Jira story hands this screen a page to open (bus.focus('app-pages', { id })): the focusRequest event takes it
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('app-pages', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
    }
    subText(pages) {
      const ps = pages || [];
      const sheets = ps.filter((p) => p.sheet).length;
      const stories = [];
      ps.forEach((p) => (p.stories || []).forEach((k) => { if (stories.indexOf(k) === -1) stories.push(k); }));
      return ps.length + ' pages in the code · ' + sheets + ' with a technical sheet · ' + stories.length + ' Jira stories mapped';
    }
    gitText(g) {
      if (!g || !g.available) return '';
      const where = g.branch + (g.upstream ? ' → ' + g.upstream : ' (not pushed anywhere yet)');
      if (g.pending && g.pending.length) return 'Branch ' + where + ' · ' + g.pending.length + ' file' + (g.pending.length === 1 ? '' : 's') + ' not committed';
      if (g.unpushed && g.unpushed.length) return 'Branch ' + where + ' · ' + g.unpushed.length + ' commit' + (g.unpushed.length === 1 ? '' : 's') + ' not pushed';
      return 'Branch ' + where + ' · everything is in git ✓';
    }
    needsPush(g) { return !!(g && g.available && ((g.pending && g.pending.length) || (g.unpushed && g.unpushed.length))); }
    appChips(pages) {
      const ps = pages || [];
      return APPS.map((a) => ({ id: a[0], label: a[1], n: a[0] === 'all' ? ps.length : ps.filter((p) => p.app === a[0]).length })).filter((c) => c.id === 'all' || c.n > 0);
    }
    shown(pages, q, appF, onlyMapped, onlySheet) {
      const k = JSON.stringify([(pages || []).length, (pages || []).map((p) => (p.stories || []).length + (p.sheet ? 's' : '')).join(''), q, appF, onlyMapped, onlySheet]);
      if (shownKept.k === k && shownKept.pages === pages) return shownKept.v;
      const s = String(q || '').trim().toLowerCase();
      const v = (pages || []).filter((p) => (appF === 'all' || !appF || p.app === appF) && (!onlyMapped || (p.stories || []).length) && (!onlySheet || p.sheet)
        && (!s || [p.label, p.id, p.appName, (p.stories || []).join(' ')].join(' ').toLowerCase().indexOf(s) !== -1));
      shownKept = { k: k, v: v, pages: pages };
      return v;
    }
    thumb(base, p) { return p && p.sheet && p.sheet.screenshot ? PC.shotUrl(base, { file: p.sheet.screenshot, at: p.sheet.at }) : ''; }
    shot(base, s) { return PC.shotUrl(base, s); }
    shotText(s) { return s ? (s.source === 'capture' ? 'Captured' : 'Uploaded') + ' ' + when(s.at) + (s.by ? ' by ' + s.by : '') : ''; }
    appShort(app) { return SHORT[app] || 'VB'; }
    firstStories(list) { const l = list || []; return l.length > 4 ? l.slice(0, 4).concat(['+' + (l.length - 4)]) : l; }
    stateText(sh, saved) {
      if (!sh) return '';
      if (!saved) return 'No technical sheet saved yet — these facts are read from the code now.';
      return 'Sheet built ' + when(sh.at) + (sh.by ? ' by ' + sh.by : '') + ' · code ' + sh.codeHash;
    }
    routeText(r) { return r ? (r.menu ? 'Menu: ' + r.menu + ' · ' : '') + (r.url ? 'Opens at ' + r.url : '') : ''; }
    tabs(sh) {
      const f = (sh && sh.facts) || { features: {}, logic: {}, integrations: {}, links: [] };
      return [{ id: 'overview', label: 'Overview' }, { id: 'features', label: 'Features ' + ((f.features.actions || []).length + (f.features.fields || []).length) },
        { id: 'logic', label: 'Business logic ' + ((f.logic.chains || []).length + (f.logic.modules || []).length) },
        { id: 'integrations', label: 'Integrations ' + ((f.integrations.rest || []).length + (f.integrations.reports || []).length) },
        { id: 'links', label: 'Links & files' }];
    }
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
