define([], function () {
  'use strict';

  // Jira · Daily progress (Build.Rite and Next: Jira stories → Daily progress): what moved in Jira day by day — stories
  // closed, new, reopened, moved between statuses, touched (any change, a comment), by whom — over the last days, read
  // with one search (services/jira searchJiraIssues: the issues updated in the window, with their changelog and comments)
  // and worked out here; and the stuck ones (open, no change for days: a second, small search). Pure but load().
  //
  // A story is "closed" on the day its status moved into a done status (Jira's status category Done, learnt from the
  // stories read; else by its name: Done, Closed, Resolved…), "reopened" when it moved out of one, "moved" for any other
  // status change. A story closed twice the same day counts once. Days are this PC's days.
  var DAY = 86400000;
  var PROJECT = 'EQP';
  var RANGES = [7, 14, 30, 60];
  var STUCK_DAYS = 5;
  var NOISE = /^(rank|worklogid|timespent|timeestimate|timeoriginalestimate|remoteissuelink|workflow|aggregate.*)$/i;
  var FIELDS = ['summary', 'issuetype', 'status', 'priority', 'assignee', 'reporter', 'creator', 'created', 'updated', 'resolutiondate', 'comment'];
  var DONE_NAME = /^(done|closed|resolved|complete|completed|released|deployed|cancel+ed|won'?t (do|fix)|rejected|duplicate)$/i;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var txt = function (v) { return v === undefined || v === null ? '' : String(v); };
  var name = function (u) { return u ? txt(u.displayName || u.name || u.emailAddress) : ''; };
  var t = function (s) { var n = Date.parse(s); return isNaN(n) ? 0 : n; };
  var p2 = function (x) { return (x < 10 ? '0' : '') + x; };
  var clampDays = function (d) { var n = Math.round(Number(d) || 14); return Math.max(1, Math.min(60, n)); };
  /** 'YYYY-MM-DD' of a moment, in this PC's time. */
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function midnight(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function hhmm(ms) { var d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  /** "Tue 10 Nov" (and the year when asked). */
  function dayLabel(ms, year) { var d = new Date(ms); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + (year ? ' ' + d.getFullYear() : ''); }
  /** A comment's words, plain and short (Jira wiki or Atlassian document format). */
  function plain(body) {
    var s = '';
    if (typeof body === 'string') s = body;
    else if (body && typeof body === 'object') { var walk = function (n) { if (!n) return; if (n.text) s += n.text; (n.content || []).forEach(walk); if (n.type === 'paragraph') s += ' '; }; walk(body); }
    s = s.replace(/\[~accountid:[^\]]+\]/g, '@someone').replace(/\{[a-z]+(:[^}]*)?\}/g, '').replace(/!([^!|\s]+)(\|[^!]*)?!/g, '[image]')
      .replace(/\[([^|\]]+)\|[^\]]+\]/g, '$1').replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1').replace(/\s+/g, ' ').trim();
    return s.length > 140 ? s.slice(0, 137) + '…' : s;
  }

  /** Is a status a done one? Learnt from the stories' own statuses (their category), else by its name. */
  function doneTest(issues) {
    var m = {};
    (issues || []).forEach(function (is) {
      var s = is && is.fields && is.fields.status;
      if (s && s.name && s.statusCategory && s.statusCategory.key) m[txt(s.name).toLowerCase()] = s.statusCategory.key === 'done';
    });
    return function (status) { var k = txt(status).trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : DONE_NAME.test(k); };
  }

  /** The window's days, oldest first: { key, at (its midnight), label, weekend, today }. */
  function daysOf(n, now) {
    var out = [];
    var m0 = midnight(now);
    for (var i = n - 1; i >= 0; i--) {
      var at = midnight(m0 - i * DAY + 3 * 3600000); // a day back, whatever the clocks did
      var d = new Date(at);
      out.push({ key: dayKey(at), at: at, label: dayLabel(at), long: dayLabel(at, true), weekend: d.getDay() === 0 || d.getDay() === 6, today: i === 0 });
    }
    return out;
  }

  /**
   * Day by day: { days: [{ key, label, long, weekend, today, closed, created, reopened, moved, touched, comments, assigned,
   * closedSoFar, createdSoFar, stories: { closed: [], created: [], reopened: [], moved: [], updated: [] } }],
   * totals: { closed, created, reopened, moved, net, touched, comments, workdays, perDay, best }, people: [{ name, closed,
   * moved, created, comments, other, total }], max, from, to, n, read }.
   */
  function progressOf(issues, opts) {
    var o = opts || {};
    var now = o.now || Date.now();
    var n = clampDays(o.days);
    var days = daysOf(n, now);
    var since = days[0].at;
    var isDone = doneTest(issues);
    var at = {};
    days.forEach(function (d) {
      at[d.key] = d;
      d.events = [];
      d.byStory = {};
    });
    var people = {};
    var person = function (who) { if (!who) return null; if (!people[who]) people[who] = { name: who, closed: 0, moved: 0, created: 0, comments: 0, other: 0 }; return people[who]; };
    (issues || []).forEach(function (is) {
      var f = (is && is.fields) || {};
      var base = { key: txt(is.key), summary: txt(f.summary), type: f.issuetype ? txt(f.issuetype.name) : 'Issue', status: f.status ? txt(f.status.name) : '',
        assignee: name(f.assignee), priority: f.priority ? txt(f.priority.name) : '' };
      base.done = isDone(base.status);
      var add = function (when, e) {
        var ms = t(when);
        if (ms < since || ms > now + 60000) return;
        var d = at[dayKey(ms)];
        if (!d) return;
        var ev = { kind: e.kind, at: ms, time: hhmm(ms), by: e.by || '', text: e.text || '', from: e.from || '', to: e.to || '' };
        d.events.push(Object.assign({ key: base.key }, ev));
        var s = d.byStory[base.key] || (d.byStory[base.key] = Object.assign({}, base, { what: [] }));
        s.what.push(ev);
      };
      if (f.created) add(f.created, { kind: 'created', by: name(f.reporter || f.creator), text: 'New ' + base.type.toLowerCase() + (base.priority ? ' · ' + base.priority : '') });
      ((is.changelog && is.changelog.histories) || []).forEach(function (h) {
        (h.items || []).forEach(function (it) {
          var field = txt(it.field), lf = field.toLowerCase();
          if (NOISE.test(field.replace(/\s+/g, '')) || lf === 'resolution') return; // the status change says it
          var from = txt(it.fromString), to = txt(it.toString);
          if (lf === 'status') {
            var kind = isDone(to) && !isDone(from) ? 'closed' : (isDone(from) && !isDone(to) ? 'reopened' : 'moved');
            add(h.created, { kind: kind, by: name(h.author), from: from, to: to, text: (from || '—') + ' → ' + (to || '—') });
          } else if (lf === 'assignee') add(h.created, { kind: 'assigned', by: name(h.author), text: to ? 'Assigned to ' + to : 'Unassigned' });
          else if (lf === 'description') add(h.created, { kind: 'edit', by: name(h.author), text: 'Description changed' });
          else add(h.created, { kind: 'edit', by: name(h.author), text: field.charAt(0).toUpperCase() + field.slice(1) + ': ' + (from ? from + ' → ' : '') + (to || '(cleared)') });
        });
      });
      ((f.comment && f.comment.comments) || []).forEach(function (c) { add(c.created, { kind: 'comment', by: name(c.author), text: plain(c.body) || '(a comment)' }); });
    });
    var soFarClosed = 0, soFarCreated = 0;
    var touchedAll = {};
    var tot = { closed: 0, created: 0, reopened: 0, moved: 0, comments: 0, assigned: 0 };
    days.forEach(function (d) {
      var stories = Object.keys(d.byStory).map(function (k) { var s = d.byStory[k]; s.what.sort(function (a, b) { return a.at - b.at; }); return s; });
      var has = function (s, kind) { return s.what.some(function (w) { return w.kind === kind; }); };
      var line = function (s, kind) { var w = s.what.filter(function (x) { return x.kind === kind; }); var last = w[w.length - 1]; return Object.assign({}, s, { text: last.text, by: last.by, time: last.time, at: last.at }); };
      var byTime = function (a, b) { return b.at - a.at; };
      d.stories = {
        closed: stories.filter(function (s) { return has(s, 'closed'); }).map(function (s) { return line(s, 'closed'); }).sort(byTime),
        created: stories.filter(function (s) { return has(s, 'created'); }).map(function (s) { return line(s, 'created'); }).sort(byTime),
        reopened: stories.filter(function (s) { return has(s, 'reopened') && !has(s, 'closed'); }).map(function (s) { return line(s, 'reopened'); }).sort(byTime),
        moved: stories.filter(function (s) { return has(s, 'moved') && !has(s, 'closed') && !has(s, 'reopened') && !has(s, 'created'); }).map(function (s) { return line(s, 'moved'); }).sort(byTime),
        updated: stories.filter(function (s) { return !has(s, 'closed') && !has(s, 'created') && !has(s, 'reopened') && !has(s, 'moved'); })
          .map(function (s) { var last = s.what[s.what.length - 1]; return Object.assign({}, s, { text: s.what.map(function (w) { return w.kind === 'comment' ? 'Comment: ' + w.text : w.text; }).slice(-3).join(' · '), by: last.by, time: last.time, at: last.at }); }).sort(byTime),
      };
      // who did it: a story closed (or new) once a day, by whoever closed it last; each move, comment and other change
      d.stories.closed.forEach(function (s) { var pp = person(s.by); if (pp) pp.closed++; });
      d.stories.created.forEach(function (s) { var pp = person(s.by); if (pp) pp.created++; });
      d.events.forEach(function (e) { var pp = person(e.by); if (!pp) return; if (e.kind === 'moved' || e.kind === 'reopened') pp.moved++; else if (e.kind === 'comment') pp.comments++; else if (e.kind === 'assigned' || e.kind === 'edit') pp.other++; });
      d.closed = d.stories.closed.length;
      d.created = d.stories.created.length;
      d.reopened = stories.filter(function (s) { return has(s, 'reopened'); }).length;
      d.moved = d.events.filter(function (e) { return e.kind === 'moved'; }).length;
      d.comments = d.events.filter(function (e) { return e.kind === 'comment'; }).length;
      d.assigned = d.events.filter(function (e) { return e.kind === 'assigned'; }).length;
      d.touched = stories.length;
      soFarClosed += d.closed; soFarCreated += d.created;
      d.closedSoFar = soFarClosed; d.createdSoFar = soFarCreated;
      stories.forEach(function (s) { touchedAll[s.key] = true; });
      tot.closed += d.closed; tot.created += d.created; tot.reopened += d.reopened; tot.moved += d.moved; tot.comments += d.comments; tot.assigned += d.assigned;
      delete d.byStory;
    });
    var workdays = days.filter(function (d) { return !d.weekend; }).length || days.length;
    var best = days.reduce(function (b, d) { return !b || d.closed >= b.closed ? (d.closed > 0 ? d : b) : b; }, null);
    tot.net = tot.closed - tot.created;
    tot.touched = Object.keys(touchedAll).length;
    tot.workdays = workdays;
    tot.perDay = Math.round((tot.closed / workdays) * 10) / 10;
    tot.best = best ? { key: best.key, label: best.label, closed: best.closed } : null;
    var list = Object.keys(people).map(function (k) { var p = people[k]; p.total = p.closed + p.moved + p.created + p.comments + p.other; return p; })
      .sort(function (a, b) { return b.closed - a.closed || b.total - a.total || (a.name < b.name ? -1 : 1); });
    var max = days.reduce(function (m, d) { return Math.max(m, d.closed, d.created); }, 0);
    var maxTouched = days.reduce(function (m, d) { return Math.max(m, d.touched); }, 0);
    var maxSoFar = Math.max(soFarClosed, soFarCreated);
    return { days: days, totals: tot, people: list, max: max, maxTouched: maxTouched, maxSoFar: maxSoFar, from: days[0].key, to: days[days.length - 1].key, n: n, read: (issues || []).length };
  }

  /** Open stories with no change for `quiet` days or more, quietest first: [{ key, summary, type, status, assignee, quiet }]. */
  function stuckOf(issues, now, quiet) {
    var q = quiet || STUCK_DAYS;
    var n = now || Date.now();
    var isDone = doneTest(issues);
    return (issues || []).map(function (is) {
      var f = (is && is.fields) || {};
      return { key: txt(is.key), summary: txt(f.summary), type: f.issuetype ? txt(f.issuetype.name) : 'Issue', status: f.status ? txt(f.status.name) : '', assignee: name(f.assignee) || 'Not assigned',
        quiet: Math.floor((n - t(f.updated)) / DAY), done: isDone(f.status ? f.status.name : '') };
    }).filter(function (s) { return !s.done && s.quiet >= q; }).sort(function (a, b) { return b.quiet - a.quiet || (a.key < b.key ? -1 : 1); });
  }

  /** One day as text, for a standup or a chat: the closed, new, reopened and moved stories, and how many were touched. */
  function dayText(d, project) {
    if (!d) return '';
    var row = function (s) { return '  ' + s.key + ' ' + s.summary + (s.text ? ' — ' + s.text : '') + (s.by ? ' (' + s.by + ')' : ''); };
    var part = function (title, l) { return l.length ? [title + ' (' + l.length + '):'].concat(l.map(row)) : []; };
    return [d.long + ' — Jira ' + (project || PROJECT) + ': ' + d.closed + ' closed · ' + d.created + ' new · ' + d.moved + ' moved · ' + d.touched + ' stories touched · ' + d.comments + ' comment' + (d.comments === 1 ? '' : 's')]
      .concat(part('Closed', d.stories.closed), part('New', d.stories.created), part('Reopened', d.stories.reopened), part('Moved', d.stories.moved),
        d.stories.updated.length ? ['Updated: ' + d.stories.updated.map(function (s) { return s.key; }).join(', ')] : []).join('\n');
  }

  /** The window as text: its totals, its best day, who closed most, then a line a day (newest first). */
  function periodText(p, project, stuck) {
    if (!p) return '';
    var tt = p.totals;
    var head = 'Jira ' + (project || PROJECT) + ' · the last ' + p.n + ' days (' + p.days[0].long + ' – ' + p.days[p.days.length - 1].long + '): ' + tt.closed + ' closed, ' + tt.created + ' new (net '
      + (tt.net > 0 ? '+' : '') + tt.net + '), ' + tt.reopened + ' reopened, ' + tt.touched + ' stories touched; ' + tt.perDay + ' closed a working day.';
    var lines = [head];
    if (tt.best) lines.push('Best day: ' + tt.best.label + ' (' + tt.best.closed + ' closed).');
    var top = p.people.filter(function (x) { return x.closed > 0; }).slice(0, 3);
    if (top.length) lines.push('Closed most: ' + top.map(function (x) { return x.name + ' (' + x.closed + ')'; }).join(', ') + '.');
    if (stuck && stuck.length) lines.push('Stuck (open, no change for ' + STUCK_DAYS + '+ days): ' + stuck.length + ' — ' + stuck.slice(0, 5).map(function (s) { return s.key + ' (' + s.quiet + ' d)'; }).join(', ') + (stuck.length > 5 ? '…' : '') + '.');
    lines.push('');
    p.days.slice().reverse().forEach(function (d) {
      if (!d.touched && d.weekend) return;
      lines.push(d.label + ': ' + d.closed + ' closed · ' + d.created + ' new · ' + d.moved + ' moved · ' + d.touched + ' touched' + (d.closed ? ' — ' + d.stories.closed.map(function (s) { return s.key; }).join(', ') : ''));
    });
    return lines.join('\n');
  }

  function jql(days, project) { return 'project = ' + (project || PROJECT) + ' AND updated >= -' + clampDays(days) + 'd ORDER BY updated DESC'; }
  function stuckJql(project, quiet) { return 'project = ' + (project || PROJECT) + ' AND statusCategory != Done AND updated <= -' + (quiet || STUCK_DAYS) + 'd ORDER BY updated ASC'; }

  /** Reads the window from Jira: { ok, progress, stuck, message }. The stuck search failing leaves the progress. */
  async function load(context, Actions, opts) {
    var o = opts || {};
    var days = clampDays(o.days);
    var now = o.now || Date.now();
    var issues = [];
    var token = '';
    var call = async function (params) { try { return await Actions.callRest(context, { endpoint: 'jira/searchJiraIssues', uriParams: params }); } catch (e) { return { ok: false, status: 0, body: { message: txt(e && e.message) } }; } };
    for (var i = 0; i < 10; i++) {
      var params = { jql: jql(days, o.project), fields: FIELDS.join(','), maxResults: 100, expand: 'changelog' };
      if (token) params.nextPageToken = token;
      var res = await call(params);
      if (!res || !res.ok || !res.body || !Array.isArray(res.body.issues)) {
        var s = res ? res.status : 0;
        return { ok: false, notConnected: s === 401 || s === 403, progress: null, stuck: [], message: s === 401 || s === 403 ? 'Jira is not connected (Jira stories → Connect Jira).' : 'Could not read Jira' + (s ? ' (HTTP ' + s + ')' : '') + '.' };
      }
      issues = issues.concat(res.body.issues);
      token = res.body.nextPageToken || '';
      if (res.body.isLast !== false || !token) break;
    }
    var st = await call({ jql: stuckJql(o.project), fields: 'summary,issuetype,status,assignee,updated', maxResults: 100 });
    var stuck = st && st.ok && st.body && Array.isArray(st.body.issues) ? stuckOf(st.body.issues, now) : [];
    return { ok: true, progress: progressOf(issues, { days: days, now: now }), stuck: stuck, stuckRead: !!(st && st.ok), message: '', more: !!token };
  }

  return { progressOf: progressOf, stuckOf: stuckOf, dayText: dayText, periodText: periodText, jql: jql, stuckJql: stuckJql, load: load, daysOf: daysOf, dayKey: dayKey, plain: plain,
    RANGES: RANGES, STUCK_DAYS: STUCK_DAYS, PROJECT: PROJECT };
});
