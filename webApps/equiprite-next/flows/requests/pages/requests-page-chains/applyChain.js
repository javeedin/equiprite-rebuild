define([
  'vb/action/actionChain',
  'resources/js/requestList',
  'resources/js/approvalQueue',
], (ActionChain, list, queue) => {
  'use strict';

  // What a view shows: requests read from their equipment, filtered by the chip, the source and the search, sorted;
  // the board's columns; or one row per piece of equipment. Given a view, its rows are worked out first and the view
  // switched last, so a view's template never meets the other view's rows. Each request carries the steps its row
  // offers (requestList.actions; approve and assign from Approve & allocate's own queue, so they always agree).
  class applyChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      const target = (params && params.view) || v.view;
      const now = Date.now();
      const kinds = {};
      queue.build(v.rows, v.linesByRequest, { now }).forEach((q) => { kinds[q.number] = q.kind; });
      const items = list.decorate(v.rows, v.linesByRequest, now).map((it) => Object.assign(it, {
        acts: list.actions(it, (v.linesByRequest || {})[it.requestNumber] || [], kinds[it.requestNumber] || '', v.can),
      }));
      let shown;
      let chips;
      let lanes = [];
      if (target === 'equipment') {
        const eq = list.equipmentRows(items, v.linesByRequest, now);
        chips = list.equipmentChips(eq);
        shown = list.filterEquipment(eq, v.text, v.stage, v.source);
      } else {
        chips = list.requestChips(items);
        shown = list.sort(list.filter(items, v.text, v.stage, v.source, v.linesByRequest), v.sortKey, v.sortDir);
        lanes = target === 'board' ? list.board(shown, 40) : [];
      }
      if (target !== v.view) {
        v.shown = [];
        v.view = target;
      }
      v.summary = list.summary(items);
      v.chips = chips;
      v.lanes = lanes;
      v.shown = shown;
    }
  }

  return applyChain;
});
