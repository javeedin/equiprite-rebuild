define([
  'vb/action/actionChain',
  'resources/js/nav',
], (ActionChain, nav) => {
  'use strict';

  // The command bar: screens this role may open that match what is typed (label, group, keywords), and, when the text
  // looks like a request number, "Open request …" first.
  const MAX = 8;

  class commandChain extends ActionChain {
    async run(context, { text }) {
      const { $page, $application } = context;
      const v = $application.variables;
      const q = String(text || '');
      $page.variables.query = q;
      const groups = nav.visibleGroups(v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources);
      const out = nav.search(q, groups).map((r) => ({ kind: 'nav', navId: r.id, label: r.label, icon: r.icon, hint: r.group || 'Screen' }));
      const t = q.trim();
      const canRequests = groups.some((g) => g.items.some((i) => i.id === 'requests'));
      if (canRequests && /\d{3,}/.test(t)) {
        const number = /^\d+$/.test(t) ? 'REQ-' + t : t.toUpperCase();
        out.unshift({ kind: 'record', record: 'request', params: { number }, label: 'Open request ' + number, icon: 'oj-ux-ico-file-text', hint: 'Request' });
      }
      $page.variables.results = out.slice(0, MAX);
      $page.variables.resultIndex = 0;
      $page.variables.showResults = !!t;
    }
  }

  return commandChain;
});
