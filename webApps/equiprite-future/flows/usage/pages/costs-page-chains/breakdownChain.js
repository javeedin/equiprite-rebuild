define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/costData',
], (ActionChain, Actions, costData) => {
  'use strict';

  // Works out each request on the list: what is ready to post, posted and running (costData.breakdown: its cost rows
  // and purchase requisitions, summed by New's buildPreview). Newest request first, three at a time, each figure shown
  // as it arrives. A request with no cost to date needs no read: it has nothing to post. A Refresh starts a new load
  // (gen), and this one stops. A request whose cost cannot be read keeps "…" and is counted as failed.
  const AT_ONCE = 3;
  const NOTHING = { ready: 0, readyWeeks: 0, readyCharges: 0, posted: 0, postedItems: 0, running: 0, runningWeeks: 0, pending: 0, pendingWeeks: 0,
    total: 0, lastPosted: '', netAdjustment: 0, retiered: false };

  class breakdownChain extends ActionChain {
    async run(context, { gen }) {
      const { $page } = context;
      const v = $page.variables;
      const list = (v.list || []).slice();
      const misc = v.misc || [];
      const withMisc = {};
      misc.forEach((m) => { if (m && m.requestNumber) withMisc[m.requestNumber] = true; });
      const empty = {};
      const todo = [];
      list.forEach((r) => {
        if (Number(r.totalBillCost || 0) > 0 || withMisc[r.requestNumber]) todo.push(r);
        else empty[r.requestNumber] = Object.assign({}, NOTHING);
      });
      v.breakdown = empty;
      v.progress = { done: 0, total: todo.length, failed: 0 };
      let next = 0;
      let failed = 0;
      const worker = async () => {
        while (next < todo.length) {
          const row = todo[next++];
          let b = null;
          try {
            b = await costData.breakdown(context, Actions, row, misc);
          } catch (e) {
            console.warn('[breakdownChain] ' + row.requestNumber + ' not worked out:', e && e.message);
          }
          if (v.gen !== gen) return;
          if (b) v.breakdown = Object.assign({}, v.breakdown, { [row.requestNumber]: b });
          else failed++;
          v.progress = { done: v.progress.done + 1, total: todo.length, failed };
        }
      };
      const workers = [];
      for (let i = 0; i < Math.min(AT_ONCE, todo.length); i++) workers.push(worker());
      await Promise.all(workers);
    }
  }

  return breakdownChain;
});
