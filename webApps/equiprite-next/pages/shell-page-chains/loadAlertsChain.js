define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/alerts',
  'resources/js/rules',
  'resources/js/nav',
  'resources/js/portalData',
  'resources/js/cartDrafts',
  'resources/js/currentUser',
], (ActionChain, Actions, requestData, alerts, rules, nav, portalData, cartDrafts, cu) => {
  'use strict';

  // The bell's list: alerts worked out from the requests and their equipment for this persona (late, waiting on
  // them), and the notifications service's entries for this user (read only). Read marks are this browser's. The
  // cart's count of drafts comes from the same request list.
  const MAX = 50;

  class loadAlertsChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $application.variables;
      $page.variables.alertsLoading = true;
      try {
        // A customer's bell reads their own views and the portal's rule; everyone else's, the requests (staff views).
        // Until page access is known neither is read (nothing is worked out on a guess).
        let data = { error: '' };
        let derived = [];
        if (!v.pageAccessLoaded) {
          derived = [];
        } else if (nav.customerOnly(v.pageAccessMap, v.pageAccessLoaded)) {
          data = await portalData.load(context, Actions);
          derived = alerts.fromPortal(data.needs);
        } else {
          data = await requestData.load(context, Actions, { refresh: true });
          derived = alerts.derive(rules.persona(v.fusionRoles, v.sessionRoles), data.rows, data.linesByRequest, Date.now());
          // The cart's count of drafts, from the same list.
          $page.variables.drafts = cartDrafts.list(data.rows, data.linesByRequest,
            [cu.auditActor(context), cu.displayName(context), ($application.user || {}).username], Date.now());
        }
        let updates = [];
        try {
          const u = $application.user || {};
          const userId = u.userId || u.username || u.login || u.userName || rules.userDisplayName(u);
          const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getNotifications', uriParams: userId ? { userId } : {} });
          if (res && res.ok) updates = alerts.fromServer((res.body && (res.body.data || res.body.items)) || []);
        } catch (e) {
          console.warn('[loadAlertsChain] notifications not read', e);
        }
        const merged = alerts.merge(derived, updates, $page.variables.readIds);
        $page.variables.alerts = merged.items.slice(0, MAX);
        $page.variables.unread = merged.unread;
        $page.variables.readIds = alerts.saveRead($page.variables.readIds, merged.items);
        $page.variables.alertsError = data.error || '';
        const d = new Date();
        $page.variables.alertsAt = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      } finally {
        $page.variables.alertsLoading = false;
      }
    }
  }

  return loadAlertsChain;
});
