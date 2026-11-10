define([], function () {
  'use strict';

  // Standup minutes: the rules behind the Minutes page (flows/insights minutes-page). Pure — no page, no DOM, no
  // network. A meeting has a header (date, time, attendees, customer, title, context) and lines; each line is either
  // tied to a Jira story (jiraKey) or generic, with the minute text, a next action, its owner and due date, and a
  // status. The page keeps meetings on this PC through the desktop app (/__minutes/*, desktop/lib/minutes.js); it
  // formats a line with the shared Ask AI LLM (/__sql/ai/chat) and dictates a line with Whisper (/__minutes/dictate).
  //
  //   blankMeeting() / blankLine()     a new meeting / line, dated today
  //   formatPrompt(text)               { system, user } for the LLM to clean up a note into simple English
  //   summarise(meeting)               { lines, linked, generic, openActions, doneActions, overdue }
  //   stories(meetings, rows)          the full track per Jira story (its lines and actions across every meeting)
  //   epics(meetings, rows)            the same rolled up by the story's epic (what the user tracks by)
  //   customers(meetings)              rolled up by the customer entered on each meeting
  //   openActions(meetings)            every open action item, earliest due first (overdue flagged)
  //   emailFor(meeting, rows)          { subject, html, text } a formatted minutes email
  //   teamsFor(meeting, rows)          { text } a Markdown message for a Teams incoming webhook

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function txt(v) { return v == null ? '' : String(v); }

  function blankLine() { return { id: '', jiraKey: '', generic: true, text: '', raw: '', action: '', owner: '', due: '', status: 'open' }; }
  function blankMeeting() { return { id: '', date: todayISO(), time: nowHM(), title: 'Daily standup', customer: '', attendees: [], context: '', lines: [], createdAt: '', updatedAt: '' }; }

  // The note a line keeps: the formatted text, else the raw dictation/typing.
  function lineText(l) { return txt(l && (l.text || l.raw)).trim(); }
  function isOpen(l) { return l && l.status !== 'done'; }
  function hasAction(l) { return !!txt(l && l.action).trim(); }

  function esc(s) {
    return txt(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  /** The prompt that turns a rough note into clear, simple English without inventing anything. */
  function formatPrompt(text) {
    return {
      system: 'You are an editor who cleans up meeting-minute notes. Rewrite the note the user gives you in clear, simple, professional English with correct grammar and spelling. Keep it concise and factual, in the past tense where natural. Do NOT add information, opinions, greetings, headings, bullet characters or commentary. Do not invent names, dates or numbers. Return only the rewritten note as plain text.',
      user: txt(text).trim()
    };
  }

  function summarise(m) {
    var lines = (m && m.lines) || [];
    var withText = lines.filter(function (l) { return lineText(l); });
    var t = todayISO();
    return {
      lines: withText.length,
      linked: withText.filter(function (l) { return !!txt(l.jiraKey).trim(); }).length,
      generic: withText.filter(function (l) { return !txt(l.jiraKey).trim(); }).length,
      openActions: lines.filter(function (l) { return hasAction(l) && isOpen(l); }).length,
      doneActions: lines.filter(function (l) { return hasAction(l) && !isOpen(l); }).length,
      overdue: lines.filter(function (l) { return hasAction(l) && isOpen(l) && l.due && l.due < t; }).length
    };
  }

  function indexRows(rows) {
    var m = {};
    (rows || []).forEach(function (r) { if (r && r.key) m[r.key] = r; });
    return m;
  }

  // Every line across every meeting, carrying the meeting it came from, newest meeting first.
  function allLines(meetings) {
    var out = [];
    (meetings || []).forEach(function (m) {
      (m.lines || []).forEach(function (l) {
        if (!lineText(l) && !hasAction(l)) return;
        out.push({ meetingId: m.id, date: m.date || '', title: m.title || '', customer: m.customer || '', line: l });
      });
    });
    return out.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  }

  function item(e) {
    var l = e.line;
    return { date: e.date, key: txt(l.jiraKey), text: lineText(l), action: txt(l.action).trim(), owner: txt(l.owner).trim(),
      due: txt(l.due), status: l.status === 'done' ? 'done' : 'open', meetingId: e.meetingId, title: e.title, customer: e.customer };
  }

  function roll(groupKey, nameOf) {
    return function (meetings, rows) {
      var idx = indexRows(rows);
      var by = {}, order = [];
      allLines(meetings).forEach(function (e) {
        var g = groupKey(e, idx);
        if (g == null) return;
        if (!by[g]) { by[g] = { key: g, name: nameOf(g, e, idx), items: [] }; order.push(by[g]); }
        by[g].items.push(item(e));
      });
      var t = todayISO();
      return order.map(function (grp) {
        var open = grp.items.filter(function (it) { return it.action && it.status !== 'done'; });
        return {
          key: grp.key, name: grp.name,
          lines: grp.items.length,
          meetings: grp.items.reduce(function (s, it) { return s.concat(it.meetingId); }, []).filter(function (v, i, a) { return a.indexOf(v) === i; }).length,
          actions: grp.items.filter(function (it) { return it.action; }).length,
          openActions: open.length,
          overdue: open.filter(function (it) { return it.due && it.due < t; }).length,
          lastDate: grp.items.reduce(function (s, it) { return it.date > s ? it.date : s; }, ''),
          items: grp.items
        };
      }).sort(function (a, b) { return b.openActions - a.openActions || b.lines - a.lines || (b.lastDate || '').localeCompare(a.lastDate || ''); });
    };
  }

  // The full track per Jira story (generic lines are left out — they have no story).
  var stories = roll(
    function (e) { var k = txt(e.line.jiraKey).trim(); return k || null; },
    function (g, e, idx) { var r = idx[g]; return r && r.summary ? g + ' ' + r.summary : g; }
  );

  // Rolled up by the story's epic — what the user tracks by. Lines whose story is unknown fall under "No epic";
  // generic lines (no story) under "General (no story)".
  var epics = roll(
    function (e, idx) {
      var k = txt(e.line.jiraKey).trim();
      if (!k) return '~general';
      var r = idx[k];
      return (r && r.epicKey) ? r.epicKey : '~noepic';
    },
    function (g, e, idx) {
      if (g === '~general') return 'General (no story)';
      if (g === '~noepic') return 'No epic';
      var r = idx[txt(e.line.jiraKey).trim()]; return r && r.epicName ? g + ' ' + r.epicName : g;
    }
  );

  // Rolled up by the customer entered on each meeting.
  var customers = roll(
    function (e) { return txt(e.customer).trim() || '~none'; },
    function (g) { return g === '~none' ? '(no customer)' : g; }
  );

  /** Every open action item, earliest due first (no due date last), each flagged overdue. */
  function openActions(meetings) {
    var t = todayISO();
    return allLines(meetings).map(item).filter(function (it) { return it.action && it.status !== 'done'; })
      .map(function (it) { it.overdue = !!(it.due && it.due < t); return it; })
      .sort(function (a, b) { return (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || (b.date || '').localeCompare(a.date || ''); });
  }

  function storyLabel(key, idx) { var r = idx[key]; return r && r.summary ? esc(key + ' — ' + r.summary) : esc(key); }

  /** A formatted minutes email: a header card, the discussion grouped by story, an action-items table. */
  function emailFor(meeting, rows) {
    var m = meeting || blankMeeting();
    var idx = indexRows(rows);
    var subject = '[Standup] ' + (txt(m.title).trim() || 'Minutes') + ' — ' + txt(m.date) + (txt(m.customer).trim() ? ' · ' + txt(m.customer).trim() : '');
    var att = (m.attendees || []).filter(Boolean);
    var lines = (m.lines || []).filter(function (l) { return lineText(l) || hasAction(l); });

    // discussion: Jira-linked first (grouped by key), then generic
    var groups = [], seen = {};
    lines.forEach(function (l) {
      var k = txt(l.jiraKey).trim();
      var gk = k || '~generic';
      if (!seen[gk]) { seen[gk] = { key: k, lines: [] }; groups.push(seen[gk]); }
      seen[gk].lines.push(l);
    });
    groups.sort(function (a, b) { return (a.key ? 0 : 1) - (b.key ? 0 : 1); });

    var H = [];
    H.push('<div style="font-family:Arial,Helvetica,sans-serif;color:#161513;max-width:760px;margin:0 auto">');
    H.push('<div style="background:#2c5266;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0">');
    H.push('<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">EquipRite · Standup minutes</div>');
    H.push('<div style="font-size:22px;font-weight:700;margin-top:3px">' + esc(txt(m.title).trim() || 'Daily standup') + '</div></div>');
    H.push('<table style="width:100%;border-collapse:collapse;background:#fbf9f8;font-size:14px">');
    function meta(k, v) { if (!v) return; H.push('<tr><td style="padding:6px 22px;color:#555;width:120px;vertical-align:top">' + esc(k) + '</td><td style="padding:6px 22px;font-weight:600">' + esc(v) + '</td></tr>'); }
    meta('Date', txt(m.date) + (txt(m.time) ? ' · ' + txt(m.time) : ''));
    meta('Customer', txt(m.customer).trim());
    meta('Attendees', att.join(', '));
    if (txt(m.context).trim()) meta('Context', txt(m.context).trim());
    H.push('</table>');

    H.push('<h2 style="font-size:16px;margin:22px 22px 8px">Discussion</h2>');
    groups.forEach(function (g) {
      var head = g.key ? storyLabel(g.key, idx) : 'General';
      H.push('<div style="margin:0 22px 12px"><div style="font-weight:700;color:#00688c;margin-bottom:4px">' + head + '</div><ul style="margin:0;padding-left:20px">');
      g.lines.forEach(function (l) { if (lineText(l)) H.push('<li style="margin-bottom:4px">' + esc(lineText(l)) + '</li>'); });
      H.push('</ul></div>');
    });

    var actions = lines.filter(hasAction);
    H.push('<h2 style="font-size:16px;margin:22px 22px 8px">Next action items</h2>');
    if (actions.length) {
      H.push('<table style="width:calc(100% - 44px);margin:0 22px;border-collapse:collapse;font-size:13px">');
      H.push('<tr style="background:#eef2f4;text-align:left"><th style="padding:7px 9px;border:1px solid #e0ddd9">Action</th><th style="padding:7px 9px;border:1px solid #e0ddd9">Owner</th><th style="padding:7px 9px;border:1px solid #e0ddd9">Due</th><th style="padding:7px 9px;border:1px solid #e0ddd9">Story</th><th style="padding:7px 9px;border:1px solid #e0ddd9">Status</th></tr>');
      actions.forEach(function (l) {
        H.push('<tr><td style="padding:7px 9px;border:1px solid #e0ddd9">' + esc(txt(l.action).trim()) + '</td><td style="padding:7px 9px;border:1px solid #e0ddd9">' + esc(txt(l.owner).trim() || '—')
          + '</td><td style="padding:7px 9px;border:1px solid #e0ddd9">' + esc(txt(l.due) || '—') + '</td><td style="padding:7px 9px;border:1px solid #e0ddd9">' + (txt(l.jiraKey).trim() ? esc(txt(l.jiraKey).trim()) : '—')
          + '</td><td style="padding:7px 9px;border:1px solid #e0ddd9">' + (l.status === 'done' ? 'Done' : 'Open') + '</td></tr>');
      });
      H.push('</table>');
    } else {
      H.push('<div style="margin:0 22px;color:#555">No action items recorded.</div>');
    }
    H.push('<div style="margin:22px;color:#888;font-size:12px">Sent from EquipRite Next · Standup minutes</div></div>');

    return { subject: subject, html: H.join(''), text: textFor(m, idx) };
  }

  // A plain-text version (email fallback, and the base for the Teams message).
  function textFor(m, idx) {
    var L = [];
    L.push((txt(m.title).trim() || 'Daily standup') + ' — ' + txt(m.date) + (txt(m.time) ? ' ' + txt(m.time) : ''));
    if (txt(m.customer).trim()) L.push('Customer: ' + txt(m.customer).trim());
    var att = (m.attendees || []).filter(Boolean);
    if (att.length) L.push('Attendees: ' + att.join(', '));
    L.push('');
    L.push('DISCUSSION');
    (m.lines || []).forEach(function (l) {
      if (!lineText(l)) return;
      L.push('- ' + (txt(l.jiraKey).trim() ? '[' + txt(l.jiraKey).trim() + '] ' : '') + lineText(l));
    });
    var actions = (m.lines || []).filter(hasAction);
    if (actions.length) {
      L.push('');
      L.push('NEXT ACTIONS');
      actions.forEach(function (l) {
        L.push('- ' + txt(l.action).trim() + (txt(l.owner).trim() ? ' (' + txt(l.owner).trim() + ')' : '') + (txt(l.due) ? ' by ' + txt(l.due) : '')
          + (txt(l.jiraKey).trim() ? ' [' + txt(l.jiraKey).trim() + ']' : '') + (l.status === 'done' ? ' — done' : ''));
      });
    }
    return L.join('\n');
  }

  /** A Markdown message for a Teams incoming webhook (classic webhooks and Workflows both render { text }). */
  function teamsFor(meeting, rows) {
    var m = meeting || blankMeeting();
    var idx = indexRows(rows);
    var L = [];
    L.push('## 📋 ' + (txt(m.title).trim() || 'Daily standup') + ' — ' + txt(m.date) + (txt(m.time) ? ' ' + txt(m.time) : ''));
    var bits = [];
    if (txt(m.customer).trim()) bits.push('**Customer:** ' + txt(m.customer).trim());
    var att = (m.attendees || []).filter(Boolean);
    if (att.length) bits.push('**Attendees:** ' + att.join(', '));
    if (bits.length) L.push(bits.join('  ·  '));
    L.push('');
    L.push('**Discussion**');
    (m.lines || []).forEach(function (l) {
      if (!lineText(l)) return;
      L.push('- ' + (txt(l.jiraKey).trim() ? '**' + txt(l.jiraKey).trim() + '** ' : '') + lineText(l));
    });
    var actions = (m.lines || []).filter(hasAction);
    if (actions.length) {
      L.push('');
      L.push('**Next actions**');
      actions.forEach(function (l) {
        L.push('- ' + txt(l.action).trim() + (txt(l.owner).trim() ? ' — _' + txt(l.owner).trim() + '_' : '') + (txt(l.due) ? ' (by ' + txt(l.due) + ')' : '')
          + (txt(l.jiraKey).trim() ? ' `' + txt(l.jiraKey).trim() + '`' : ''));
      });
    }
    return { text: L.join('\n'), idx: !!idx };
  }

  return {
    todayISO: todayISO, nowHM: nowHM, blankMeeting: blankMeeting, blankLine: blankLine,
    lineText: lineText, summarise: summarise, formatPrompt: formatPrompt,
    stories: stories, epics: epics, customers: customers, openActions: openActions,
    emailFor: emailFor, teamsFor: teamsFor
  };
});
