define(['vb/action/actionChain', 'resources/js/mobileApprove'], (ActionChain, ma) => {
  'use strict';

  // The bottom sheets that say what a step will do before it is done, and closing them:
  //   approve | reject  the decision (the lines chosen, or every line): Next's Approve, and its "Send back…" asking
  //                     for a reason first
  //   assign            the suggested units of every line (Next's "Auto-allocate…" confirmation)
  //   ''                close the sheet (the unit sheet's picker is dropped with it); dismiss: also the last result
  // Nothing is written here.
  class sheetChain extends ActionChain {
    async run(context, { sheet, dismiss }) {
      const { $page } = context;
      const pv = $page.variables;
      if (pv.busy) return;
      if (!sheet) {
        pv.sheet = '';
        pv.formError = '';
        pv.pickNote = '';
        if (pv.picker && pv.picker.lineId) {
          pv.picker = { lineId: '' };
          $page.functions.clearPicker();
        }
        if (dismiss) pv.result = null;
        return;
      }
      const head = pv.rec && pv.rec.head;
      if (!pv.canAct || !head || !head.id || (pv.rec && pv.rec.offline)) return;
      if (sheet === 'approve' || sheet === 'reject') {
        if (!head.deciding) return;
        const plain = (v) => JSON.parse(JSON.stringify(v));
        const decision = ma.decideSheet(sheet, plain(head), plain(pv.lines || []), plain(pv.ticks || []));
        if (!decision.count) return;
        pv.decision = decision;
        pv.formError = '';
        pv.sheet = sheet;
        return;
      }
      if (sheet === 'assign') {
        if (!(pv.sugg && pv.sugg.plan && pv.sugg.plan.count)) return;
        pv.sheet = 'assign';
      }
    }
  }

  return sheetChain;
});
