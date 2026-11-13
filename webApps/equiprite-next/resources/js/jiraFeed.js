define([], function () {
  'use strict';

  // The Jira updates bell (Build.Rite's top bar): what changed in Jira lately — new stories, status changes, assignments,
  // comments, priority, sprint, attachments, edits — read with one search (services/jira searchJiraIssues: the issues
  // updated in the last days, with their changelog and comments), worked out here, newest first, by day. What is new since
  // the bell was last opened is counted (kept on this PC). Pure but load().
  var DAY = 86400000;
  var PROJECT = 'EQP';
  var KINDS = [['new', 'New'], ['status', 'Status'], ['assign', 'Assigned'], ['comment', 'Comments'], ['priority', 'Priority'], ['sprint', 'Sprint'], ['attach', 'Attachments'], ['edit', 'Edits']];
  // changes nobody reads as news: the board's ordering, time tracking, links to other systems
  var NOISE = /^(rank|worklogid|timespent|timeestimate|timeoriginalestimate|remoteissuelink|workflow|aggregate.*)$/i;
  var FIELDS = ['summary', 'issuetype', 'status', 'priority', 'assignee', 'reporter', 'creator', 'created', 'updated', 'comment'];

  var txt = function (v) { return v === undefined || v === null ? '' : String(v); };
  var name = function (u) { return u ? txt(u.displayName || u.name || u.emailAddress) : ''; };
  var t = function (s) { var n = Date.parse(s); return isNaN(n) ? 0 : n; };
  /** A comment's words, plain (Jira wiki or Atlassian document format), short. */
  function plain(body) {
    var s = '';
    if (typeof body === 'string') s = body;
    else if (body && typeof body === 'object') {
      var walk = function (n) { if (!n) return; if (n.text) s += n.text; (n.content || []).forEach(walk); if (n.type === 'paragraph') s += ' '; };
      walk(body);
    }
    s = s.replace(/\[~accountid:[^\]]+\]/g, '@someone').replace(/\{[a-z]+(:[^}]*)?\}/g, '').replace(/!([^!|\s]+)(\|[^!]*)?!/g, '[image]')
      .replace(/\[([^|\]]+)\|[^\]]+\]/g, '$1').replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1').replace(/^h\d\.\s*/gm, '').replace(/\s+/g, ' ').trim();
    return s.length > 180 ? s.slice(0, 177) + '…' : s;
  }

  /** One update for each thing that changed since `since` (ms): { key, summary, type, kind, at, by, text, from, to, mine }. */
  function eventsOf(issues, since, me) {
    var out = [];
    (issues || []).forEach(function (is) {
      var f = is.fields || {};
      var type = f.issuetype ? txt(f.issuetype.name) : 'Issue';
      var mineIssue = !!(me && f.assignee && (f.assignee.accountId === me));
      var base = { key: txt(is.key), summary: txt(f.summary), type: type, status: f.status ? txt(f.status.name) : '' };
      var add = function (e) { out.push(Object.assign({}, base, { mine: mineIssue }, e, { id: base.key + '|' + e.kind + '|' + e.at + '|' + (e.field || '') + '|' + out.length })); };
      if (f.created && t(f.created) >= since) {
        add({ kind: 'new', at: f.created, by: name(f.reporter || f.creator), text: 'New ' + type.toLowerCase() + (f.priority ? ' · ' + txt(f.priority.name) : '') + (f.assignee ? ' · for ' + name(f.assignee) : ' · not assigned') });
      }
      ((is.changelog && is.changelog.histories) || []).forEach(function (h) {
        if (t(h.created) < since) return;
        (h.items || []).forEach(function (it) {
          var field = txt(it.field);
          if (NOISE.test(field.replace(/\s+/g, ''))) return;
          var from = txt(it.fromString), to = txt(it.toString);
          var lf = field.toLowerCase();
          var e = { at: h.created, by: name(h.author), field: field, from: from, to: to };
          if (lf === 'status') { e.kind = 'status'; e.text = (from || '—') + ' → ' + (to || '—'); }
          else if (lf === 'assignee') { e.kind = 'assign'; e.text = to ? 'Assigned to ' + to + (from ? ' (was ' + from + ')' : '') : 'Unassigned (was ' + (from || 'nobody') + ')'; e.mine = !!(me && it.to === me); }
          else if (lf === 'priority') { e.kind = 'priority'; e.text = 'Priority ' + (from || '—') + ' → ' + (to || '—'); }
          else if (lf === 'sprint') { e.kind = 'sprint'; e.text = to ? 'Sprint: ' + to + (from ? ' (was ' + from + ')' : '') : 'Taken out of ' + (from || 'its sprint'); }
          else if (lf === 'attachment') { e.kind = 'attach'; e.text = to ? 'Attached ' + to : 'Removed the attachment ' + from; }
          else if (lf === 'summary') { e.kind = 'edit'; e.text = 'Title: ' + to; }
          else if (lf === 'description') { e.kind = 'edit'; e.text = 'Description changed'; }
          else if (lf === 'resolution') { e.kind = 'status'; e.text = to ? 'Resolved: ' + to : 'Unresolved (was ' + from + ')'; }
          else { e.kind = 'edit'; e.text = field.charAt(0).toUpperCase() + field.slice(1) + ': ' + (from ? from + ' → ' : '') + (to || '(cleared)'); }
          add(e);
        });
      });
      ((f.comment && f.comment.comments) || []).forEach(function (c) {
        if (t(c.created) < since) return;
        add({ kind: 'comment', at: c.created, by: name(c.author), text: plain(c.body) || '(a comment)' });
      });
    });
    return out.sort(function (a, b) { return t(b.at) - t(a.at); });
  }

  /** The updates by day (Today, Yesterday, then the date), filtered by kind ('all', 'mine', or a kind). */
  function grouped(events, kind, now) {
    var n = now || Date.now();
    var day0 = new Date(n); day0.setHours(0, 0, 0, 0);
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var groups = [];
    (events || []).filter(function (e) { return !kind || kind === 'all' || (kind === 'mine' ? e.mine : e.kind === kind); }).forEach(function (e) {
      var d = new Date(t(e.at));
      var back = Math.floor((day0.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / DAY);
      var label = back <= 0 ? 'Today' : back === 1 ? 'Yesterday' : DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
      var g = groups[groups.length - 1];
      if (!g || g.label !== label) { g = { label: label, items: [] }; groups.push(g); }
      var p2 = function (x) { return (x < 10 ? '0' : '') + x; };
      g.items.push(Object.assign({ time: p2(d.getHours()) + ':' + p2(d.getMinutes()) }, e));
    });
    return groups;
  }

  /** The kind chips, with how many of each (only kinds that have some). */
  function chips(events) {
    var l = events || [];
    var c = function (k) { return l.filter(function (e) { return k === 'all' ? true : k === 'mine' ? e.mine : e.kind === k; }).length; };
    return [['all', 'All'], ['mine', 'Mine']].concat(KINDS).map(function (k) { return { id: k[0], label: k[1], n: c(k[0]) }; }).filter(function (k) { return k.id === 'all' || k.n > 0; });
  }

  /** How many are newer than when the bell was last opened (ISO; '' when never: then all of them). */
  function newSince(events, seen) {
    var s = t(seen);
    return (events || []).filter(function (e) { return t(e.at) > s; }).length;
  }

  function jql(days, project) { return 'project = ' + (project || PROJECT) + ' AND updated >= -' + Math.max(1, Math.min(14, Number(days) || 2)) + 'd ORDER BY updated DESC'; }

  var meCache = null;
  /** Reads the updates of the last `days` from Jira: { ok, events, message, me }. */
  async function load(context, Actions, opts) {
    var o = opts || {};
    var days = Math.max(1, Math.min(14, Number(o.days) || 2));
    var now = o.now || Date.now();
    if (meCache === null) {
      try { var m = await Actions.callRest(context, { endpoint: 'jira/getJiraMyself' }); meCache = m && m.ok && m.body ? txt(m.body.accountId) : ''; } catch (e) { meCache = ''; }
    }
    var issues = [];
    var token = '';
    for (var i = 0; i < 5; i++) {
      var params = { jql: jql(days, o.project), fields: FIELDS.join(','), maxResults: 100, expand: 'changelog' };
      if (token) params.nextPageToken = token;
      var res;
      try { res = await Actions.callRest(context, { endpoint: 'jira/searchJiraIssues', uriParams: params }); } catch (e) { res = { ok: false, status: 0, body: { message: txt(e && e.message) } }; }
      if (!res || !res.ok || !res.body || !Array.isArray(res.body.issues)) {
        var s = res ? res.status : 0;
        return { ok: false, events: [], me: meCache, message: s === 401 || s === 403 ? 'Jira is not connected (Jira stories → Connect Jira).' : 'Could not read Jira' + (s ? ' (HTTP ' + s + ')' : '') + '.' };
      }
      issues = issues.concat(res.body.issues);
      token = res.body.nextPageToken || '';
      if (res.body.isLast !== false || !token) break;
    }
    return { ok: true, events: eventsOf(issues, now - days * DAY, meCache), me: meCache, message: '', issues: issues.length };
  }

  return { eventsOf: eventsOf, grouped: grouped, chips: chips, newSince: newSince, jql: jql, plain: plain, load: load, KINDS: KINDS };
});
