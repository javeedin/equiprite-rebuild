define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/approvalQueue',
  'resources/js/requestList',
  'resources/js/cartDrafts',
  'resources/js/currentUser',
  'resources/js/mobileTabs',
  'resources/js/mobileApprove',
  'resources/js/mobileRecent',
], (ActionChain, Actions, requestData, queue, requestList, cartDrafts, cu, mobileTabs, ma, recent) => {
  'use strict';

  // The counts on the tab icons, from the shared request list (requestData), for the tabs this role has:
  //   approve  requests waiting for this approver's decision (Approve & allocate's own queue)
  //   pick     pieces with a unit, ready for the yard to pick (the rule of Next's "Pick" on a request's row)
  //   request  your drafts, to carry on with
  // Approve and Pick count what their list opens on, the last few days (mobileRecent), so a count matches the list it
  // opens: Approve its cards' dates (raised, changed, start, end), Pick a request's start and end and its pieces' (the
  // dates the yard's work carries).
  // A tab may set its own count when it has loaded (mobileBus.badge). Reads only; nothing before page access is known.
  class countsChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $application.variables;
      if (!v.pageAccessLoaded) return;
      const has = (id) => mobileTabs.allowed(mobileTabs.tab(id), v.pageAccessMap, v.pageAccessLoaded);
      if (!has('approve') && !has('pick') && !has('request')) return;
      try {
        const data = await requestData.load(context, Actions, {});
        if (data.error) return;
        const now = Date.now();
        const linesOf = (r) => (data.linesByRequest || {})[r.requestNumber] || [];
        const counts = {};
        if (has('approve')) {
          const items = queue.build(data.rows, data.linesByRequest, { now });
          counts.approve = ma.badge(ma.cards(items, data.linesByRequest, data.rows, now), now);
        }
        if (has('pick')) {
          const lately = (r) => recent.recentAt(recent.latest(r, linesOf(r).reduce((d, l) => d.concat([l.start, l.end]), []), recent.SPAN), now);
          counts.pick = (data.rows || []).filter(lately).reduce((n, r) => n + requestList.actions(r, linesOf(r), '', { pick: true }).pick, 0);
        }
        if (has('request')) {
          const who = [cu.auditActor(context), cu.displayName(context), ($application.user || {}).username];
          counts.request = cartDrafts.list(data.rows, data.linesByRequest, who, now).mine.length;
        }
        $page.variables.badges = Object.assign({}, $page.variables.badges, counts);
      } catch (e) {
        console.warn('[countsChain] counts not read', e);
      }
    }
  }

  return countsChain;
});
