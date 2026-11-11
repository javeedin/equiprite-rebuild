define([], function () {
  'use strict';

  // Standup minutes: the rules behind the Minutes page (flows/insights minutes-page). Pure — no page, no DOM, no
  // network. A meeting has a header (date, time, attendees, customer, title, context) and lines; each line is either
  // tied to a Jira story (jiraKey) or generic, with the minute text, a next action, its owner and due date, and a
  // status. The page keeps meetings on this PC through the desktop app (/__minutes/*, desktop/lib/minutes.js); it
  // formats a line with the shared Ask AI LLM (/__sql/ai/chat) and dictates a line with Whisper (/__minutes/dictate).
  //
  //   blankMeeting() / blankLine()     a new meeting / line, dated today (a meeting carries a discussion body + lines)
  //   formatPrompt(text)               { system, user } for the LLM to clean up a note into simple English
  //   formatBodyPrompt(text)           { system, user } for the LLM to tidy the discussion body into standard minutes
  //   summarise(meeting)               { lines, linked, generic, openActions, doneActions, overdue }
  //   stories(meetings, rows)          the full track per Jira story (its lines and actions across every meeting)
  //   epics(meetings, rows)            the same rolled up by the story's epic (what the user tracks by)
  //   customers(meetings)              rolled up by the customer entered on each meeting
  //   openActions(meetings)            every open action item, earliest due first (overdue flagged)
  //   emailFor(meeting, rows)          { subject, html, text } a formatted minutes email
  //   teamsFor(meeting, rows)          { text } a Markdown message for a Teams incoming webhook

  // Microsoft 365 defaults (the RITE "Equip_Rite" app registration): shown in the settings form so the user only signs
  // in. Not secrets — a Tenant ID and a public-client App (Client) ID; the user can overwrite them.
  var GRAPH_DEFAULT = { tenantId: 'f4d4b2b3-ca12-4c29-8cff-136685f7f51d', clientId: '3e139d37-6f21-4165-81ef-a2f126831839' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function txt(v) { return v == null ? '' : String(v); }

  function blankLine() { return { id: '', jiraKey: '', generic: true, text: '', raw: '', action: '', owner: '', due: '', status: 'open' }; }
  function blankMeeting() { return { id: '', date: todayISO(), time: nowHM(), title: 'Daily standup', customer: '', attendees: [], context: '', discussion: '', lines: [], createdAt: '', updatedAt: '' }; }

  // Attendees are kept as strings: a plain name, a plain email, or "Name <email>" (when picked from Outlook).
  function attendeeName(a) { var s = txt(a).trim(); var m = /^(.*?)\s*<[^>]+>$/.exec(s); return m ? m[1].trim() : s; }
  function attendeeEmail(a) { var s = txt(a).trim(); var m = /<([^>]+)>/.exec(s); if (m) return m[1].trim(); return /^[^\s@]+@[^\s@]+$/.test(s) ? s : ''; }
  function attendeeEmails(list) { return (list || []).map(attendeeEmail).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }); }

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

  /** The prompt that turns the rough discussion body into a tidy, standard "Discussion" section — may organise points
   *  into short bullet lines, but never invents anything. */
  function formatBodyPrompt(text) {
    return {
      system: 'You are a professional meeting-minutes editor. Rewrite the rough notes the user gives you as the "Discussion" section of standard meeting minutes: clear, concise, professional English with correct grammar and spelling, in the past tense where natural. Keep EVERY fact; do not add, invent or infer any information, names, dates, decisions or numbers that are not in the notes. You may group related points into short bullet lines each starting with "- " when that reads more clearly, and keep separate topics in separate paragraphs. Do not add a heading, greeting, sign-off or commentary. Return only the rewritten discussion as plain text.',
      user: txt(text).trim()
    };
  }

  /** A body of free text → email HTML: runs of "- " lines become a bullet list, other runs of lines become paragraphs. */
  function bodyHtml(text) {
    var lines = txt(text).replace(/\r/g, '').split(/\n/);
    var out = [], para = [], bullets = [];
    function flushPara() { if (para.length) { out.push('<p style="margin:0 0 10px;line-height:1.5">' + para.map(esc).join('<br>') + '</p>'); para = []; } }
    function flushBullets() { if (bullets.length) { out.push('<ul style="margin:0 0 10px;padding-left:20px">' + bullets.map(function (x) { return '<li style="margin-bottom:4px">' + esc(x) + '</li>'; }).join('') + '</ul>'); bullets = []; } }
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) { flushBullets(); flushPara(); return; }
      var m = /^[-•*]\s+(.*)$/.exec(line);
      if (m) { flushPara(); bullets.push(m[1]); } else { flushBullets(); para.push(line); }
    });
    flushBullets(); flushPara();
    return out.join('');
  }

  /** A body of free text → plain-text lines (for the email fallback and the Teams message). */
  function bodyLines(text) {
    return txt(text).split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
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
    var body = bodyHtml(m.discussion);
    var storyGroups = groups.filter(function (g) { return g.lines.some(function (l) { return lineText(l); }); });
    if (body) H.push('<div style="margin:0 22px 12px;color:#161513">' + body + '</div>');
    storyGroups.forEach(function (g) {
      var head = g.key ? storyLabel(g.key, idx) : 'Other notes';
      H.push('<div style="margin:0 22px 12px"><div style="font-weight:700;color:#00688c;margin-bottom:4px">' + head + '</div><ul style="margin:0;padding-left:20px">');
      g.lines.forEach(function (l) { if (lineText(l)) H.push('<li style="margin-bottom:4px">' + esc(lineText(l)) + '</li>'); });
      H.push('</ul></div>');
    });
    if (!body && !storyGroups.length) H.push('<div style="margin:0 22px 12px;color:#555">No discussion recorded.</div>');

    // The Story cell in the action-items table: the number, its description and a coloured current-status badge, from the backlog.
    function badgeStyle(cat) {
      if (cat === 'done') return 'background:#d6eed9;color:#1d6b2b';
      if (cat === 'indeterminate') return 'background:#e4f1f7;color:#00688c';
      return 'background:#eceae7;color:#5b5a57';
    }
    function storyCell(l) {
      var k = txt(l.jiraKey).trim();
      if (!k) return '<span style="color:#999">—</span>';
      var r = idx[k];
      var out = '<b>' + esc(k) + '</b>';
      if (r && r.summary) out += '<div style="color:#555;margin-top:2px">' + esc(r.summary) + '</div>';
      if (r && r.status) out += '<div style="margin-top:3px"><span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;' + badgeStyle(r.statusCat) + '">' + esc(r.status) + '</span></div>';
      else if (!r) out += '<div style="color:#999;margin-top:2px;font-size:12px">status not in this read</div>';
      return out;
    }

    var actions = lines.filter(hasAction);
    H.push('<h2 style="font-size:16px;margin:22px 22px 8px">Action items</h2>');
    if (actions.length) {
      H.push('<table style="width:calc(100% - 44px);margin:0 22px;border-collapse:collapse;font-size:13px">');
      H.push('<tr style="background:#eef2f4;text-align:left"><th style="padding:7px 9px;border:1px solid #e0ddd9">Action</th><th style="padding:7px 9px;border:1px solid #e0ddd9">Actioned by</th><th style="padding:7px 9px;border:1px solid #e0ddd9">Due</th><th style="padding:7px 9px;border:1px solid #e0ddd9">Story &amp; current status</th><th style="padding:7px 9px;border:1px solid #e0ddd9">Progress</th></tr>');
      actions.forEach(function (l) {
        H.push('<tr><td style="padding:7px 9px;border:1px solid #e0ddd9;vertical-align:top">' + esc(txt(l.action).trim()) + '</td><td style="padding:7px 9px;border:1px solid #e0ddd9;vertical-align:top">' + esc(txt(l.owner).trim() || '—')
          + '</td><td style="padding:7px 9px;border:1px solid #e0ddd9;vertical-align:top">' + esc(txt(l.due) || '—') + '</td><td style="padding:7px 9px;border:1px solid #e0ddd9;vertical-align:top">' + storyCell(l)
          + '</td><td style="padding:7px 9px;border:1px solid #e0ddd9;vertical-align:top">' + (l.status === 'done' ? 'Done' : 'Open') + '</td></tr>');
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
    bodyLines(m.discussion).forEach(function (x) { L.push(/^[-•*]\s+/.test(x) ? x.replace(/^[-•*]\s+/, '- ') : x); });
    (m.lines || []).forEach(function (l) {
      if (!lineText(l)) return;
      L.push('- ' + (txt(l.jiraKey).trim() ? '[' + txt(l.jiraKey).trim() + '] ' : '') + lineText(l));
    });
    var actions = (m.lines || []).filter(hasAction);
    if (actions.length) {
      L.push('');
      L.push('ACTION ITEMS');
      actions.forEach(function (l) {
        var k = txt(l.jiraKey).trim();
        var r = k ? (idx || {})[k] : null;
        var tag = k ? (' [' + k + (r && r.summary ? ' ' + r.summary : '') + (r && r.status ? ' — ' + r.status : '') + ']') : '';
        L.push('- ' + txt(l.action).trim() + (txt(l.owner).trim() ? ' (' + txt(l.owner).trim() + ')' : '') + (txt(l.due) ? ' by ' + txt(l.due) : '')
          + tag + (l.status === 'done' ? ' — done' : ''));
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
    bodyLines(m.discussion).forEach(function (x) { L.push(/^[-•*]\s+/.test(x) ? x.replace(/^[-•*]\s+/, '- ') : x); });
    (m.lines || []).forEach(function (l) {
      if (!lineText(l)) return;
      L.push('- ' + (txt(l.jiraKey).trim() ? '**' + txt(l.jiraKey).trim() + '** ' : '') + lineText(l));
    });
    var actions = (m.lines || []).filter(hasAction);
    if (actions.length) {
      L.push('');
      L.push('**Action items**');
      actions.forEach(function (l) {
        var k = txt(l.jiraKey).trim();
        var r = k ? idx[k] : null;
        var tag = k ? (' `' + k + '`' + (r && r.summary ? ' ' + r.summary : '') + (r && r.status ? ' _(' + r.status + ')_' : '')) : '';
        L.push('- ' + txt(l.action).trim() + (txt(l.owner).trim() ? ' — _' + txt(l.owner).trim() + '_' : '') + (txt(l.due) ? ' (by ' + txt(l.due) + ')' : '') + tag);
      });
    }
    return { text: L.join('\n'), idx: !!idx };
  }

  return {
    todayISO: todayISO, nowHM: nowHM, blankMeeting: blankMeeting, blankLine: blankLine,
    attendeeName: attendeeName, attendeeEmail: attendeeEmail, attendeeEmails: attendeeEmails,
    lineText: lineText, summarise: summarise, formatPrompt: formatPrompt, formatBodyPrompt: formatBodyPrompt,
    stories: stories, epics: epics, customers: customers, openActions: openActions,
    emailFor: emailFor, teamsFor: teamsFor, GRAPH_DEFAULT: GRAPH_DEFAULT
  };
});
