define(['resources/js/exportKit'], function (exportKit) {
  'use strict';

  // "Copy to follow-up" / "Open in Outlook" on the Jira pages: the greeting that addresses the assignees by first name,
  // a few ready email bodies in simple English the user picks from, and the composed email (the message, then the
  // stories as a table, then the sign-off). exportKit builds the table and puts it on the clipboard; the body kept here
  // is plain, email-friendly English — the user can edit every word before they copy or open Outlook.

  function htmlEsc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // "nabil.khan" → "Nabil", "Rahul Kanth Panganamamula" → "Rahul".
  function firstName(assignee) {
    var a = String(assignee || '').trim();
    if (!a || /^nobody$/i.test(a)) return '';
    var first = a.split(/[\s.]+/)[0] || '';
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
  }

  // The distinct first names of the people the picked stories are assigned to.
  function names(rows) {
    var seen = {};
    var out = [];
    (rows || []).forEach(function (r) {
      var n = firstName(r && r.assignee);
      var k = n.toLowerCase();
      if (n && !seen[k]) { seen[k] = true; out.push(n); }
    });
    return out;
  }

  // "Dear Nabil and Rahul," — or "Dear all," when nobody is assigned, or there are too many names to greet by name.
  function greeting(rows) {
    var ns = names(rows);
    if (!ns.length || ns.length > 4) return 'Dear all,';
    var joined = ns.length === 1 ? ns[0] : ns.slice(0, -1).join(', ') + ' and ' + ns[ns.length - 1];
    return 'Dear ' + joined + ',';
  }

  // The bodies the user chooses from (simple English, no greeting and no sign-off — those are added around them).
  var TEMPLATES = [
    { key: 'close', label: 'Ask to close', subject: 'Please close these stories',
      body: 'As we discussed, kindly close the following stories. If a story cannot be closed yet, please reply with the reason and the date you expect to finish.' },
    { key: 'status', label: 'Status update', subject: 'Quick status on these stories',
      body: 'Please share the latest status on the stories below. For anything still open, add a short note on what is left and when it will be done.' },
    { key: 'overdue', label: 'Overdue — act today', subject: 'Overdue stories — action needed',
      body: 'The stories below are due or overdue. Please update them today: move it to Done if finished, or add the blocker and a new date if not.' },
    { key: 'standup', label: 'After standup', subject: 'Follow-up from today’s standup',
      body: 'Thank you for joining the standup. Here are the stories we agreed to move forward. Please update each one with your progress and your next step.' },
    { key: 'testing', label: 'Ready for testing?', subject: 'Are these ready for testing?',
      body: 'Please confirm whether the stories below are ready for testing. If a story is not ready, add what is pending and when it will be ready.' },
    { key: 'sprint', label: 'Sprint closing', subject: 'Sprint closing — please finish or hand over',
      body: 'We are closing the sprint. Please complete or hand over the stories below, and make sure the status on the board is correct.' },
    { key: 'blank', label: 'Write my own', subject: 'Follow-up', body: '' },
  ];

  function template(key) {
    for (var i = 0; i < TEMPLATES.length; i++) { if (TEMPLATES[i].key === key) return TEMPLATES[i]; }
    return TEMPLATES[0];
  }

  // The message that fills the box when a template is picked: the greeting, a blank line, then the chosen body.
  function message(rows, key) {
    var b = template(key).body;
    return greeting(rows) + (b ? '\n\n' + b : '\n\n');
  }

  // The columns the follow-up table shows — short and email-friendly. 'sprint' leads with the item's sprint; 'stories'
  // carries the customer label instead.
  function columns(kind) {
    var base = [];
    if (kind === 'sprint') base.push({ key: 'sprint', label: 'Sprint', value: function (r) { return r.sprint || '—'; } });
    base.push({ key: 'key', label: 'Key', href: function (r) { return r.url; } });
    base.push({ key: 'summary', label: 'Summary' });
    base.push({ key: 'status', label: 'Status' });
    base.push({ key: 'assignee', label: 'Assignee', value: function (r) { return r.assignee || 'Nobody'; } });
    if (kind !== 'sprint') base.push({ key: 'labels', label: 'Customer', value: function (r) { return (r.labels || []).join(', '); } });
    base.push({ key: 'due', label: 'Due', value: function (r) { return r.due || '—'; }, tone: function (r) { return r.overdue ? 'bad' : ''; } });
    return base;
  }

  // Plain text → email paragraphs (escaped; a blank line starts a new paragraph, a single newline is a break).
  function introHtml(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    return t.split(/\n{2,}/).map(function (p) {
      return '<p style="margin:0 0 10px;font:400 14px/1.5 \'Segoe UI\',Arial,sans-serif;color:#1f2937;">' + htmlEsc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  // The header block as plain text lines: the name, the state · dates, and "N items · when".
  function headerText(opts) {
    var o = opts || {};
    var n = (o.rows || []).length;
    var count = n + (n === 1 ? ' item' : ' items') + (o.when ? ' · ' + o.when : '');
    return [o.title || '', o.subtitle || '', count].filter(Boolean).join('\n');
  }

  // Just the stories table (no header, message or sign-off) — for the "Open in Outlook" clipboard, so one Ctrl+V drops
  // the formatted table into the mail's body without repeating the message that is already typed there.
  function tableHtml(opts) {
    var o = opts || {};
    return exportKit.followupHtml({ rows: o.rows || [], columns: columns(o.kind), showCount: false });
  }
  function tableText(opts) {
    var o = opts || {};
    return exportKit.tsv(o.rows || [], columns(o.kind));
  }

  // A mail link carries its body in the system codepage, not UTF-8, so Outlook shows fancy punctuation as mojibake
  // ("—" → "â€""). For the mailto text only, fold the punctuation we add down to plain ASCII.
  function ascii(s) {
    return String(s || '')
      .replace(/—/g, '--').replace(/–/g, '-').replace(/‒/g, '-').replace(/‑/g, '-')
      .replace(/·|•/g, '-').replace(/‘|’/g, "'").replace(/“|”/g, '"').replace(/…/g, '...');
  }

  // The whole email: the header block (name, state · dates, count · when), the message, the stories table, the sign-off.
  // opts { title, subtitle, when, message, signoff, rows, kind }.
  function composeHtml(opts) {
    var o = opts || {};
    return exportKit.followupHtml({
      title: o.title, subtitle: o.subtitle, when: o.when,
      intro: introHtml(o.message), signoff: introHtml(o.signoff), rows: o.rows || [], columns: columns(o.kind),
    });
  }

  // The same email as plain text (for the clipboard's text/plain and as a fallback).
  function composeText(opts) {
    var o = opts || {};
    var tbl = exportKit.tsv(o.rows || [], columns(o.kind));
    return [headerText(o), String(o.message || '').trim(), tbl, String(o.signoff || '').trim()].filter(Boolean).join('\n\n');
  }

  // mailto for "Open in Outlook": recipients, subject, and the message as plain text (with the header). A mail link
  // cannot carry an HTML table, so the body tells the user the table is on their clipboard — one Ctrl+V drops it in.
  function mailtoHref(opts) {
    var o = opts || {};
    var body = [headerText(o), String(o.message || '').trim(),
      '[ Click on this line and press Ctrl+V to paste the stories table. ]',
      String(o.signoff || '').trim()].filter(Boolean).join('\n\n');
    return 'mailto:' + encodeURIComponent(ascii(o.to || '')) + '?subject=' + encodeURIComponent(ascii(o.subject || '')) + '&body=' + encodeURIComponent(ascii(body));
  }

  return {
    firstName: firstName, names: names, greeting: greeting, TEMPLATES: TEMPLATES, template: template, message: message,
    columns: columns, introHtml: introHtml, headerText: headerText, ascii: ascii, tableHtml: tableHtml, tableText: tableText,
    composeHtml: composeHtml, composeText: composeText, mailtoHref: mailtoHref,
  };
});
