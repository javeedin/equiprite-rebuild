define(['resources/js/jiraBacklog', 'resources/js/exportKit', 'resources/js/testRecorder', 'resources/js/jiraStoryPanel'], (J, exportKit, Recorder, Panel) => {
  'use strict';

  // Jira stories: binding helpers. The rules are resources/js/jiraBacklog.js (the same file Old EquipRite's Jira
  // Stories page uses); the chains are jira-page-chains. None uses `this`: a binding may call a function detached.
  const BADGE = { new: 'oj-badge oj-badge-subtle', indeterminate: 'oj-badge oj-badge-info oj-badge-subtle', done: 'oj-badge oj-badge-success oj-badge-subtle' };
  const kept = {};
  function same(key, content, make) {
    const json = JSON.stringify(content);
    if (!kept[key] || kept[key].json !== json) kept[key] = { json, value: make ? make(content) : content };
    return kept[key].value;
  }

  class PageModule {
    constructor(context) {
      // Record: when a recording or screenshot is saved (from the bar or a shortcut, perhaps in another tab), the open
      // item's evidence is read again (evidenceChain).
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      if (Recorder && typeof Recorder.onChange === 'function') Recorder.onChange('jira-page', () => { if (helper) helper.fireCustomEvent('evidenceChanged', {}); });
      // Escape closes the item's drawer (resources/js/jiraStoryPanel.js).
      Panel.closeOnEscape();
      // On the desktop app, when Whisper is not set up yet, offer to set it up once (so a test can be transcribed later).
      if (Recorder && typeof Recorder.maybePromptSetup === 'function') { Recorder.maybePromptSetup().catch(() => {}); }
    }

    presets() { return J.PRESETS; }
    formats() { return exportKit.FORMATS; }

    /** "EQP on equiprite.atlassian.net · 205 items read at 10:42", or what is happening. */
    subtitle(conn, rows, readAt, isLoading) {
      const site = String((conn && conn.site) || J.SITE).replace(/^https:\/\//, '');
      if (isLoading) return 'Reading Jira (' + site + ')…';
      if (conn && conn.checked && !conn.connected) return 'Not connected to Jira (' + site + ')';
      const n = (rows || []).length;
      return 'EquipRite backlog on ' + site + (readAt ? ' · ' + n + (n === 1 ? ' item' : ' items') + ' read at ' + readAt : '');
    }

    /** The numbers, as tiles; each opens the items it counts. */
    tiles(a) {
      const k = (a && a.kpis) || {};
      return same('tiles', k, () => [
        { key: 'total', label: 'Items', value: k.total || 0, tone: '', field: 'clear', val: '', note: '' },
        { key: 'done', label: 'Done', value: k.done || 0, tone: 'good', field: 'status', val: 'Done', note: (k.total ? Math.round((k.done || 0) / k.total * 100) : 0) + '%' },
        { key: 'active', label: 'In progress', value: k.active || 0, tone: '', field: 'only', val: 'open', note: '' },
        { key: 'onHold', label: 'On hold', value: k.onHold || 0, tone: k.onHold ? 'warn' : '', field: 'status', val: 'ONHOLD', note: '' },
        { key: 'overdue', label: 'Overdue', value: k.overdue || 0, tone: k.overdue ? 'bad' : 'good', field: 'only', val: 'overdue', note: '' },
        { key: 'noAc', label: 'No acceptance criteria', value: k.noAc || 0, tone: k.noAc ? 'warn' : 'good', field: 'check', val: 'noAc', note: '' },
        { key: 'gaps', label: 'Tester gaps', value: k.gaps || 0, tone: k.gaps ? 'warn' : 'good', field: 'only', val: 'gaps', note: (k.withGaps || 0) + ' items' },
        { key: 'score', label: 'Average quality', value: (k.avgScore || 0) + ' / 5', tone: (k.avgScore || 0) >= 4 ? 'good' : ((k.avgScore || 0) >= 3 ? '' : 'warn'), field: '', val: '', note: '' },
      ]);
    }

    /** What a tile opens, in words (the Showing chip). */
    tileLabel(t) { return t && t.field && t.field !== 'clear' ? t.label + ': ' + t.value : ''; }

    /** A status as a bar: { width } as an object style. */
    barStyle(pct) { return { width: Math.max(2, Math.min(100, Number(pct) || 0)) + '%' }; }

    /** The breakdowns, as tabs, with how many rows each has. */
    tabs(a) {
      const x = a || {};
      return same('tabs', [(x.epics || []).length, (x.releases || []).length, (x.people || []).length, (x.checks || []).length, (x.fdd || []).length, (x.gaps || []).length,
        (x.sprints || []).length], (n) => [
        { key: 'sprints', label: 'By sprint', count: n[6] }, { key: 'epics', label: 'By epic', count: n[0] }, { key: 'releases', label: 'By release', count: n[1] }, { key: 'people', label: 'By person', count: n[2] },
        { key: 'checks', label: 'Quality checks', count: n[3] }, { key: 'fdd', label: 'By FDD section', count: n[4] }, { key: 'gaps', label: 'Tester gaps', count: n[5] },
      ]);
    }

    /** A Current filter's options, with counts. */
    options(rows, field) { return J.options(rows, field); }

    /** A status as Oracle's badge. */
    badge(cat) { return BADGE[cat] || BADGE.new; }





    /** A sprint's dates and time left: "1 Jul – 31 Jul · 4 days left". */
    sprintDates(sp) {
      if (!sp || (!sp.start && !sp.end)) return '—';
      return (sp.start || '?') + ' – ' + (sp.end || '?') + (sp.daysLeft != null ? ' · ' + (sp.daysLeft === 0 ? 'ends today' : sp.daysLeft + (sp.daysLeft === 1 ? ' day left' : ' days left')) : '');
    }
    /** A sprint's state as a tag. */
    sprintTag(state) { return 'nx-jira-tag nx-jira-tag--' + (state === 'active' ? 'active' : (state === 'closed' ? 'closed' : 'future')); }

    /** "Done 3 of 7 (43%)". */
    epicDone(e) { return e ? e.done + ' of ' + e.total + ' (' + e.donePct + '%)' : ''; }



    /** The items shown, in words. */
    countText(shown, rows) {
      const a = (shown || []).length;
      const b = (rows || []).length;
      return a === b ? b + (b === 1 ? ' item' : ' items') : a + ' of ' + b + ' items';
    }

    /** Something narrows the list (a filter, a finding, a check or Smart Search). */
    filtered(f, cols) {
      const has = (o) => !!o && Object.keys(o).some((k) => !!o[k]);
      return has(f) || has(cols);
    }


    /** Redwood: the header's Refresh (the band's white button) and its other actions. */
    rwPrimary(isLoading) { return same('primary', { label: 'Refresh', icon: 'oj-ux-ico-refresh', display: isLoading ? 'disabled' : 'on' }); }
    rwActions(n) {
      return same('actions', n > 0 ? [{ id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: 'on' }]
        : [{ id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: 'disabled' }]);
    }

    /** The JQL presets' chip class. */
    presetClass(preset, key) { return 'nx-chip nx-cm-chip--sm' + (preset === key ? ' nx-chip--on' : ''); }
  }

  // The item's drawer: the same helpers as a sprint's tab (resources/js/jiraStoryPanel.js).
  Object.keys(Panel.helpers).forEach((k) => { PageModule.prototype[k] = Panel.helpers[k]; });

  return PageModule;
});
