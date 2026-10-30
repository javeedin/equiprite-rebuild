define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/cartDrafts',
  'resources/js/currentUser',
  'resources/js/mobileBus',
  'resources/js/mobileRequest',
], (ActionChain, Actions, requestData, cartDrafts, cu, bus, mr) => {
  'use strict';

  // What to start from, from the shared request list (requestData): your drafts to carry on with (cartDrafts, as Next's
  // cart in the top bar and the shell's count read them) and the requests sent back to you to fix, then your past
  // project requests to order again. The count of your drafts goes on this tab's icon (mobileBus.badge), as the shell
  // counts it. Reads only; with no connection the last ones stay.
  class draftsChain extends ActionChain {
    async run(context, { refresh }) {
      const { $page, $application } = context;
      const pv = $page.variables;
      let data;
      try {
        data = await requestData.load(context, Actions, { refresh: !!refresh });
      } catch (e) {
        return;
      }
      if (!data || data.error) return;
      const who = [cu.auditActor(context), cu.displayName(context), ($application.user || {}).username];
      const mine = cartDrafts.list(data.rows, data.linesByRequest, who, Date.now()).mine;
      const carry = mr.carryOn(mine, data.rows, data.linesByRequest, who, 5);
      pv.drafts = carry.cards;
      pv.draftMore = carry.more;
      pv.recent = mr.recent(data.rows, data.linesByRequest, who, 4);
      bus.badge('request', mine.length);
    }
  }

  return draftsChain;
});
