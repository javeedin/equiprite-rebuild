define([
  'vb/action/actionChain',
  'resources/js/alerts',
], (ActionChain, alerts) => {
  'use strict';

  class markAllReadChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const ids = ($page.variables.alerts || []).map((a) => a.id);
      $page.variables.readIds = alerts.saveRead(($page.variables.readIds || []).concat(ids));
      $page.variables.alerts = ($page.variables.alerts || []).map((a) => Object.assign({}, a, { read: true }));
      $page.variables.unread = 0;
    }
  }

  return markAllReadChain;
});
