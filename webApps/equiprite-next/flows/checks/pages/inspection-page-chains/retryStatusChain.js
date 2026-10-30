define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/requestLineBody',
  'resources/js/requestData',
], (ActionChain, Actions, cu, lineBody, requestData) => {
  'use strict';

  // The inspection was completed but the line status (EQP_INSPECTION_COMPLETE / INSPECTION_FAILED) did not change: try
  // that one PATCH again, so the inspection is not repeated just to move the line (New EquipRite's retryStatusChain).
  class retryStatusChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const d = v.done;
      if (!d || !d.pendingStatus || v.isSaving) {
        return;
      }
      v.isSaving = true;
      try {
        const r = await lineBody.updateLines(context, Actions, {
          requestId: Number(d.line.requestId),
          headers: cu.auditHeaders(context),
          updates: [{ id: Number(d.line.lineId), lineStatus: d.pendingStatus }],
          labels: [d.unit],
        });
        v.done = Object.assign({}, d, r.ok
          ? { lineStatus: d.pendingStatus, pendingStatus: '', statusError: '' }
          : { statusError: r.message });
        if (r.ok) {
          requestData.invalidate();
        }
      } finally {
        v.isSaving = false;
      }
    }
  }

  return retryStatusChain;
});
