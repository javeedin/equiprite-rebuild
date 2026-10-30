define([
  'vb/action/actionChain',
  'resources/js/portalView',
], (ActionChain, V) => {
  'use strict';

  // Accept, refuse or return: first say what it will do, on exactly the pieces the action would act on (portalView.plan,
  // New's pool: the ticked pieces, or all of them when none is ticked). Nothing is sent until the customer confirms.
  // When there is nothing to act on, or the acceptance would write to Fusion, it says so instead.
  class askChain extends ActionChain {
    async run(context, { kind }) {
      const { $page, $application } = context;
      const v = $page.variables;
      if (v.busy) return;
      v.deleteAsk = false;
      if (['accept', 'refuse', 'return'].indexOf(kind) === -1) {
        v.ask = {};
        return;
      }
      const pl = V.plan(kind, v.lines, v.ticks);
      if (!pl.ok) {
        v.ask = {};
        const head = v.head || {};
        v.banner = {
          type: pl.fusion.length ? 'warning' : 'info',
          text: pl.title + '. ' + pl.text,
          link: pl.fusion.length ? V.newRequestPage(($application.variables.appUrls || {}).new, 'customer-request', head.requestNumber, head.id) : '',
        };
        return;
      }
      v.banner = { type: '', text: '', link: '' };
      v.ask = { kind, title: pl.title, text: pl.text, button: pl.button, count: pl.eligible.length };
    }
  }

  return askChain;
});
