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
    'comment', 'customfield_10020', 'labels', 'created', 'updated', 'resolutiondate', 'subtasks', 'attachment'];
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
    releasePassed: { label: 'Its release date has passed', weight: 0.5 },
    sprintEnded: { label: 'Its sprint has ended and it is not done', weight: 0.5 },
    carried: { label: 'Carried over from an earlier sprint', weight: 0.5 }
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

  /**
   * The images a text shows, by Jira's wiki markup (!name.png|width=650,alt="…"! or !name.png!), and the text without
   * them: { text, names }. The names are attachments of the story (the page loads them through the jira connection).
   */
  function extractImages(t) {
    var names = [];
    var text = txt(t).replace(/!([^!\n|]+?\.(?:png|jpe?g|gif|bmp|webp|svg))(?:\|[^!\n]*)?!/gi, function (m, name) {
      if (names.indexOf(name) === -1) names.push(name);
      return '';
    });
    return { text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), names: names };
  }

  /** A story's attachments: [{ id, name, mime, size, sizeText, created, author, image }]. */
  function attachmentsOf(list) {
    return (Array.isArray(list) ? list : []).map(function (a) {
      var size = Number(a.size) || 0;
      return { id: a.id != null ? String(a.id) : '', name: a.filename || '', mime: a.mimeType || '', size: size,
        sizeText: size >= 1048576 ? (Math.round(size / 104857.6) / 10) + ' MB' : (Math.max(1, Math.round(size / 1024)) + ' KB'),
        created: day(a.created), author: nameOf(a.author), image: /^image\//i.test(a.mimeType || '') || /\.(png|jpe?g|gif|bmp|webp)$/i.test(a.filename || '') };
    });
  }

  /** The images a text names, matched to the story's attachments: [{ id, name }] (id '' when not attached). */
  function imagesFor(names, attachments) {
    return names.map(function (n) {
      var a = attachments.filter(function (x) { return x.name === n; })[0];
      return { id: a ? a.id : '', name: n };
    });
  }

  /** A tester's gaps from a comment: its numbered or bulleted lines ("1. Type column is missing."), else nothing. */
  function gapsFrom(comment) {
    var lines = readable(comment).split(/\n+/).map(function (s) { return s.trim(); });
    return lines.filter(function (s) { return /^(\d+[.)]|[-*•])\s+\S/.test(s); })
      .map(function (s) { return s.replace(/^(\d+[.)]|[-*•])\s+/, '').replace(/\s*\(FDD-[^)]*\)\s*$/, '').trim(); })
      .filter(function (s) { return s.length > 2; });
  }

  function nameOf(u) { return u && (u.displayName || u.emailAddress || u.name) ? (u.displayName || u.emailAddress || u.name) : ''; }

  /**
   * Every sprint a story has been in (Jira's Sprint field, oldest first): [{ id, name, state, start, end, done, goal }].
   * Jira Cloud sends objects; an older server sends strings like "…[id=5,state=ACTIVE,name=2026-07,startDate=…]".
   */
  function sprintsOf(v) {
    var list = Array.isArray(v) ? v : (v ? [v] : []);
    return list.map(function (s) {
      if (typeof s === 'string') {
        var get = function (k) { var m = new RegExp(k + '=([^,\\]]*)').exec(s); return m && m[1] !== '<null>' ? m[1] : ''; };
        return { id: get('id'), name: get('name') || s, state: get('state').toLowerCase(), start: day(get('startDate')), end: day(get('endDate')),
          done: day(get('completeDate')), goal: get('goal'), board: get('rapidViewId') };
      }
      return { id: s.id != null ? String(s.id) : '', name: s.name || '', state: txt(s.state).toLowerCase(), start: day(s.startDate), end: day(s.endDate),
        done: day(s.completeDate), goal: txt(s.goal), board: s.boardId != null ? String(s.boardId) : '' };
    }).filter(function (x) { return !!x.name; });
  }

  /** The sprint a story is in now: the last of its sprints. */
  function sprintOf(v) {
    var list = sprintsOf(v);
    return list[list.length - 1] || { id: '', name: '', state: '', start: '', end: '', done: '', goal: '', board: '' };
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
    var attachments = attachmentsOf(f.attachment);
    var desc = extractImages(plain(f.description));
    var parts = splitDescription(f.summary, desc.text);
    var comments = ((f.comment && f.comment.comments) || []).map(function (c) {
      var ex = extractImages(plain(c.body));
      return { author: nameOf(c.author), when: day(c.created), text: readable(ex.text), images: imagesFor(ex.names, attachments) };
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
      sprint: sp.name, sprintId: sp.id, sprintBoard: sp.board, sprintState: sp.state, sprintStart: sp.start, sprintEnd: sp.end, sprintGoal: sp.goal,
      sprintPast: sprintsOf(f.customfield_10020).slice(0, -1).map(function (x) { return x.name; }),
      sprintList: sprintsOf(f.customfield_10020),
      due: due, overdue: !!(due && due < today && !done),
      created: day(f.created), updated: updated, resolved: day(f.resolutiondate), idleDays: updated ? daysBetween(updated, today) : null,
      fdd: parts.fdd, body: parts.body, ac: parts.ac, acChecks: acChecks(parts.ac).length,
      comments: comments, gaps: gaps, subtasks: (f.subtasks || []).length,
      attachments: attachments, bodyImages: imagesFor(desc.names, attachments)
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
      if (row.sprint && row.sprintEnd && row.sprintEnd < today) add('sprintEnded');
      if (row.sprintPast.length) add('carried');
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
      var body = res.body;
      // A search answers { issues: [...] }. Anything else (a web page, an empty answer) did not come from Jira's search:
      // said, never read as "no items".
      if (!body || typeof body !== 'object' || !Array.isArray(body.issues)) {
        return { ok: false, issues: issues, status: 502, message: notJira(body, 'search') };
      }
      issues = issues.concat(body.issues || []);
      token = body.nextPageToken || '';
      if (body.isLast !== false || !token) return { ok: true, issues: issues, status: 200, message: '', capped: false };
    }
    return { ok: true, issues: issues, status: 200, message: 'Stopped after ' + issues.length + ' issues: narrow the search.', capped: true };
  }

  /** A 200 that is not Jira's data, in words: a web page (the call went somewhere else), or nothing. */
  function notJira(body, what) {
    if (typeof body === 'string' && /<html|<!doctype/i.test(body)) {
      return 'The call did not reach Jira: it came back with a web page, not Jira\'s ' + what + '. Check the jira service connection\'s address (Services > Backends > jira).';
    }
    return 'Jira\'s answer was not a ' + what + ' result' + (typeof body === 'string' && body ? ' ("' + body.slice(0, 60) + '…")' : '') + '. Check the jira service connection.';
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
   *   customers [{ name, label, total, done, open, overdue, donePct }] by the story labels, most open first, No label last
   *   sprints   [{ name, state, start, end, goal, total, done, open, donePct, overdue, carried, daysLeft, flags }]: active, future,
   *             then closed (latest first), No sprint last
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

    // By customer: a story's labels are its customers (cianbro, oceaneering, …). A story can carry more than one
    // label, so it is counted under each; stories with none fall into "No label" (last). Because of the shared
    // stories, the customer totals can add up to more than the item count.
    var custBy = {};
    var custOrder = [];
    list.forEach(function (r) {
      var labs = (r.labels && r.labels.length) ? r.labels : [''];
      labs.forEach(function (lab) {
        if (!custBy[lab]) { custBy[lab] = { name: lab || 'No label', label: lab, rows: [] }; custOrder.push(custBy[lab]); }
        custBy[lab].rows.push(r);
      });
    });
    var customers = custOrder.map(function (g) {
      var o = g.rows.filter(function (r) { return !isDone(r); });
      return { name: g.name, label: g.label, total: g.rows.length, done: g.rows.length - o.length, open: o.length,
        overdue: g.rows.filter(function (r) { return r.overdue; }).length, donePct: pct(g.rows.length - o.length, g.rows.length) };
    }).sort(function (a, b) {
      if ((a.name === 'No label') !== (b.name === 'No label')) return a.name === 'No label' ? 1 : -1;
      return b.open - a.open || b.total - a.total || a.name.localeCompare(b.name);
    });

    // Sprints: each with its dates, state and goal (from the stories in it), progress, spill-over, and what is wrong
    // with it on the board (still active after its end, future with an end date gone, work due after it ends).
    var SPRINT_ORDER = { active: 0, future: 1, closed: 2 };
    var sprints = tally(list, function (r) { return r.sprint; }, function (k, r) {
      return { name: k || 'No sprint', id: k ? r.sprintId : '', board: k ? r.sprintBoard : '', state: k ? r.sprintState : '', start: k ? r.sprintStart : '',
        end: k ? r.sprintEnd : '', goal: k ? r.sprintGoal : '', rows: [] };
    }).map(function (g) {
      var o = g.rows.filter(function (r) { return !isDone(r); });
      var flags = [];
      var named = g.name !== 'No sprint';
      if (named && g.state === 'active' && g.end && g.end < t) flags.push('Still active, ended ' + g.end);
      if (named && g.state === 'future' && g.end && g.end < t) flags.push('Future, but its end date (' + g.end + ') has passed');
      if (named && g.state === 'closed' && o.length) flags.push(plural(o.length, 'item') + ' left open when it closed');
      var lateDue = named && g.end ? o.filter(function (r) { return r.due && r.due > g.end; }).length : 0;
      if (lateDue) flags.push(plural(lateDue, 'item') + ' due after it ends');
      var earlyDue = named && g.start ? o.filter(function (r) { return r.due && r.due < g.start; }).length : 0;
      if (earlyDue) flags.push(plural(earlyDue, 'item') + ' due before it starts');
      var left = g.state === 'active' && g.end && g.end >= t ? daysBetween(t, g.end) : null;
      return { name: g.name, id: g.id, board: g.board, state: g.state, start: g.start, end: g.end, goal: g.goal, total: g.rows.length, done: g.rows.length - o.length, open: o.length,
        donePct: pct(g.rows.length - o.length, g.rows.length), overdue: g.rows.filter(function (r) { return r.overdue; }).length,
        carried: o.filter(function (r) { return r.sprintPast.length > 0; }).length, daysLeft: left, flags: flags };
    }).sort(function (a, b) {
      if ((a.name === 'No sprint') !== (b.name === 'No sprint')) return a.name === 'No sprint' ? 1 : -1;
      var sa = SPRINT_ORDER[a.state] == null ? 3 : SPRINT_ORDER[a.state];
      var sb = SPRINT_ORDER[b.state] == null ? 3 : SPRINT_ORDER[b.state];
      if (sa !== sb) return sa - sb;
      return sa === 2 ? (b.end || '').localeCompare(a.end || '') : (a.start || a.name).localeCompare(b.start || b.name);
    });

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
      sprints.filter(function (sp) { return sp.state === 'active' && sp.end && sp.end < t; }).forEach(function (sp) {
        findings.push({ tone: 'bad', filter: { sprint: sp.name }, text: 'Sprint ' + sp.name + ' is still active although it ended on ' + sp.end + ' (' + plural(sp.open, 'item') + ' open): close it and move the work on.' });
      });
      sprints.filter(function (sp) { return sp.state === 'active' && sp.daysLeft !== null; }).forEach(function (sp) {
        findings.push({ tone: sp.donePct < 50 && sp.daysLeft <= 3 ? 'warn' : 'info', filter: { sprint: sp.name },
          text: 'Sprint ' + sp.name + ': ' + sp.done + ' of ' + sp.total + ' done (' + sp.donePct + '%), ' + (sp.daysLeft === 0 ? 'ends today' : plural(sp.daysLeft, 'day') + ' left') + '.' });
      });
      var staleFuture = sprints.filter(function (sp) { return sp.state === 'future' && sp.end && sp.end < t; });
      if (staleFuture.length) {
        findings.push({ tone: 'warn', filter: { sprint: staleFuture[0].name }, text: plural(staleFuture.length, 'future sprint has', 'future sprints have') + ' an end date already past ('
          + staleFuture.map(function (sp) { return sp.name; }).slice(0, 4).join(', ') + '): the sprint plan is out of date.' });
      }
      var carried = open.filter(function (r) { return r.sprintPast.length > 0; });
      if (carried.length) findings.push({ tone: 'warn', filter: { check: 'carried' }, text: plural(carried.length, 'open item was', 'open items were') + ' carried over from an earlier sprint.' });
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

    return { kpis: kpis, statuses: statuses, epics: epics, releases: releases, people: people, customers: customers, sprints: sprints, checks: checks, fdd: fdd,
      gaps: gaps, findings: findings, today: t };
  }

  /**
   * The rows a set of filters keeps: { text, status, epic, assignee, release, sprint, label, priority, type, check,
   * only: 'overdue' | 'gaps' | 'open' | '' } ('' = any; assignee 'Nobody', epic '' with noEpic, label 'none' = no labels …).
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
      if (c.label) {
        if (c.label === 'none') { if ((r.labels || []).length) return false; }
        else if (!(r.labels || []).some(function (x) { return x === c.label; })) return false;
      }
      if (c.priority && r.priority !== c.priority) return false;
      if (c.type && r.type !== c.type) return false;
      if (c.fdd && !r.fdd.some(function (s) { return s === c.fdd || s.indexOf(c.fdd + '.') === 0 || s.indexOf(c.fdd) === 0; })) return false;
      if (c.check && !r.checks.some(function (k) { return k.key === c.check; })) return false;
      if (c.only === 'overdue' && !r.overdue) return false;
      if (c.only === 'gaps' && !r.gaps.length) return false;
      if (c.only === 'open' && r.statusCat === 'done') return false;
      if (words.length) {
        var hay = [r.key, r.summary, r.epicName, r.assignee, r.status, r.body, r.ac, r.fdd.join(' '), r.gaps.join(' '), (r.labels || []).join(' ')].join(' ').toLowerCase();
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

  // ── One sprint (its own tab in Next, its own page in Old) ────────────────────────────────────────────────
  /** Every item that has been in a sprint (Jira's "sprint = id" also finds what moved on to a later sprint). */
  function sprintJql(sprint) {
    var s = sprint || {};
    return 'project = ' + PROJECT + ' AND sprint = ' + (s.id ? s.id : '"' + txt(s.name).replace(/"/g, '\\"') + '"') + ' ORDER BY status ASC, key ASC';
  }

  /** The sprint in Jira: its board while it runs, its sprint report once closed. */
  function sprintUrl(site, sprint) {
    var s = sprint || {};
    var base = (site || SITE).replace(/\/$/, '');
    if (!s.board || !s.id) return base + '/issues/?jql=' + encodeURIComponent(sprintJql(s));
    var board = base + '/jira/software/projects/' + PROJECT + '/boards/' + s.board;
    return s.state === 'closed' ? board + '/reports/sprint-retrospective?sprint=' + s.id : (s.state === 'future' ? board + '/backlog' : board + '?sprint=' + s.id);
  }

  /**
   * The report for one sprint, from the items "sprint = id" finds (rows) and the sprint asked for ({ id, name }):
   *   sprint   { id, name, board, state, start, end, done, goal } as Jira has it on the items
   *   kpis     { total, done, open, donePct, overdue, carriedOut, carriedIn, unassigned, days, dayText }
   *   burnup   [{ day, label, done, pct, today, weekend }] a day each from its start to its end (or today), done by then
   *   statuses, people [{ name, total, done, open, overdue }], flags [..], findings [{ tone, text }]
   *   rows     the items, each with in: 'here' (still in this sprint), 'moved' (carried on to sprintNow) or 'done'
   */
  function sprintReport(rows, want, today) {
    var t = todayOf(today);
    var w = want || {};
    var list = Array.isArray(rows) ? rows : [];
    var isDone = function (r) { return r.statusCat === 'done'; };
    var info = null;
    list.forEach(function (r) {
      (r.sprintList || []).forEach(function (x) {
        if (!info && ((w.id && x.id === String(w.id)) || (!w.id && x.name === w.name))) info = x;
      });
    });
    info = info || { id: w.id || '', name: w.name || '', state: '', start: '', end: '', done: '', goal: '', board: '' };
    var idx = function (r) {
      var l = r.sprintList || [];
      for (var i = 0; i < l.length; i++) if ((info.id && l[i].id === info.id) || (!info.id && l[i].name === info.name)) return i;
      return -1;
    };
    var items = list.map(function (r) {
      var i = idx(r);
      var last = (r.sprintList || []).length - 1;
      var moved = i !== -1 && i < last;
      return Object.assign({}, r, { in: isDone(r) && !moved ? 'done' : (moved ? 'moved' : 'here'), sprintNow: moved ? r.sprint : '', carriedIn: i > 0 });
    });
    var open = items.filter(function (r) { return !isDone(r); });
    var doneN = items.length - open.length;
    var carriedOut = items.filter(function (r) { return r.in === 'moved'; });
    var carriedIn = items.filter(function (r) { return r.carriedIn; });
    var endOrToday = info.end && info.end < t ? info.end : t;
    var days = info.start ? daysBetween(info.start, info.end || t) + 1 : null;
    var left = info.end && info.state !== 'closed' && info.end >= t ? daysBetween(t, info.end) : null;
    var ago = info.end && info.end < t ? daysBetween(info.end, t) : null;
    var kpis = {
      total: items.length, done: doneN, open: open.length, donePct: pct(doneN, items.length),
      overdue: items.filter(function (r) { return r.overdue; }).length, carriedOut: carriedOut.length, carriedIn: carriedIn.length,
      unassigned: open.filter(function (r) { return !r.assignee; }).length, days: days,
      dayText: left !== null ? (left === 0 ? 'Ends today' : plural(left, 'day') + ' left') : (ago !== null ? (info.state === 'closed' ? 'Closed, ended ' : 'Ended ') + plural(ago, 'day') + ' ago' : (info.start && info.start > t ? 'Starts ' + info.start : ''))
    };

    // Burn-up: how many were done by each day of the sprint (by when each was resolved), against everything in it.
    var burnup = [];
    if (info.start) {
      var stop = endOrToday < info.start ? info.start : endOrToday;
      var d0 = Date.UTC(+info.start.slice(0, 4), +info.start.slice(5, 7) - 1, +info.start.slice(8, 10));
      var n = Math.min(92, daysBetween(info.start, stop) + 1);
      for (var k = 0; k < n; k++) {
        var dt = new Date(d0 + k * 86400000);
        var ds = dt.toISOString().slice(0, 10);
        var by = items.filter(function (r) { return isDone(r) && r.resolved && r.resolved <= ds; }).length;
        burnup.push({ day: ds, label: ds.slice(8, 10) + '/' + ds.slice(5, 7), done: by, pct: pct(by, items.length), today: ds === t, weekend: dt.getUTCDay() === 0 || dt.getUTCDay() === 6 });
      }
    }

    var a = analyse(items, t);
    var flags = [];
    if (info.state === 'active' && info.end && info.end < t) flags.push('Still active, ended ' + info.end + ': close it in Jira and move what is open to the next sprint.');
    if (info.state === 'future' && info.end && info.end < t) flags.push('Future, but its end date (' + info.end + ') has passed: re-plan its dates.');
    if (info.state === 'closed' && open.filter(function (r) { return r.in === 'here'; }).length) flags.push(plural(open.filter(function (r) { return r.in === 'here'; }).length, 'item') + ' still in it although it closed.');
    var lateDue = info.end ? open.filter(function (r) { return r.due && r.due > info.end; }).length : 0;
    if (lateDue) flags.push(plural(lateDue, 'open item is', 'open items are') + ' due after it ends.');

    var findings = [];
    if (items.length) {
      findings.push({ tone: kpis.donePct >= 80 ? 'good' : (kpis.donePct >= 50 ? 'info' : 'warn'), text: doneN + ' of ' + items.length + ' done (' + kpis.donePct + '%)' + (kpis.dayText ? ', ' + kpis.dayText.toLowerCase() : '') + '.' });
      if (carriedOut.length) findings.push({ tone: 'warn', text: plural(carriedOut.length, 'item was', 'items were') + ' carried on to a later sprint (' + carriedOut.map(function (r) { return r.sprintNow; }).filter(function (x, i, l) { return x && l.indexOf(x) === i; }).join(', ') + ').' });
      if (carriedIn.length) findings.push({ tone: 'info', text: plural(carriedIn.length, 'item came', 'items came') + ' in from an earlier sprint.' });
      if (kpis.overdue) findings.push({ tone: 'bad', text: plural(kpis.overdue, 'item is', 'items are') + ' past their due date.' });
      if (kpis.unassigned) findings.push({ tone: 'warn', text: plural(kpis.unassigned, 'open item has', 'open items have') + ' nobody assigned.' });
      var busiest = a.people.filter(function (p) { return p.name !== 'Nobody'; })[0];
      if (busiest && open.length > 2 && busiest.open / open.length >= 0.5) findings.push({ tone: 'info', text: busiest.name + ' holds ' + busiest.open + ' of the ' + open.length + ' open items.' });
      var noResolved = items.filter(function (r) { return isDone(r) && !r.resolved; }).length;
      if (noResolved) findings.push({ tone: 'info', text: plural(noResolved, 'done item has', 'done items have') + ' no resolution date, so the burn-up leaves them out.' });
    }
    return { sprint: info, kpis: kpis, burnup: burnup, statuses: a.statuses, people: a.people, flags: flags, findings: findings, rows: items,
      url: sprintUrl(SITE, info) };
  }

  // ── Images (the screenshots attached to a story) ─────────────────────────────────────────────────────────
  // Each is read through the jira connection (getJiraAttachmentContent, redirect=false) as a file, so the signed-in
  // connection goes with it, and shown from memory (an object URL). Read once per page visit.
  var imageCache = {};

  /** One attachment as something an <img> can show: its URL, or '' when it could not be read. */
  async function loadImage(context, Actions, id) {
    if (!id) return '';
    if (imageCache[id]) return imageCache[id];
    var res;
    try {
      res = await Actions.callRest(context, { endpoint: 'jira/getJiraAttachmentContent', uriParams: { id: id, redirect: false }, responseBodyFormat: 'blob' });
    } catch (e) {
      return '';
    }
    if (!res || !res.ok || !res.body) return '';
    var b = res.body;
    var url = '';
    if (typeof Blob !== 'undefined' && b instanceof Blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') url = URL.createObjectURL(b);
    else if (typeof b === 'string' && /^data:image\//.test(b)) url = b;
    if (url) imageCache[id] = url;
    return url;
  }

  /** Every image attached to a story (at most 24), as { id: url } ('' for one that could not be read). */
  async function loadImages(context, Actions, row) {
    var ids = ((row && row.attachments) || []).filter(function (a) { return a.image && a.id; }).slice(0, 24).map(function (a) { return a.id; });
    var urls = await Promise.all(ids.map(function (id) { return loadImage(context, Actions, id); }));
    var out = {};
    ids.forEach(function (id, i) { out[id] = urls[i]; });
    return out;
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

  /**
   * Who the connection signs in as (services/jira getJiraMyself): { ok, name, email, status, message }. ok only when
   * Jira names the signed-in account; 401 when it answers without one (not signed in), 502 when it was not Jira.
   */
  async function whoAmI(context, Actions) {
    var res;
    try {
      res = await Actions.callRest(context, { endpoint: 'jira/getJiraMyself' });
    } catch (e) {
      res = { ok: false, status: 0, body: { message: txt(e && e.message) } };
    }
    if (!res || !res.ok) return { ok: false, name: '', email: '', status: res ? res.status : 0, message: problem(res) };
    var b = res.body;
    if (typeof b === 'string' && /<html|<!doctype/i.test(b)) return { ok: false, name: '', email: '', status: 502, message: notJira(b, 'account details') };
    // Signed in, Jira names the account (accountId). An answer without one is not a signed-in user: the email and token
    // are missing or wrong (Jira then sees nothing, and every search comes back empty).
    if (!b || typeof b !== 'object' || !b.accountId) {
      return { ok: false, name: '', email: '', status: 401,
        message: 'Jira answered, but not for a signed-in user: the email and API token are missing or not accepted. Connect Jira again (desktop app), or ask the VBCS administrator to set the jira backend\'s Basic authentication.' };
    }
    return { ok: true, name: b.displayName || b.emailAddress || '', email: b.emailAddress || '', status: 200, message: '' };
  }

  /** The export: a row per item, every column the page shows and what it found. */
  function exportColumns() {
    return [
      { key: 'key', label: 'Key' }, { key: 'summary', label: 'Summary' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' }, { key: 'epicKey', label: 'Epic' }, { key: 'epicName', label: 'Epic name' }, { key: 'assignee', label: 'Assignee' },
      { key: 'labels', label: 'Customer', value: function (r) { return (r.labels || []).join(', '); } },
      { key: 'release', label: 'Release' }, { key: 'releaseDate', label: 'Release date' }, { key: 'sprint', label: 'Sprint' },
      { key: 'sprintEnd', label: 'Sprint ends' }, { key: 'sprintPast', label: 'Earlier sprints', value: function (r) { return r.sprintPast.join(', '); } }, { key: 'due', label: 'Due' },
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
    extractImages: extractImages, loadImage: loadImage, loadImages: loadImages, sprintsOf: sprintsOf, sprintJql: sprintJql, sprintUrl: sprintUrl, sprintReport: sprintReport, fromIssue: fromIssue, load: load, problem: problem, analyse: analyse, filter: filter, options: options, exportColumns: exportColumns,
    desktopSettings: desktopSettings, desktopSave: desktopSave, desktopForget: desktopForget, whoAmI: whoAmI
  };
});
