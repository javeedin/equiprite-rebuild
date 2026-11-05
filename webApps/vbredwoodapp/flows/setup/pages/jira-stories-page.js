define(['resources/js/jiraBacklog', 'resources/js/testRecorder'], function (J, Recorder) {
  'use strict';

  // Jira Stories (setup/jira-stories, Administrator menu): the EquipRite backlog read from Jira, read only. The rules
  // (reading every page of a search, a story split into its parts, the checks, the analysis and its findings, the
  // filters, the export columns, the connection) are resources/js/jiraBacklog.js, kept identical to EquipRite Next's;
  // this module only turns them into what the page binds to, so the bindings stay plain calls (no arrow functions,
  // array literals or String() in a binding, which VB's expression parser refuses).

  var FILTERS = ['status', 'epic', 'assignee', 'release', 'sprint', 'priority', 'type'];
  var NONE = [];

  function txt(v) { return v === undefined || v === null ? '' : '' + v; }
  function copy(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function esc(s) {
    return txt(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  class PageModule {
    constructor(context) {
      // Record: when a recording or screenshot is saved (from the bar or a shortcut), the open story's evidence is read again.
      var helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      if (Recorder && typeof Recorder.onChange === 'function') {
        Recorder.onChange('jira-stories-page', function () { if (helper) helper.fireCustomEvent('evidenceChanged', {}); });
      }
    }

    /** The open story's recordings and screenshots, and how each is labelled ("2026-11-05 14:03 · 12.4 MB"). */
    videos(ev) { return ((ev && ev.items) || NONE).filter(function (x) { return x.kind === 'video'; }); }
    shots(ev) { return ((ev && ev.items) || NONE).filter(function (x) { return x.kind === 'image'; }); }
    /** A list's icon for a story with test evidence on this PC (testRecorder.index): what it says, its look, its count. */
    recText(x) {
      if (!x) return '';
      return [x.videos ? x.videos + (x.videos === 1 ? ' recording' : ' recordings') : '', x.shots ? x.shots + (x.shots === 1 ? ' screenshot' : ' screenshots') : '',
        x.failed ? 'the trace caught ' + x.failed + (x.failed === 1 ? ' failure' : ' failures') : '', x.latest ? 'latest ' + x.latest : ''].filter(function (t) { return !!t; }).join(' · ');
    }
    recClass(x) { return 'jira-recmark' + (x && x.failed ? ' jira-recmark--bad' : ''); }
    recCount(x) { return x && x.videos > 1 ? String(x.videos) : ''; }
    /** A recording's technical trace, on its button: "Technical trace · 23 calls · 2 failed · broke at 00:42". */
    traceText(t) {
      if (!t) return '';
      return ['Technical trace', t.calls + (t.calls === 1 ? ' call' : ' calls'), t.failed ? t.failed + ' failed' : '',
        t.errors ? t.errors + (t.errors === 1 ? ' console error' : ' console errors') : '', t.first ? 'broke at ' + t.first.at : ''].filter(function (x) { return !!x; }).join(' · ');
    }
    traceClass(t) { return 'jira-tracebtn' + (t && (t.failed || t.errors) ? ' jira-tracebtn--bad' : ''); }
    evidenceText(x) {
      if (!x) return '';
      var m = /(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})/.exec(x.name || '');
      var size = x.size >= 1048576 ? (Math.round(x.size / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(x.size / 1024)) + ' KB';
      return (m ? m[1] + ' ' + m[2] + ':' + m[3] : x.name) + ' · ' + size;
    }

    /** Today on this PC: 'YYYY-MM-DD' (what "overdue" and "passed" are measured against). */
    today() {
      var d = new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    /** The time a read finished: 'HH:MM'. */
    nowTime() {
      var d = new Date();
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    /** The saved searches (jiraBacklog.PRESETS), for the chips. */
    presets() { return J.PRESETS; }

    /** "https://equiprite.atlassian.net" → "equiprite.atlassian.net". */
    hostOf(site) { return txt(site || J.SITE).replace(/^https?:\/\//, '').replace(/\/.*$/, ''); }

    /**
     * Smart Search's criterion as the filters jiraBacklog.filter reads: { text, status, epic, assignee, release, sprint,
     * priority, type }. The criterion is a tree: a text node ({ text }) and an $eq node per filter picked, its value on
     * the node ({ attribute, value }) or in an object ({ value: { status: 'TEST' } }).
     */
    readCriterion(c) {
      var out = { text: '' };
      FILTERS.forEach(function (f) { out[f] = ''; });
      function pick(field, val) {
        if (FILTERS.indexOf(field) !== -1) out[field] = val === undefined || val === null ? '' : txt(val);
      }
      (function read(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node.criteria)) node.criteria.forEach(read);
        if (node.text !== undefined && node.text !== null) out.text = txt(node.text).trim();
        if (node.op === '$eq') {
          if (node.attribute) pick(node.attribute, node.value);
          else if (node.value && typeof node.value === 'object') Object.keys(node.value).forEach(function (k) { pick(k, node.value[k]); });
        }
      })(c);
      return out;
    }

    /** The rows the table shows: the Smart Search filters, then the finding, check or FDD section picked. */
    shown(rows, search, pick) {
      return J.filter(J.filter(copy(rows) || NONE, copy(search) || {}), copy(pick) || {});
    }

    /** A row as the table shows it: jiraBacklog.fromIssue's row with its badge, quality and counts. */
    decorate(row) {
      var r = Object.assign({}, row);
      r.badge = this.badge(r.status, r.statusCat);
      r.gapCount = (r.gaps || NONE).length;
      r.checkCount = (r.checks || NONE).length;
      r.quality = this.qualityText(r);
      r.epicLine = r.epicKey ? r.epicKey + ' ' + r.epicName : 'No epic';
      r.sprintText = r.sprint || '—';
      return r;
    }

    /** Each Smart Search filter's options, with how many: { status: [{ value, label }], epic, … }. */
    filterOptions(rows) {
      var out = {};
      FILTERS.forEach(function (f) { out[f] = J.options(rows || NONE, f); });
      return out;
    }

    /** The analysis of nothing (before a read, or when Jira refused). */
    emptyAnalysis() { return J.analyse([], this.today()); }

    /** The KPI tiles: Items, Done, In progress, On hold, Overdue, No acceptance criteria, Tester gaps, Average quality. */
    tiles(k) {
      var kp = k || {};
      var n = function (v) { return v === undefined || v === null ? 0 : v; };
      var total = n(kp.total);
      var pct = function (v) { return total ? Math.round(n(v) / total * 100) + '% of the items' : ''; };
      return [
        { key: 'total', label: 'Items', value: txt(total), hint: n(kp.notStarted) + ' not started', tone: 'neutral' },
        { key: 'done', label: 'Done', value: txt(n(kp.done)), hint: pct(kp.done), tone: 'success' },
        { key: 'active', label: 'In progress', value: txt(n(kp.active)), hint: pct(kp.active), tone: 'info' },
        { key: 'onHold', label: 'On hold', value: txt(n(kp.onHold)), hint: pct(kp.onHold), tone: n(kp.onHold) ? 'warning' : 'neutral' },
        { key: 'overdue', label: 'Overdue', value: txt(n(kp.overdue)), hint: 'past their due date, not done', tone: n(kp.overdue) ? 'danger' : 'neutral' },
        { key: 'noAc', label: 'No acceptance criteria', value: txt(n(kp.noAc)), hint: 'cannot be tested as written', tone: n(kp.noAc) ? 'warning' : 'neutral' },
        { key: 'gaps', label: 'Tester gaps', value: txt(n(kp.gaps)), hint: 'on ' + plural(n(kp.withGaps), 'item'), tone: n(kp.gaps) ? 'warning' : 'neutral' },
        { key: 'avgScore', label: 'Average quality', value: n(kp.avgScore) + ' / 5', hint: '5 = passes every check', tone: 'neutral' }
      ];
    }

    /**
     * What a click on the analysis applies to the table: { filter, label } for a finding (its own filter), a quality
     * check or an FDD section; null to show every story again.
     */
    pickOf(what, value, analysis) {
      var a = analysis || {};
      if (what === 'finding') {
        var f = (a.findings || NONE)[parseInt(value, 10)];
        if (!f || !f.filter || !Object.keys(f.filter).length) return null;
        return { filter: copy(f.filter), label: f.text };
      }
      if (what === 'check' && value) {
        var c = (a.checks || NONE).filter(function (x) { return x.key === value; })[0];
        return { filter: { check: value }, label: 'Quality check: ' + (c ? c.label : (J.CHECKS[value] ? J.CHECKS[value].label : value)) };
      }
      if (what === 'fdd' && value) return { filter: { fdd: value }, label: 'FDD section ' + value };
      if (what === 'sprint' && value) return { filter: { sprint: value }, label: 'Sprint: ' + value };
      return null;
    }

    /** The page's subtitle: what was read, from where, and when; or what went wrong. */
    subtitle(conn, loading, problem, count, readAt, capped) {
      var c = conn || {};
      var where = J.PROJECT + ' · EquipRite on ' + this.hostOf(c.site);
      if (loading && !readAt) return where + ' · reading Jira…';
      if (loading) return where + ' · reading Jira again…';
      if (c.state === 'refused') return where + ' · Jira is not connected';
      if (problem) return where + ' · ' + problem;
      if (!readAt) return where;
      return where + ' · ' + plural(count || 0, 'item') + ' read at ' + readAt + (capped ? ' (stopped there: narrow the search)' : '');
    }

    /** "Connected as Priya Raman" (or to the site when Jira gave no name). */
    connText(conn) {
      var c = conn || {};
      return c.name ? 'Connected as ' + c.name : 'Connected to ' + this.hostOf(c.site);
    }

    /** Oracle's badge for a Jira status (oj-badge classes): done green, test blue, bugs red, on hold amber. */
    badge(status, cat) {
      if (cat === 'done') return 'oj-badge oj-badge-success oj-badge-subtle';
      if (status === 'Bugs') return 'oj-badge oj-badge-danger oj-badge-subtle';
      if (status === 'ONHOLD') return 'oj-badge oj-badge-warning oj-badge-subtle';
      if (status === 'TEST') return 'oj-badge oj-badge-info';
      if (cat === 'indeterminate') return 'oj-badge oj-badge-info oj-badge-subtle';
      return 'oj-badge oj-badge-subtle';
    }

    findingClass(tone) { return 'jira-finding jira-finding--' + (tone || 'info'); }

    findingIcon(tone) {
      return { bad: 'oj-ux-ico-error', warn: 'oj-ux-ico-warning', good: 'oj-ux-ico-check-circle' }[tone] || 'oj-ux-ico-information';
    }

    tileClass(tone) { return 'jira-tile jira-tile--' + (tone || 'neutral'); }

    /** A bar's width, as an object (JET's :style takes an object, not a CSS string). */
    barStyle(pct) { return { width: Math.max(0, Math.min(100, parseInt(pct, 10) || 0)) + '%' }; }

    /** A sprint's dates and time left: "2026-07-01 – 2026-07-31 · 4 days left". */
    sprintDates(sp) {
      if (!sp || (!sp.start && !sp.end)) return '—';
      return (sp.start || '?') + ' – ' + (sp.end || '?') + (sp.daysLeft !== null && sp.daysLeft !== undefined
        ? ' · ' + (sp.daysLeft === 0 ? 'ends today' : plural(sp.daysLeft, 'day') + ' left') : '');
    }

    /** A sprint's state as Oracle's badge. */
    sprintBadge(state) {
      return state === 'active' ? 'oj-badge oj-badge-info oj-badge-subtle' : (state === 'future' ? 'oj-badge oj-badge-warning oj-badge-subtle' : 'oj-badge oj-badge-subtle');
    }

    presetClass(key, preset) { return 'jira-chip' + (key === preset ? ' jira-chip--on' : ''); }

    pressed(key, preset) { return key === preset ? 'true' : 'false'; }

    presetId(key) { return 'jiraPreset-' + key; }

    /** "4.5 · 2 checks", "5 · passes" */
    qualityText(row) {
      var r = row || {};
      var n = (r.checks || NONE).length;
      return txt(r.score) + ' · ' + (n ? plural(n, 'check') : 'passes');
    }

    qualityClass(score) {
      var s = parseFloat(score) || 0;
      return 'jira-score ' + (s >= 4.5 ? 'jira-score--good' : (s >= 3 ? 'jira-score--fair' : 'jira-score--poor'));
    }

    dueClass(overdue) { return overdue ? 'jira-due jira-due--late' : 'jira-due'; }

    /** The acceptance criteria as a list: its clauses split on ';'. */
    acItems(ac) {
      return txt(ac).split(';').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
    }

    /** A list from a row (an empty one when it has none), for oj-bind-for-each. */
    items(v) { return Array.isArray(v) ? v : NONE; }

    /** The sprint the table is narrowed to (By sprint, a row clicked), or ''. */
    pickedSprint(pick) { return (pick && pick.sprint) || ''; }

    /** An image of the open story: its URL once read, '' until then (or when it could not be read). */
    imageUrl(images, id) { return (images && id && images[id]) || ''; }
    /** What an image's place says before (or instead of) the image. */
    imageNote(images, id) {
      if (!id) return 'Not attached to the story';
      return images && Object.prototype.hasOwnProperty.call(images, id) && !images[id] ? 'Could not be read from Jira' : 'Loading the image…';
    }
    /** The story's images among its attachments, and its other files. */
    imageFiles(r) { return ((r && r.attachments) || NONE).filter(function (a) { return a.image; }); }
    otherFiles(r) { return ((r && r.attachments) || NONE).filter(function (a) { return !a.image; }); }
    fileText(a) { return a ? a.name + ' · ' + a.sizeText + (a.author ? ' · ' + a.author : '') : ''; }

    hasItems(v) { return Array.isArray(v) && v.length > 0; }

    countOf(v) { return Array.isArray(v) ? v.length : 0; }

    drawerTitle(row) { var r = row || {}; return r.key ? r.key + ' ' + txt(r.summary) : 'Story'; }

    drawerSubtitle(row) {
      var r = row || {};
      return [r.status, r.epicKey ? r.epicKey + ' ' + txt(r.epicName) : 'No epic'].filter(function (s) { return !!s; }).join(' · ');
    }

    /** The drawer's close button, as oj-sp reads it. */
    closeAction() { return { label: 'Close', display: 'on' }; }

    /** The drawer's facts: who, release, sprint, due, FDD sections, priority, type, quality. */
    facts(row) {
      var r = row || {};
      var dash = function (v) { return v ? txt(v) : '—'; };
      return [
        { key: 'assignee', label: 'Assignee', value: dash(r.assignee), cls: '' },
        { key: 'release', label: 'Release', value: r.release ? r.release + (r.releaseDate ? ' (' + r.releaseDate + ')' : '') : '—', cls: '' },
        { key: 'sprint', label: 'Sprint', value: r.sprint ? r.sprint + (r.sprintState ? ' (' + r.sprintState + ')' : '') + (r.sprintEnd ? ', ends ' + r.sprintEnd : '') : '—', cls: '' },
        { key: 'sprintPast', label: 'Earlier sprints', value: (r.sprintPast || NONE).length ? r.sprintPast.join(', ') : 'None', cls: (r.sprintPast || NONE).length ? 'jira-late' : '' },
        { key: 'due', label: 'Due', value: r.due ? r.due + (r.overdue ? ' (overdue)' : '') : '—', cls: r.overdue ? 'jira-due--late' : '' },
        { key: 'fdd', label: 'FDD sections', value: (r.fdd || NONE).length ? (r.fdd || NONE).join(', ') : '—', cls: '' },
        { key: 'priority', label: 'Priority · Type', value: dash(r.priority) + ' · ' + dash(r.type), cls: '' },
        { key: 'quality', label: 'Quality', value: r.key ? this.qualityText(r) + ' (5 = passes every check)' : '—', cls: '' }
      ];
    }

    /** "Showing 12 of 205 items" */
    countText(shown, total) {
      if (!total) return 'No items';
      return shown === total ? plural(total, 'item') : 'Showing ' + shown + ' of ' + plural(total, 'item');
    }

    releaseText(r) { var x = r || {}; return x.open + ' open of ' + x.total; }

    /** The table's empty state, in words. */
    emptyText(conn, loading, problem, total) {
      var c = conn || {};
      if (loading && !total) return 'Reading the stories from Jira…';
      if (c.state === 'refused') return 'Connect Jira to read the stories.';
      if (problem && !total) return problem;
      if (!total) return 'This search found nothing in Jira.';
      return 'No story matches. Remove a filter or clear the search.';
    }

    /**
     * The export of the rows shown (jiraBacklog.exportColumns): format 'csv' (UTF-8, Excel reads it) or 'xls' (an HTML
     * table Excel opens, as Old's Agreement Expiry report does). { name, mime, text }.
     */
    exportFile(rows, format, today) {
      var cols = J.exportColumns();
      var list = rows || NONE;
      var cell = function (c, r) {
        var v = c.value ? c.value(r) : r[c.key];
        return v === undefined || v === null ? '' : txt(v);
      };
      var stamp = today || this.today();
      if (format === 'xls') {
        var th = function (c) { return '<th style="background:#f1f5f9;font-weight:700;border:1px solid #cbd5e1;">' + esc(c.label) + '</th>'; };
        var html = ['<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
          '<head><meta charset="UTF-8"/></head><body><table>', '<tr>' + cols.map(th).join('') + '</tr>'];
        list.forEach(function (r) {
          html.push('<tr>' + cols.map(function (c) {
            return '<td style="border:1px solid #e2e8f0;vertical-align:top;' + (c.type === 'number' ? '' : 'mso-number-format:\'\\@\';') + '">'
              + esc(cell(c, r)) + '</td>';
          }).join('') + '</tr>');
        });
        html.push('</table></body></html>');
        return { name: 'Jira_Stories_' + stamp + '.xls', mime: 'application/vnd.ms-excel', text: html.join('') };
      }
      var q = function (s) { return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      var lines = [cols.map(function (c) { return q(c.label); }).join(',')];
      list.forEach(function (r) { lines.push(cols.map(function (c) { return q(cell(c, r)); }).join(',')); });
      return { name: 'Jira_Stories_' + stamp + '.csv', mime: 'text/csv;charset=utf-8;', text: '\ufeff' + lines.join('\r\n') };
    }

    /** Hands a file to the browser to save (a Blob through a link, as Old's CSV exports do). */
    download(file) {
      if (!file || typeof document === 'undefined') return false;
      var url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
      var a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    }
  }

  return PageModule;
});
