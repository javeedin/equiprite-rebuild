define(['resources/js/followup'], (F) => {
  'use strict';

  // Follow-ups page: binding helpers. The follow-ups are kept on this PC (desktop/lib/followups.js, via
  // resources/js/followupsClient.js); the chains are followups-page-chains. No function uses `this` (a binding may call
  // one detached).

  function whenText(iso) { try { return iso ? new Date(iso).toLocaleString() : ''; } catch (e) { return ''; } }
  function scopeText(f) { return f && f.sprintName ? 'Sprint ' + f.sprintName : ((f && f.source) || 'Jira stories'); }
  function itemsText(f) { const n = (f && (f.itemCount != null ? f.itemCount : (f.lines ? f.lines.length : 0))) || 0; return n + (n === 1 ? ' story' : ' stories'); }
  function rowsOf(d) {
    return ((d && d.lines) || []).map((l) => ({ key: l.storyKey, summary: l.summary, status: l.status, assignee: l.assignee,
      sprint: l.sprint, due: l.due, overdue: l.overdue, labels: l.customer ? String(l.customer).split(', ') : [], url: l.url }));
  }

  class PageModule {
    whenText(iso) { return whenText(iso); }
    scopeText(f) { return scopeText(f); }
    itemsText(f) { return itemsText(f); }
    rowClass(id, sel) { return 'nx-fl-row' + (id === sel ? ' nx-fl-row--on' : ''); }

    /** The header note: "3 saved follow-ups". */
    countText(list) { const n = (list || []).length; return n === 0 ? 'No follow-ups saved yet' : n + (n === 1 ? ' saved follow-up' : ' saved follow-ups'); }

    /** The open follow-up rendered as the email that was composed (for the preview iframe). */
    detailHtml(detail) {
      if (!detail) return '';
      return F.composeHtml({ title: detail.title, subtitle: detail.subtitle, when: whenText(detail.createdAt),
        message: detail.message, signoff: detail.signoff, rows: rowsOf(detail), kind: detail.kind });
    }
  }

  return PageModule;
});
