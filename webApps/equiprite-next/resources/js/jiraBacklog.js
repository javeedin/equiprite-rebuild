define([], function () {
  'use strict';

  // The Jira stories page (Old EquipRite setup/jira-stories, EquipRite Next insights/jira): reading the EquipRite backlog
  // from Jira (services/jira: GET /rest/api/2/search/jql, read only) and working out what it says. Pure: no page, no
  // DOM; the one call it makes goes through the Actions it is handed. Old and Next keep identical copies of this file.
  //
  //   load(context, Actions, jql)      every page of a JQL search: { ok, issues, status, message }
  //   fromIssue(issue, o)              a story as the page shows it (the description split into its parts, the tester's
  //                                    gaps from the comments, the checks it fails)
  //   analyse(rows, today)             the numbers and the findings: by status, epic, release, assignee, sprint, quality,
  //                                    tester gaps, FDD sections, and the sentences that sum it up
  //   filter(rows, f)                  the rows a set of filters keeps
  //
  // The stories are written as: a description, "Acceptance Criteria: …", "FDD Section: 7.x". A tester's comment lists
  // what is missing in numbered lines ("1. Type column is missing."). Nothing here writes to Jira.

  var SITE = 'https://equiprite.atlassian.net';
  var PROJECT = 'EQP';
  var FIELDS = ['summary', 'issuetype', 'status', 'priority', 'parent', 'fixVersions', 'assignee', 'reporter', 'duedate', 'description',
    'comment', 'customfield_10020', 'labels', 'created', 'updated', 'resolutiondate', 'subtasks'];
  var PAGE = 100;
  var MAX_PAGES = 30; // 3,000 issues: a safety stop, said when reached
  var STALE_DAYS = 30;
  var BIG_AC = 6;

  // The project's workflow, in order (Bugs is a status in this project, as well as an issue type).
  var STATUS_ORDER = ['NEW', 'FUNC DESIGN', 'DEVELOPMENT', 'TEST', 'Bugs', 'ONHOLD', 'Done'];

  var PRESETS = [
    { key: 'stories', label: 'All stories', jql: 'project = EQP AND issuetype = Story ORDER BY key ASC' },
    { key: 'open', label: 'Stories not done', jql: 'project = EQP AND issuetype = Story AND statusCategory != Done ORDER BY duedate ASC' },
    { key: 'overdue', label: 'Overdue stories', jql: 'project = EQP AND issuetype = Story AND duedate < now() AND statusCategory != Done ORDER BY duedate ASC' },
    { key: 'sprint', label: 'In open sprints', jql: 'project = EQP AND sprint in openSprints() ORDER BY status ASC' },
    { key: 'bugs', label: 'Bugs', jql: 'project = EQP AND issuetype = Bug ORDER BY created DESC' },
    { key: 'epics', label: 'Epics', jql: 'project = EQP AND issuetype = Epic ORDER BY key ASC' }
  ];

  // The checks a story can fail, with how much each costs its score (5 = clean).
  var CHECKS = {
    noAc: { label: 'No acceptance criteria', weight: 2 },
    noFdd: { label: 'No FDD section', weight: 1 },
    big: { label: 'Too big: more than ' + BIG_AC + ' checks in its criteria (split it)', weight: 1 },
    noDue: { label: 'No due date', weight: 0.5 },
    noRelease: { label: 'No release', weight: 0.5 },
    noAssignee: { label: 'Nobody assigned', weight: 0.5 },
    stale: { label: 'Not updated for ' + STALE_DAYS + ' days', weight: 0.5 },
    dueAfterRelease: { label: 'Due after its release date', weight: 0.5 },
    releasePassed: { label: 'Its release date has passed', weight: 0.5 }
  };

  function txt(v) { return v == null ? '' : String(v); }
  function day(v) { var m = /^(\d{4}-\d{2}-\d{2})/.exec(txt(v)); return m ? m[1] : ''; }
  function daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
  }
  function todayOf(t) { return day(t) || new Date().toISOString().slice(0, 10); }

  /** Text from a Jira field: a string (REST v2), or Atlassian Document Format (REST v3), flattened. */
  function plain(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    var out = [];
    (function walk(n) {
      if (!n) return;
      if (n.type === 'text' && n.text) out.push(n.text);
      if (n.type === 'hardBreak') out.push('\n');
      (n.content || []).forEach(walk);
      if (/^(paragraph|heading|listItem|codeBlock|blockquote)$/.test(n.type || '')) out.push('\n');
    })(v);
    return out.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Wiki markup and markdown made readable: *bold*, {{code}}, [text|url], headings. */
  function readable(s) {
    return txt(s).replace(/\{\{([^}]*)\}\}/g, '$1').replace(/\[([^|\]]+)\|[^\]]+\]/g, '$1').replace(/^h\d\.\s*/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:])/g, '$1$2').replace(/\r/g, '').trim();
  }

  /** "FDD Section: 7.2, 7.2.5G" and "… - Section 7.14A" → ['7.2', '7.2.5G', '7.14A'] (in order, once each). */
  function fddSections(summary, description) {
    var seen = {};
    var out = [];
    var add = function (s) { var k = s.replace(/[.)]+$/, ''); if (k && !seen[k]) { seen[k] = true; out.push(k); } };
    // "7.2", "7.2.5G", "7.14A", "BR-012": a section number, even when the next word runs into it ("7.2Only Smart…")
    var grab = function (m) {
      var re2 = /(?:^|[^0-9A-Za-z.])((?:\d{1,2}(?:\.\d{1,2})+)(?:[A-Z](?![a-z]))?|BR-\d{3}|INT-\d{2}|DP-\d{2}|S\d{2})(?![0-9])/g;
      var k;
      while ((k = re2.exec(m))) add(k[1]);
    };
    var d = txt(description);
    // only where a line names the FDD section ("FDD Section: 7.2", "FDD Ref: …", "FDD: …"); "per FDD 7.2.4" in the
    // criteria is a pointer, not the story's section
    var re = /FDD\s*(?:Sections?|Ref(?:erence)?s?)?\s*:\s*([^\n]*)|FDD\s+(?:Sections?|Ref(?:erence)?s?)\s+([^\n]*)/gi;
    var m;
    while ((m = re.exec(d))) grab(m[1] || m[2] || '');
    var t = /Sections?\s+([0-9][0-9A-Z.,\s&]*)/i.exec(txt(summary));
    if (t) grab(t[1]);
    var paren = /\(FDD-([0-9.A-Z]+)\)/g;
    while ((m = paren.exec(d))) add(m[1]);
    return out;
  }

  /**
   * A description in its parts: { body, ac, fdd }. "Acceptance Criteria:" runs to "FDD Section" (or the end); what
   * follows the FDD line (notes added later, as in "FDD Section: 7.2Only Smart search…") goes back into the body.
   */
  function splitDescription(summary, description) {
    var d = readable(plain(description));
    var acAt = d.search(/Acceptance\s+Criteria\s*:?/i);
    var fddAt = d.search(/FDD\s*Section\s*:?/i);
    var body = d;
    var ac = '';
    var tail = '';
    if (fddAt !== -1) {
      var fddLine = /FDD\s*Section\s*:?\s*([0-9A-Z.,\s&-]*?)(?=[A-Z][a-z]|\n|$)/.exec(d.slice(fddAt));
      var fddEnd = fddAt + (fddLine ? fddLine[0].length : d.slice(fddAt).length);
      tail = d.slice(fddEnd).trim();
    }
    if (acAt !== -1) {
      body = d.slice(0, acAt).trim();
      ac = d.slice(acAt, fddAt > acAt ? fddAt : d.length).replace(/^Acceptance\s+Criteria\s*:?\s*/i, '').trim();
    } else if (fddAt !== -1) {
      body = d.slice(0, fddAt).trim();
    }
    if (tail) body = (body ? body + '\n\n' : '') + tail;
    return { body: body, ac: ac, fdd: fddSections(summary, d) };
  }

  /** The checks in a set of acceptance criteria: its clauses split on ';' and on numbered or bulleted lines. */
  function acChecks(ac) {
    return txt(ac).split(/;|\n\s*(?:\d+[.)]|[-*•])\s+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 3; });
  }

  /** A tester's gaps from a comment: its numbered or bulleted lines ("1. Type column is missing."), else nothing. */
  function gapsFrom(comment) {
    var lines = readable(comment).split(/\n+/).map(function (s) { return s.trim(); });
    return lines.filter(function (s) { return /^(\d+[.)]|[-*•])\s+\S/.test(s); })
      .map(function (s) { return s.replace(/^(\d+[.)]|[-*•])\s+/, '').replace(/\s*\(FDD-[^)]*\)\s*$/, '').trim(); })
      .filter(function (s) { return s.length > 2; });
  }

  function nameOf(u) { return u && (u.displayName || u.emailAddress || u.name) ? (u.displayName || u.emailAddress || u.name) : ''; }

  /** The sprint a story is in now: the last of its sprints (Jira lists them oldest first). */
  function sprintOf(v) {
    var list = Array.isArray(v) ? v : (v ? [v] : []);
    var s = list[list.length - 1];
    if (!s) return { name: '', state: '' };
    if (typeof s === 'string') {
      var n = /name=([^,\]]+)/.exec(s);
      var st = /state=([^,\]]+)/.exec(s);
      return { name: n ? n[1] : s, state: st ? st[1].toLowerCase() : '' };
    }
    return { name: s.name || '', state: txt(s.state).toLowerCase() };
  }

  /**
   * A Jira issue as the page shows it. o: { today: 'YYYY-MM-DD', site }. The row:
   *   key, url, summary, type, status, statusCat (new | indeterminate | done), priority, epicKey, epicName, assignee,
   *   release, releaseDate, sprint, sprintState, due, overdue, created, updated, idleDays, fdd [..], body, ac,
   *   acChecks (how many), comments [{ author, when, text }], gaps [..], checks [{ key, label }], score (1–5)
   */
  function fromIssue(issue, o) {
    var opts = o || {};
    var today = todayOf(opts.today);
    var f = (issue && issue.fields) || {};
    var status = f.status || {};
    var cat = (status.statusCategory && status.statusCategory.key) || '';
    var versions = (f.fixVersions || []).slice().sort(function (a, b) { return txt(a.releaseDate).localeCompare(txt(b.releaseDate)); });
    var rel = versions[0] || null;
    var sp = sprintOf(f.customfield_10020);
    var parts = splitDescription(f.summary, f.description);
    var comments = ((f.comment && f.comment.comments) || []).map(function (c) {
      return { author: nameOf(c.author), when: day(c.created), text: readable(plain(c.body)) };
    });
    var gaps = [];
    comments.forEach(function (c) { gapsFrom(c.text).forEach(function (g) { if (gaps.indexOf(g) === -1) gaps.push(g); }); });
    var due = day(f.duedate);
    var done = cat === 'done';
    var updated = day(f.updated);
    var parent = f.parent || null;
    var row = {
      key: issue.key || '', url: (opts.site || SITE).replace(/\/$/, '') + '/browse/' + (issue.key || ''),
      summary: txt(f.summary), type: (f.issuetype && f.issuetype.name) || '', status: status.name || '', statusCat: cat || 'new',
      priority: (f.priority && f.priority.name) || '', epicKey: parent ? parent.key : '', epicName: parent && parent.fields ? txt(parent.fields.summary) : '',
      assignee: nameOf(f.assignee), reporter: nameOf(f.reporter), labels: f.labels || [],
      release: rel ? rel.name : '', releaseDate: rel ? day(rel.releaseDate) : '', releases: versions.map(function (v) { return v.name; }),
      sprint: sp.name, sprintState: sp.state, due: due, overdue: !!(due && due < today && !done),
      created: day(f.created), updated: updated, resolved: day(f.resolutiondate), idleDays: updated ? daysBetween(updated, today) : null,
      fdd: parts.fdd, body: parts.body, ac: parts.ac, acChecks: acChecks(parts.ac).length,
      comments: comments, gaps: gaps, subtasks: (f.subtasks || []).length
    };
    var checks = [];
    var add = function (k) { checks.push({ key: k, label: CHECKS[k].label }); };
    if (row.type === 'Story' || row.type === '') {
      if (!row.ac) add('noAc');
      if (!row.fdd.length) add('noFdd');
      if (row.acChecks > BIG_AC) add('big');
    }
    if (!done) {
      if (!row.due) add('noDue');
      if (!row.release) add('noRelease');
      if (!row.assignee) add('noAssignee');
      if (row.idleDays !== null && row.idleDays >= STALE_DAYS) add('stale');
      if (row.due && row.releaseDate && row.due > row.releaseDate) add('dueAfterRelease');
      if (row.releaseDate && row.releaseDate < today) add('releasePassed');
    }
    row.checks = checks;
    var cost = checks.reduce(function (s, c) { return s + CHECKS[c.key].weight; }, 0);
    row.score = Math.max(1, Math.round((5 - cost) * 2) / 2);
    return row;
  }

  /** Every page of a JQL search (services/jira searchJiraIssues): { ok, issues, status, message, capped }. */
  async function load(context, Actions, jql, fields) {
    var issues = [];
    var token = '';
    for (var i = 0; i < MAX_PAGES; i++) {
      var params = { jql: jql, fields: (fields || FIELDS).join(','), maxResults: PAGE };
      if (token) params.nextPageToken = token;
      var res;
      try {
        res = await Actions.callRest(context, { endpoint: 'jira/searchJiraIssues', uriParams: params });
      } catch (e) {
        res = { ok: false, status: 0, body: { message: txt(e && e.message) } };
      }
      if (!res || !res.ok) return { ok: false, issues: issues, status: res ? res.status : 0, message: problem(res) };
      var body = res.body || {};
      issues = issues.concat(body.issues || []);
      token = body.nextPageToken || '';
      if (body.isLast !== false || !token) return { ok: true, issues: issues, status: 200, message: '', capped: false };
    }
    return { ok: true, issues: issues, status: 200, message: 'Stopped after ' + issues.length + ' issues: narrow the search.', capped: true };
  }

  /** What a failed call means, in words. */
  function problem(res) {
    var s = res ? res.status : 0;
    var b = (res && res.body) || {};
    var said = (b.errorMessages && b.errorMessages.join(' ')) || b.message || b.error || '';
    if (s === 401 || s === 403) {
      return 'Jira refused the connection (HTTP ' + s + '): it is not connected, or the email and API token are wrong. Connect Jira, or ask the VBCS administrator to set the jira backend\'s Basic authentication.';
    }
    if (s === 400) return 'Jira did not accept the search: ' + (said || 'check the JQL') + '.';
    if (s === 404) return 'Jira was not found (HTTP 404): the jira backend\'s URL may be wrong.';
    if (!s) return 'Jira could not be reached' + (said ? ': ' + said : '') + '.';
    return 'Jira answered HTTP ' + s + (said ? ': ' + said : '') + '.';
  }

  function tally(rows, keyOf, init) {
    var by = {};
    var order = [];
    rows.forEach(function (r) {
      var k = keyOf(r) || '';
      if (!by[k]) { by[k] = init(k, r); order.push(by[k]); }
      by[k].rows.push(r);
    });
    return order;
  }
  function statusIndex(s) { var i = STATUS_ORDER.indexOf(s); return i === -1 ? 50 : i; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

  function countBy(rows, keyOf) {
    var o = {};
    rows.forEach(function (r) { var k = keyOf(r); o[k] = (o[k] || 0) + 1; });
    return o;
  }

  /**
   * The analysis of a set of rows (today: 'YYYY-MM-DD'):
   *   kpis      { total, done, active, onHold, notStarted, overdue, noAc, withGaps, gaps, avgScore }
   *   statuses  [{ status, cat, count, pct }] in the workflow's order
   *   epics     [{ key, name, total, done, open, overdue, gaps, donePct, statuses: { status: n } }] most open first
   *   releases  [{ name, date, total, done, open, overdue, passed }] by date
   *   people    [{ name, total, open, overdue }] most open first
   *   sprints   [{ name, state, total, open }]
   *   checks    [{ key, label, count, keys }] most common first
   *   fdd       [{ section, total, open, keys }] by section
   *   gaps      [{ key, summary, status, gaps }] most gaps first
   *   findings  [{ tone: 'bad' | 'warn' | 'good' | 'info', text, filter }] the sentences that sum it up
   */
  function analyse(rows, today) {
    var list = Array.isArray(rows) ? rows : [];
    var t = todayOf(today);
    var total = list.length;
    var isDone = function (r) { return r.statusCat === 'done'; };
    var open = list.filter(function (r) { return !isDone(r); });
    var overdue = list.filter(function (r) { return r.overdue; });
    var withGaps = list.filter(function (r) { return r.gaps.length > 0; });
    var noAc = list.filter(function (r) { return r.checks.some(function (c) { return c.key === 'noAc'; }); });
    var kpis = {
      total: total, done: list.filter(isDone).length,
      active: list.filter(function (r) { return r.statusCat === 'indeterminate' && r.status !== 'ONHOLD'; }).length,
      onHold: list.filter(function (r) { return r.status === 'ONHOLD'; }).length,
      notStarted: list.filter(function (r) { return r.statusCat === 'new'; }).length,
      overdue: overdue.length, noAc: noAc.length, withGaps: withGaps.length,
      gaps: withGaps.reduce(function (s, r) { return s + r.gaps.length; }, 0),
      avgScore: total ? Math.round(list.reduce(function (s, r) { return s + r.score; }, 0) / total * 10) / 10 : 0
    };

    var statuses = tally(list, function (r) { return r.status; }, function (k, r) { return { status: k || 'No status', cat: r.statusCat, rows: [] }; })
      .map(function (g) { return { status: g.status, cat: g.cat, count: g.rows.length, pct: pct(g.rows.length, total) }; })
      .sort(function (a, b) { return statusIndex(a.status) - statusIndex(b.status) || a.status.localeCompare(b.status); });

    var epics = tally(list, function (r) { return r.epicKey; }, function (k, r) { return { key: k, name: k ? r.epicName : 'No epic', rows: [] }; })
      .map(function (g) {
        var o = g.rows.filter(function (r) { return !isDone(r); });
        return { key: g.key, name: g.name, total: g.rows.length, done: g.rows.length - o.length, open: o.length,
          overdue: g.rows.filter(function (r) { return r.overdue; }).length, gaps: g.rows.reduce(function (s, r) { return s + r.gaps.length; }, 0),
          donePct: pct(g.rows.length - o.length, g.rows.length), statuses: countBy(g.rows, function (r) { return r.status; }) };
      })
      .sort(function (a, b) { return b.open - a.open || b.total - a.total || a.name.localeCompare(b.name); });

    var releases = tally(list, function (r) { return r.release; }, function (k, r) { return { name: k || 'No release', date: k ? r.releaseDate : '', rows: [] }; })
      .map(function (g) {
        var o = g.rows.filter(function (r) { return !isDone(r); });
        return { name: g.name, date: g.date, total: g.rows.length, done: g.rows.length - o.length, open: o.length,
          overdue: g.rows.filter(function (r) { return r.overdue; }).length, passed: !!(g.date && g.date < t && o.length) };
      })
      .sort(function (a, b) { return (a.date || '9999').localeCompare(b.date || '9999') || a.name.localeCompare(b.name); });

    var people = tally(list, function (r) { return r.assignee; }, function (k) { return { name: k || 'Nobody', rows: [] }; })
      .map(function (g) {
        return { name: g.name, total: g.rows.length, open: g.rows.filter(function (r) { return !isDone(r); }).length,
          overdue: g.rows.filter(function (r) { return r.overdue; }).length };
      })
      .sort(function (a, b) { return b.open - a.open || b.total - a.total; });

    var sprints = tally(list, function (r) { return r.sprint; }, function (k, r) { return { name: k || 'No sprint', state: k ? r.sprintState : '', rows: [] }; })
      .map(function (g) { return { name: g.name, state: g.state, total: g.rows.length, open: g.rows.filter(function (r) { return !isDone(r); }).length }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    var checkMap = {};
    list.forEach(function (r) {
      r.checks.forEach(function (c) {
        if (!checkMap[c.key]) checkMap[c.key] = { key: c.key, label: c.label, count: 0, keys: [] };
        checkMap[c.key].count++;
        checkMap[c.key].keys.push(r.key);
      });
    });
    var checks = Object.keys(checkMap).map(function (k) { return checkMap[k]; }).sort(function (a, b) { return b.count - a.count; });

    var fddMap = {};
    list.forEach(function (r) {
      var tops = [];
      r.fdd.forEach(function (s) {
        var top = /^\d+\.\d+[A-Z]?/.exec(s);
        var k = top ? top[0] : s;
        if (tops.indexOf(k) !== -1) return; // 7.2 and 7.2.5G: the story counts once under 7.2
        tops.push(k);
        if (!fddMap[k]) fddMap[k] = { section: k, total: 0, open: 0, keys: [] };
        fddMap[k].total++;
        if (!isDone(r)) fddMap[k].open++;
        fddMap[k].keys.push(r.key);
      });
    });
    var fdd = Object.keys(fddMap).map(function (k) { return fddMap[k]; }).sort(function (a, b) {
      var pa = a.section.split(/[.]/); var pb = b.section.split(/[.]/);
      return (parseInt(pa[0], 10) || 99) - (parseInt(pb[0], 10) || 99) || (parseInt(pa[1], 10) || 0) - (parseInt(pb[1], 10) || 0) || a.section.localeCompare(b.section);
    });

    var gaps = withGaps.map(function (r) { return { key: r.key, summary: r.summary, status: r.status, gaps: r.gaps }; })
      .sort(function (a, b) { return b.gaps.length - a.gaps.length || a.key.localeCompare(b.key); });

    var findings = [];
    if (total) {
      if (overdue.length) {
        var byStatus = countBy(overdue, function (r) { return r.status; });
        var worst = Object.keys(byStatus).sort(function (a, b) { return byStatus[b] - byStatus[a]; })[0];
        findings.push({ tone: 'bad', filter: { only: 'overdue' }, text: (overdue.length === 1 ? '1 item is past its due date' : overdue.length + ' items are past their due date')
          + (worst ? ', most of them in ' + worst + ' (' + byStatus[worst] + ')' : '') + '.' });
      }
      releases.filter(function (r) { return r.passed; }).forEach(function (r) {
        findings.push({ tone: 'bad', filter: { release: r.name }, text: 'Release ' + r.name + ' was due ' + r.date + ' and still has ' + plural(r.open, 'item') + ' not done.' });
      });
      var next = releases.filter(function (r) { return r.date && r.date >= t && r.open; })[0];
      if (next) {
        findings.push({ tone: 'warn', filter: { release: next.name }, text: 'Next release: ' + next.name + ' on ' + next.date + ', ' + plural(next.open, 'item') + ' still open of ' + next.total + '.' });
      }
      if (noAc.length) findings.push({ tone: 'warn', filter: { check: 'noAc' }, text: plural(noAc.length, 'story has', 'stories have') + ' no acceptance criteria: they cannot be tested as written.' });
      if (withGaps.length) {
        findings.push({ tone: 'warn', filter: { only: 'gaps' }, text: 'Testers listed ' + plural(kpis.gaps, 'gap') + ' on ' + plural(withGaps.length, 'item') + ': each is unfinished work the status may not show.' });
      }
      if (kpis.onHold) findings.push({ tone: 'warn', filter: { status: 'ONHOLD' }, text: plural(kpis.onHold, 'item is', 'items are') + ' on hold.' });
      var nobody = people.filter(function (p) { return p.name === 'Nobody' && p.open; })[0];
      if (nobody) findings.push({ tone: 'warn', filter: { assignee: 'Nobody' }, text: plural(nobody.open, 'open item has', 'open items have') + ' nobody assigned.' });
      var busiest = people.filter(function (p) { return p.name !== 'Nobody'; })[0];
      if (busiest && open.length && busiest.open / open.length >= 0.4 && people.length > 1) {
        findings.push({ tone: 'info', filter: { assignee: busiest.name }, text: busiest.name + ' holds ' + busiest.open + ' of the ' + open.length + ' open items (' + pct(busiest.open, open.length) + '%): a bottleneck risk.' });
      }
      var heavy = epics.filter(function (e) { return e.open; })[0];
      if (heavy) findings.push({ tone: 'info', filter: { epic: heavy.key }, text: 'Most open work: ' + (heavy.key ? heavy.key + ' ' : '') + heavy.name + ' (' + heavy.open + ' open of ' + heavy.total + ').' });
      var big = checkMap.big;
      if (big) findings.push({ tone: 'info', filter: { check: 'big' }, text: plural(big.count, 'story is', 'stories are') + ' large (more than ' + BIG_AC + ' checks in the criteria): worth splitting.' });
      if (kpis.done === total) findings.push({ tone: 'good', filter: {}, text: 'Everything here is done.' });
    }

    return { kpis: kpis, statuses: statuses, epics: epics, releases: releases, people: people, sprints: sprints, checks: checks, fdd: fdd,
      gaps: gaps, findings: findings, today: t };
  }

  /**
   * The rows a set of filters keeps: { text, status, epic, assignee, release, sprint, priority, type, check,
   * only: 'overdue' | 'gaps' | 'open' | '' } ('' = any; assignee 'Nobody', epic '' with noEpic …).
   */
  function filter(rows, f) {
    var c = f || {};
    var words = txt(c.text).toLowerCase().split(/\s+/).filter(function (w) { return !!w; });
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (c.status && r.status !== c.status) return false;
      if (c.epic && r.epicKey !== c.epic && !(c.epic === 'none' && !r.epicKey)) return false;
      if (c.assignee && (r.assignee || 'Nobody') !== c.assignee) return false;
      if (c.release && (r.release || 'No release') !== c.release) return false;
      if (c.sprint && (r.sprint || 'No sprint') !== c.sprint) return false;
      if (c.priority && r.priority !== c.priority) return false;
      if (c.type && r.type !== c.type) return false;
      if (c.fdd && !r.fdd.some(function (s) { return s === c.fdd || s.indexOf(c.fdd + '.') === 0 || s.indexOf(c.fdd) === 0; })) return false;
      if (c.check && !r.checks.some(function (k) { return k.key === c.check; })) return false;
      if (c.only === 'overdue' && !r.overdue) return false;
      if (c.only === 'gaps' && !r.gaps.length) return false;
      if (c.only === 'open' && r.statusCat === 'done') return false;
      if (words.length) {
        var hay = [r.key, r.summary, r.epicName, r.assignee, r.status, r.body, r.ac, r.fdd.join(' '), r.gaps.join(' ')].join(' ').toLowerCase();
        if (!words.every(function (w) { return hay.indexOf(w) !== -1; })) return false;
      }
      return true;
    });
  }

  /** The options a filter offers, from the rows: [{ value, label: 'X (3)' }], most first (status in workflow order). */
  function options(rows, field) {
    var list = Array.isArray(rows) ? rows : [];
    var keyOf = {
      status: function (r) { return r.status; }, epic: function (r) { return r.epicKey || 'none'; }, assignee: function (r) { return r.assignee || 'Nobody'; },
      release: function (r) { return r.release || 'No release'; }, sprint: function (r) { return r.sprint || 'No sprint'; },
      priority: function (r) { return r.priority; }, type: function (r) { return r.type; }
    }[field];
    if (!keyOf) return [];
    var names = {};
    list.forEach(function (r) { if (field === 'epic') names[r.epicKey || 'none'] = r.epicKey ? r.epicKey + ' ' + r.epicName : 'No epic'; });
    var counts = countBy(list, keyOf);
    return Object.keys(counts).filter(function (k) { return k !== ''; })
      .sort(function (a, b) { return field === 'status' ? statusIndex(a) - statusIndex(b) : (counts[b] - counts[a] || a.localeCompare(b)); })
      .map(function (k) { return { value: k, label: (names[k] || k) + ' (' + counts[k] + ')' }; });
  }

  // ── The connection ───────────────────────────────────────────────────────────────────────────────────────
  // Deployed in VBCS, the jira backend's Basic authentication (a Jira email and an API token) is set by the VBCS
  // administrator. In the desktop app, the person connects on the page: the desktop app keeps the token on the PC
  // (/__jira/settings) and adds it to the calls; the page never holds it. Outside the desktop app /__jira/ is not there.

  async function desktop(pathPart, body) {
    if (typeof fetch !== 'function') return null;
    try {
      var r = await fetch('/__jira/' + pathPart, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
        headers: { 'X-EquipRite-Jira': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }
  /** The desktop app's Jira connection: { site, email, hasToken, connected }, or null outside the desktop app. */
  function desktopSettings() { return desktop('settings'); }
  /** Connect Jira in the desktop app: { site, email, token } (an empty token keeps the saved one); { error } when refused. */
  function desktopSave(o) { return desktop('settings', o || {}); }
  /** Disconnect: the email and token removed from this PC. */
  function desktopForget() { return desktop('forget', {}); }

  /** Who the connection signs in as (services/jira getJiraMyself): { ok, name, email, status, message }. */
  async function whoAmI(context, Actions) {
    var res;
    try {
      res = await Actions.callRest(context, { endpoint: 'jira/getJiraMyself' });
    } catch (e) {
      res = { ok: false, status: 0, body: { message: txt(e && e.message) } };
    }
    if (!res || !res.ok) return { ok: false, name: '', email: '', status: res ? res.status : 0, message: problem(res) };
    var b = res.body || {};
    return { ok: true, name: b.displayName || b.emailAddress || '', email: b.emailAddress || '', status: 200, message: '' };
  }

  /** The export: a row per item, every column the page shows and what it found. */
  function exportColumns() {
    return [
      { key: 'key', label: 'Key' }, { key: 'summary', label: 'Summary' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' }, { key: 'epicKey', label: 'Epic' }, { key: 'epicName', label: 'Epic name' }, { key: 'assignee', label: 'Assignee' },
      { key: 'release', label: 'Release' }, { key: 'releaseDate', label: 'Release date' }, { key: 'sprint', label: 'Sprint' }, { key: 'due', label: 'Due' },
      { key: 'overdue', label: 'Overdue', value: function (r) { return r.overdue ? 'Yes' : ''; } },
      { key: 'fdd', label: 'FDD sections', value: function (r) { return r.fdd.join(', '); } },
      { key: 'score', label: 'Quality (1-5)', type: 'number' },
      { key: 'checks', label: 'Checks failed', value: function (r) { return r.checks.map(function (c) { return c.label; }).join('; '); } },
      { key: 'gaps', label: 'Tester gaps', value: function (r) { return r.gaps.join('; '); } },
      { key: 'ac', label: 'Acceptance criteria' }, { key: 'updated', label: 'Updated' }, { key: 'url', label: 'Link' }
    ];
  }

  return {
    SITE: SITE, PROJECT: PROJECT, FIELDS: FIELDS, PRESETS: PRESETS, CHECKS: CHECKS, STATUS_ORDER: STATUS_ORDER,
    plain: plain, splitDescription: splitDescription, fddSections: fddSections, gapsFrom: gapsFrom, acChecks: acChecks,
    fromIssue: fromIssue, load: load, problem: problem, analyse: analyse, filter: filter, options: options, exportColumns: exportColumns,
    desktopSettings: desktopSettings, desktopSave: desktopSave, desktopForget: desktopForget, whoAmI: whoAmI
  };
});
