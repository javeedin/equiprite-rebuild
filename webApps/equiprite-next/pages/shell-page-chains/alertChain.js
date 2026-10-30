define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/alerts',
], (ActionChain, Actions, alerts) => {
  'use strict';

  // An alert was clicked: it is read, the bell closes, and what it is about opens in a tab.
  class alertChain extends ActionChain {
    async run(context, { id }) {
      const { $page } = context;
      const a = ($page.variables.alerts || []).filter((x) => x.id === id)[0];
      if (!a) return;
      if (!a.read) {
        $page.variables.readIds = alerts.saveRead(($page.variables.readIds || []).concat([id]));
        $page.variables.alerts = $page.variables.alerts.map((x) => (x.id === id ? Object.assign({}, x, { read: true }) : x));
        $page.variables.unread = Math.max(0, $page.variables.unread - 1);
      }
      $page.variables.bellOpen = false;
      if (a.open && a.open.record) await Actions.callChain(context, { chain: 'openChain', params: { record: a.open.record, params: a.open.params } });
      else if (a.open && a.open.navId) await Actions.callChain(context, { chain: 'openChain', params: { navId: a.open.navId } });
    }
  }

  return alertChain;
});
