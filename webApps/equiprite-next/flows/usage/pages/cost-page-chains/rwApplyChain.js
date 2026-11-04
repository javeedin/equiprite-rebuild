define([
  'vb/action/actionChain',
  'resources/js/usageRedwood',
], (ActionChain, rw) => {
  'use strict';

  // The Redwood look (your menu, Look): what will be posted, the plan the current look lists, as Oracle's table's rows.
  // Runs whenever the plan changes (its onValueChanged); a request's load sets it more than once in a row, so the burst
  // is taken in once it settles (usageRedwood.latest), as an oj-table given new rows while still drawing gives up with an
  // error. Sets only the Redwood look's own variable, and only when it changed.
  class rwApplyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (!(await rw.latest('cost:' + (v.number || v.id || '')))) return;
      const plan = JSON.parse(JSON.stringify(v.plan || []));
      if (!rw.same(v.rwPlan, plan)) v.rwPlan = plan;
    }
  }

  return rwApplyChain;
});
