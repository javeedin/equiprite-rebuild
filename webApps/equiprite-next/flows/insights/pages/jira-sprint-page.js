define(['resources/js/exportKit', 'resources/js/jiraStoryPanel', 'resources/js/testRecorder', 'resources/js/followup'], (exportKit, Panel, Recorder, F) => {
  'use strict';

  // One Jira sprint, in its own tab: binding helpers. The report is resources/js/jiraBacklog.js sprintReport.
  const kept = {};
  function same(key, content) {
    const json = JSON.stringify(content);
    if (!kept[key] || kept[key].json !== json) kept[key] = { json, value: content };
    return kept[key].value;
  }
  const STATE = { active: 'info', future: 'warning', closed: 'neutral' };
  const WHERE = { done: 'Done here', here: 'Still in this sprint', moved: 'Carried on' };

  // Items table: filter on every column (type to narrow) and sort (Key by story number). Pure helpers, no `this`.
  function ci(s) { return String(s == null ? '' : s).toLowerCase(); }
  function has(hay, needle) { return !needle || ci(hay).indexOf(ci(needle)) >= 0; }
  function keyNum(k) { const m = /(\d+)\s*$/.exec(String(k || '')); return m ? parseInt(m[1], 10) : 0; }
  function whereOf(r) { return (WHERE[r && r.in] || '') + (r && r.sprintNow ? ' to ' + r.sprintNow : ''); }
  function labelsText(r) { const l = (r && r.labels) || []; return l.length ? l.join(', ') : 'No label'; }
  function fieldOf(r, col) {
    if (col === 'in') return whereOf(r);
    if (col === 'assignee') return (r && r.assignee) || 'Nobody';
    if (col === 'customer') return labelsText(r);
    return (r && r[col]) || '';
  }

  let tabs = 0;

  class PageModule {
    constructor(context) {
      // Record (an item's drawer): when a recording or screenshot is saved, the open item's evidence is read again. One
      // listener per sprint tab; Escape closes the drawer (resources/js/jiraStoryPanel.js).
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      tabs += 1;
      if (Recorder && typeof Recorder.onChange === 'function') Recorder.onChange('jira-sprint-page-' + tabs, () => { if (helper) helper.fireCustomEvent('evidenceChanged', {}); });
      Panel.closeOnEscape();
    }

    formats() { return exportKit.FORMATS; }

    title(r, name) { return 'Sprint ' + ((r && r.sprint && r.sprint.name) || name || ''); }

    /** "Active · 1 Jun – 30 Jun 2026 · Ended 128 days ago · Goal: …". */
    sub(r, isLoading) {
      if (isLoading) return 'Reading the sprint from Jira…';
      const s = (r && r.sprint) || {};
      const k = (r && r.kpis) || {};
      return [s.state ? s.state.charAt(0).toUpperCase() + s.state.slice(1) : '', s.start || s.end ? (s.start || '?') + ' – ' + (s.end || '?') : '', k.dayText,
        s.goal ? 'Goal: ' + s.goal : ''].filter((x) => !!x).join(' · ');
    }

    /** Redwood: the header's badge, its Refresh and its other actions. */
    rwBadge(r) { const st = (r && r.sprint && r.sprint.state) || ''; return same('badge', st ? { text: st, status: STATE[st] || 'neutral' } : { text: '' }); }
    rwPrimary(isLoading) { return same('primary', { label: 'Refresh', icon: 'oj-ux-ico-refresh', display: isLoading ? 'disabled' : 'on' }); }
    rwActions() {
      return same('actions', [{ id: 'jira', label: 'Open in Jira', icon: 'oj-ux-ico-external-link', display: 'on' },
        { id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: 'on' },
        { id: 'stories', label: 'All Jira stories', icon: 'oj-ux-ico-list', display: 'on' }]);
    }

    /** The numbers, as tiles. */
    tiles(k) {
      const x = k || {};
      return same('tiles', [
        { label: 'Items', value: x.total || 0, tone: '', note: x.days ? x.days + ' days long' : '' },
        { label: 'Done', value: x.done || 0, tone: 'good', note: (x.donePct || 0) + '%' },
        { label: 'Open', value: x.open || 0, tone: x.open ? '' : 'good', note: '' },
        { label: 'Overdue', value: x.overdue || 0, tone: x.overdue ? 'bad' : 'good', note: '' },
        { label: 'Carried on', value: x.carriedOut || 0, tone: x.carriedOut ? 'warn' : '', note: 'to a later sprint' },
        { label: 'Came in', value: x.carriedIn || 0, tone: '', note: 'from an earlier sprint' },
        { label: 'Nobody assigned', value: x.unassigned || 0, tone: x.unassigned ? 'warn' : '', note: 'open items' },
      ]);
    }

    /** A bar's height (burn-up) or width (by status), as object styles. */
    height(pct) { return { height: Math.max(1, Math.min(100, Number(pct) || 0)) + '%' }; }
    width(pct) { return { width: Math.max(2, Math.min(100, Number(pct) || 0)) + '%' }; }

    /** The burn-up's day labels: every few days, so they fit. */
    showLabel(i, n) { const step = n > 45 ? 7 : (n > 20 ? 3 : 1); return i % step === 0 || i === n - 1; }
    burnClass(b) { return 'nx-jsp-burnday' + (b && b.today ? ' nx-jsp-burnday--today' : '') + (b && b.weekend ? ' nx-jsp-burnday--weekend' : ''); }
    burnTitle(b, total) { return b ? b.day + ': ' + b.done + ' of ' + total + ' done (' + b.pct + '%)' : ''; }

    /** Where an item stands in this sprint. */
    whereText(r) { return r ? WHERE[r.in] + (r.sprintNow ? ' to ' + r.sprintNow : '') : ''; }
    whereClass(r) { return 'nx-jsp-where nx-jsp-where--' + ((r && r.in) || 'here'); }
    statusClass(cat) { return 'nx-jira-status nx-jira-status--' + (cat || 'new'); }

    /** The items after the column filters and the chosen sort (Key sorts by story number). */
    itemsView(rows, f, sort) {
      f = f || {}; sort = sort || {};
      let list = (rows || []).filter((r) => has(r.key, f.key) && has(r.summary, f.summary) && has(r.status, f.status)
        && has(whereOf(r), f.in) && has(r.sprint, f.sprint) && has((r.assignee || 'Nobody'), f.assignee)
        && has(labelsText(r), f.customer) && has(r.due, f.due) && has(r.resolved, f.resolved));
      if (sort.col) {
        const dir = sort.dir === 'desc' ? -1 : 1;
        list = list.slice().sort((a, b) => {
          let av; let bv;
          if (sort.col === 'key') { av = keyNum(a.key); bv = keyNum(b.key); } else { av = ci(fieldOf(a, sort.col)); bv = ci(fieldOf(b, sort.col)); }
          return (av < bv ? -1 : (av > bv ? 1 : 0)) * dir;
        });
      }
      return list;
    }
    /** "12 of 77 items" when filtered, else the plain count. */
    itemsCount(shown, total) { const s = (shown || []).length; const t = (total || []).length; return (s === t ? s : s + ' of ' + t) + (t === 1 ? ' item' : ' items'); }
    /** The sort arrow on a header, and its class when active. */
    sortSym(col, sort) { return sort && sort.col === col ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''; }
    sortClass(col, sort) { return 'nx-jsp-sortbtn' + (sort && sort.col === col ? ' nx-jsp-sortbtn--on' : ''); }

    /** Each item's customer labels, for the Customer cell ([] renders as "—"). */
    labelsOf(r) { return (r && r.labels) || []; }
    /** Any column filter typed, or a sort chosen — so "Clear filters" shows only when there is something to clear. */
    hasFilters(f, sort) { f = f || {}; sort = sort || {}; return Object.keys(f).some((k) => !!f[k]) || !!(sort && sort.col); }
    /** A By-status / By-person / By-customer row is "picked" when its value is the current filter on that column. */
    isPicked(field, value, f) { return !!f && f[field] === value; }
    pickOn(field, value, f) { return (!!f && f[field] === value) ? ' nx-jsp-pick--on' : ''; }

    /** Copy to follow-up: is this item ticked, the checkbox class, and the header (all / some / none) checkbox. */
    isSel(key, selected) { return (selected || []).indexOf(key) >= 0; }
    selClass(key, selected) { return 'nx-pick' + ((selected || []).indexOf(key) >= 0 ? ' nx-pick--on' : ''); }
    rowClass(key, selected) { return 'nx-jsp-row' + ((selected || []).indexOf(key) >= 0 ? ' nx-jsp-row--sel' : ''); }
    selAllClass(rows, selected) {
      const keys = (rows || []).map((r) => r.key);
      const on = keys.filter((k) => (selected || []).indexOf(k) >= 0).length;
      return 'nx-pick' + (keys.length && on === keys.length ? ' nx-pick--on' : (on ? ' nx-pick--some' : ''));
    }
    allChecked(rows, selected) {
      const keys = (rows || []).map((r) => r.key);
      const on = keys.filter((k) => (selected || []).indexOf(k) >= 0).length;
      return keys.length && on === keys.length ? 'true' : (on ? 'mixed' : 'false');
    }
    /** The copy button's label: "Copy 3 to follow-up" once items are ticked, else "Copy to follow-up". */
    followLabel(selected) { const n = (selected || []).length; return n ? 'Copy ' + n + ' to follow-up' : 'Copy to follow-up'; }

    /** The follow-up compose dialog: the body templates, the chosen chip, a live preview of the email. */
    fuTemplates() { return F.TEMPLATES; }
    fuTplClass(key, cur) { return 'nx-fu-tpl' + (key === cur ? ' nx-fu-tpl--on' : ''); }
    fuCountText(rows) { const n = (rows || []).length; return n + (n === 1 ? ' story' : ' stories') + ' will be added as a table'; }
    fuPreview(title, subtitle, when, message, signoff, rows) { return F.composeHtml({ title, subtitle, when, message, signoff, rows: rows || [], kind: 'sprint' }); }
  }

  // An item's drawer: the same helpers as Jira stories (resources/js/jiraStoryPanel.js).
  Object.keys(Panel.helpers).forEach((k) => { PageModule.prototype[k] = Panel.helpers[k]; });

  return PageModule;
});
