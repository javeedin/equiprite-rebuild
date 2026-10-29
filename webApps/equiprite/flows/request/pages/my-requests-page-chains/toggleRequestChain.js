define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens or closes a card's full equipment list in place. A request whose lines the bulk view did not return gets
  // them from views/request-detail-lines (the call Request detail makes) the first time it is opened.
  class toggleRequestChain extends ActionChain {
    async run(context, { number, id }) {
      const { $page } = context;
      const key = String(number || '');
      if (!key) return;
      const expanded = Object.assign({}, $page.variables.expanded);
      if (expanded[key]) {
        delete expanded[key];
        $page.variables.expanded = expanded;
        return;
      }
      expanded[key] = true;
      $page.variables.expanded = expanded;
      const have = ($page.variables.linesByRequest || {})[key];
      if ((have && have.length) || !id) return;

      $page.variables.loadingLines = Object.assign({}, $page.variables.loadingLines, { [key]: true });
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
          uriParams: { requestId: Number(id), size: 500 },
        });
        const raw = (res && res.ok && res.body && Array.isArray(res.body.data)) ? res.body.data : [];
        const lines = raw.map((r) => $page.functions.lineOf(r, key));
        $page.variables.linesByRequest = Object.assign({}, $page.variables.linesByRequest, { [key]: lines });
      } catch (e) {
        console.warn('[toggleRequestChain] lines not loaded for', key, e);
      } finally {
        const loading = Object.assign({}, $page.variables.loadingLines);
        delete loading[key];
        $page.variables.loadingLines = loading;
      }
    }
  }

  return toggleRequestChain;
});
