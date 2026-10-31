define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/integrationsView',
], (ActionChain, Actions, view) => {
  'use strict';

  // Reads everything Integrations shows, in parallel: New EquipRite's loadHealthChain, unchanged (the same six
  // endpoints and params). A read that fails leaves its part empty and is named on the page; the rest still shows.
  class loadChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const ih = view.health;
      v.isLoading = true;
      try {
        const failed = [];
        const results = await Promise.all(view.READS.map((r) => {
          const options = { endpoint: r.endpoint };
          if (r.uriParams) options.uriParams = Object.assign({}, r.uriParams);
          return Actions.callRest(context, options).catch(() => null);
        }));
        const raw = {};
        view.READS.forEach((r, i) => {
          const res = results[i];
          if (!res || !res.ok) {
            failed.push({ what: r.what, status: res ? res.status : 0 });
            raw[r.key] = r.single ? null : [];
            return;
          }
          raw[r.key] = r.single ? (res.body || null) : ih.rowsOf(res.body);
        });
        const now = Date.now();
        v.raw = raw;
        v.checkedAt = ih.stamp(now);
        v.loadNote = ih.loadNote(failed);
        v.m = view.view(raw, now, { integ: v.integ });
        v.loaded = true;
      } catch (e) {
        console.error('[integrations loadChain] failed', e);
        v.loadNote = 'Integration health could not be read. Check again in a minute.';
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadChain;
});
