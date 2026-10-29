define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens (or closes, with no request number) a request's preview. The request's context comes from its list row,
  // which is what the old CardClickChain handed the drill-down: internal id, project and task, the four PPM ids,
  // the rate schedule and the planned dates.
  class openRequestChain extends ActionChain {
    async run(context, { requestNumber }) {
      const { $page } = context;
      const v = $page.variables;
      if (v.isPosting) return;
      v.panel = '';
      v.postError = '';
      v.postSuccess = '';
      if (!requestNumber) {
        v.current = null;
        v.rowsAll = [];
        v.facts = {};
        return;
      }
      const row = (v.list || []).find((r) => r.requestNumber === requestNumber);
      v.current = row ? Object.assign({}, row) : { requestNumber: String(requestNumber), eqrEquipmentRequestId: 0, projectName: '', taskName: '' };
      await Actions.callChain(context, { chain: 'loadPreviewChain' });
    }
  }

  return openRequestChain;
});
