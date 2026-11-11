define(['resources/js/minutes'], (R) => {
  'use strict';

  // Standup minutes: binding helpers. The rules are resources/js/minutes.js; the work is the chains (minutes-page-chains).
  // None uses `this`.
  const kept = {};
  function memo(key, content, make) {
    const json = JSON.stringify(content);
    if (!kept[key] || kept[key].json !== json) kept[key] = { json, value: make ? make(content) : content };
    return kept[key].value;
  }

  const PROVIDERS = { claude: 'Claude (Anthropic)', openai: 'OpenAI (ChatGPT)', gemini: 'Google Gemini', oci: 'OCI GenAI', custom: 'OpenAI-compatible' };

  function distinct(rows, of) { const seen = {}, out = []; (rows || []).forEach((r) => { const v = String(of(r) || '').trim(); if (v && !seen[v]) { seen[v] = 1; out.push(v); } }); return out; }

  function initialsOf(s) {
    const t = String(s || '').replace(/<[^>]*>/g, '').trim();
    if (!t) return '?';
    if (t.indexOf('@') !== -1 && t.indexOf(' ') === -1) return t.slice(0, 2).toUpperCase();
    const parts = t.split(/\s+/).filter(Boolean);
    return ((parts[0] || '')[0] + (parts.length > 1 ? (parts[parts.length - 1] || '')[0] : '')).toUpperCase();
  }

  class PageModule {
    /** The line under the title: where the minutes live, and how many are kept. */
    subtitle(available, meetings, jiraReady) {
      if (!available) return 'Standup minutes are kept on this PC by the EquipRite desktop app.';
      const n = (meetings || []).length;
      return n + (n === 1 ? ' meeting' : ' meetings') + ' kept in DuckDB on this PC' + (jiraReady ? ' · linked to the Jira backlog' : '');
    }

    summarise(meeting) { return memo('sum', meeting || {}, (m) => R.summarise(m)); }

    /** The tracking rows for the chosen dimension (epic / story / customer). */
    tracks(meetings, rows, trackBy) {
      return memo('tracks-' + trackBy, { m: meetings, r: rows, b: trackBy }, (x) => {
        if (x.b === 'story') return R.stories(x.m, x.r);
        if (x.b === 'customer') return R.customers(x.m);
        return R.epics(x.m, x.r);
      });
    }
    openActions(meetings) { return memo('oa', meetings || [], (m) => R.openActions(m)); }
    trackClass(trackBy, key) { return 'nx-chip nx-cm-chip--sm' + (trackBy === key ? ' nx-chip--on' : ''); }

    /** For a line's story key: "Equipment Master List · EQP-1 Equipment Registry", from the backlog, else ''. */
    storyHint(line, rows) {
      const k = line && line.jiraKey ? String(line.jiraKey).trim().toUpperCase() : '';
      if (!k) return '';
      const r = (rows || []).filter((x) => x.key === k)[0];
      if (!r) return k + ' — not in the backlog read';
      return r.summary + (r.epicKey ? ' · ' + r.epicKey + ' ' + r.epicName : '') + (r.labels && r.labels.length ? ' · ' + r.labels.join(', ') : '');
    }

    /** The story picker dialog's rows: the backlog filtered by the free-text search and the sprint/status/assignee
     *  filters, sprint-wise (active sprint first). Search matches the number, summary, status, assignee, sprint, epic
     *  and labels — every word must match somewhere, so "map rahul" finds Rahul's map story. */
    pickList(rows, q, sprint, status, assignee) {
      return memo('picklist', { r: rows, q: q, sprint: sprint, status: status, assignee: assignee }, (x) => {
        const today = new Date().toISOString().slice(0, 10);
        const ord = { active: 0, future: 1, closed: 2 };
        const rank = (r) => (r.sprint ? (ord[r.sprintState] == null ? 3 : ord[r.sprintState]) : 4);
        const terms = String(x.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        return (x.r || []).filter((r) => {
          if (x.sprint && String(r.sprint || '') !== x.sprint) return false;
          if (x.status && String(r.status || '') !== x.status) return false;
          if (x.assignee && (String(r.assignee || '') || 'Unassigned') !== x.assignee) return false;
          if (terms.length) {
            const hay = [r.key, r.summary, r.status, r.assignee, r.sprint, r.epicKey, r.epicName, (r.labels || []).join(' ')].join(' ').toLowerCase();
            if (!terms.every((t) => hay.indexOf(t) !== -1)) return false;
          }
          return true;
        }).slice().sort((a, b) => rank(a) - rank(b) || String(a.sprint || '~').localeCompare(b.sprint || '~') || String(a.key).localeCompare(String(b.key)))
          .map((r) => ({ key: r.key, summary: r.summary || '', status: r.status || '', statusCat: r.statusCat || 'new',
            assignee: r.assignee || 'Unassigned', due: r.due || '', sprint: r.sprint || '',
            overdue: !!(r.due && r.due < today && r.statusCat !== 'done') }));
      });
    }
    /** Distinct sprints / statuses / assignees in the backlog, for the picker's filter dropdowns. */
    pickSprints(rows) { return memo('picksprints', rows || [], (rs) => distinct(rs, (r) => r.sprint).sort((a, b) => b.localeCompare(a))); }
    pickStatuses(rows) { return memo('pickstatuses', rows || [], (rs) => distinct(rs, (r) => r.status).sort()); }
    pickAssignees(rows) { return memo('pickassignees', rows || [], (rs) => distinct(rs, (r) => r.assignee || 'Unassigned').sort()); }
    /** A small coloured status badge for a picker row, from the Jira status category. */
    pickBadge(cat) { return 'nx-min-pk-badge nx-min-pk-badge--' + (cat === 'done' ? 'done' : (cat === 'indeterminate' ? 'prog' : 'todo')); }
    /** A chip shows the attendee's name (an Outlook pick is kept as "Name <email>"). */
    chipName(a) { return R.attendeeName(a); }

    /** The Outlook-style suggestions for what is typed: people whose name or email matches, not already added. */
    suggest(people, draft, attendees) {
      return memo('suggest', { p: people, d: draft, a: attendees }, (x) => {
        const q = String(x.d || '').trim().toLowerCase();
        if (!q) return [];
        const taken = {};
        (x.a || []).forEach((v) => { taken[R.attendeeEmail(v).toLowerCase()] = true; taken[R.attendeeName(v).toLowerCase()] = true; });
        return (x.p || []).filter((pp) => {
          if (!pp) return false;
          if ((String(pp.name || '') + ' ' + String(pp.email || '')).toLowerCase().indexOf(q) === -1) return false;
          return !(taken[String(pp.email || '').toLowerCase()] || taken[String(pp.name || '').toLowerCase()]);
        }).slice(0, 8).map((pp) => ({
          value: pp.email ? (pp.name + ' <' + pp.email + '>') : pp.name,
          name: pp.name || pp.email, email: pp.email || '', initials: initialsOf(pp.name || pp.email)
        }));
      });
    }

    recActive(line, recLineId) { return !!line && line.id === recLineId; }
    recLabel(line, recLineId) { return (!!line && line.id === recLineId) ? '◼ Stop' : '🎤 Voice'; }
    fmtActive(line, fmtLineId) { return !!line && line.id === fmtLineId; }

    /** The AI button's words: the LLM set, or an invitation to set one. */
    aiLabel(ai, aiReady) {
      if (aiReady && ai && ai.active) return 'AI: ' + (PROVIDERS[ai.active] || ai.active);
      return 'Set up AI';
    }
    providerName(id) { return PROVIDERS[id] || id; }

    lineText(line) { return R.lineText(line); }
    hasText(line) { return !!R.lineText(line); }
    isOpen(line) { return !!line && line.status !== 'done'; }
    canSend(meeting) { return !!meeting && (meeting.lines || []).some((l) => R.lineText(l)); }
    count(list) { return (list || []).length; }
    dueClass(it) { return it && it.overdue ? 'nx-jira-bad' : ''; }
    statusClass(it) { return 'nx-min-st nx-min-st--' + (it && it.status === 'done' ? 'done' : 'open'); }
  }

  return PageModule;
});
