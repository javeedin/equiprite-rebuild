define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Save the Edit Line dialog: PATCH the line's rate + start/end date, then
  // refresh the grid so the row reflects the new values. In-flight guarded via
  // editLineSaving (disables the Save button).
  class SaveEditLineChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const idx   = Number($page.variables.editLineRowIndex);
      const lines = $page.variables.linesArray || [];
      const line  = lines[idx];
      const requestId = $page.variables.requestId;

      if (!line || line.line_id == null || !requestId) {
        console.warn('[SaveEditLineChain] missing line / line_id / requestId', idx);
        return;
      }

      // Normalize dates to YYYY-MM-DD (oj-input-date may hand back an ISO
      // datetime); the line view stores/returns date-only.
      const toYmd = (v) => (v ? String(v).substring(0, 10) : '');
      const rate  = Number($page.variables.editLineRate) || 0;
      const start = toYmd($page.variables.editLineStartDate);
      const end   = toYmd($page.variables.editLineEndDate);

      $page.variables.editLineSaving = true;

      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchRequestLine',
          uriParams: { requestId: Number(requestId), id: Number(line.line_id) },
          body:      { billRate: rate, startDate: start, endDate: end }
        });
      } catch (e) {
        console.error('[SaveEditLineChain] patchRequestLine threw:', e);
      }

      $page.variables.editLineSaving = false;

      if (!resp || !resp.ok) {
        const serverMsg = resp && resp.body && (resp.body.message || JSON.stringify(resp.body));
        await Actions.fireNotificationEvent(context, {
          summary:     'Line Update Failed',
          message:     serverMsg ? ('HTTP ' + resp.status + ': ' + serverMsg)
                                 : 'The server rejected the line update.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      const dialog = document.getElementById('editLineDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();
      $page.variables.editLineRowIndex = -1;

      // Refresh the grid + totals from the server (reuses the page's refresh
      // action so availability/rate re-resolve consistently). Same chain the
      // onRefreshRequest listener runs.
      await Actions.callChain(context, {
        chain: 'ActionChain',
        params: { actionType: 'refresh' }
      });

      await Actions.fireNotificationEvent(context, {
        summary:     'Line Updated',
        message:     'Rate and dates saved.',
        type:        'confirmation',
        displayMode: 'transient'
      });
    }
  }

  return SaveEditLineChain;
});
