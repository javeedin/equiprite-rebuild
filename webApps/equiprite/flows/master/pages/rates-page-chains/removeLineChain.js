define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Remove one rate line: the old create-rate-schedule-page-chains/deleteScheduleLineChain.js for one line. As there,
  // a saved line is deleted on the server at once (DELETE /rate-period-lines/{id}), not on Save, and a line never
  // saved is just dropped; a failed DELETE is reported and the line stays. Changes: it asks first, saying the
  // delete is immediate, and acts on the line's own key instead of the grid's range selection.
  class removeLineChain extends ActionChain {
    async run(context, { key, confirmed }) {
      const { $page } = context;
      const v = $page.variables;
      const f = $page.functions;
      const line = (v.lines || []).find((l) => f.lineKey(l) === key);
      if (!line) return;
      if (!confirmed) {
        v.ask = {
          kind: 'removeLine', target: key,
          title: 'Remove the ' + f.periodLabel(line.period) + ' line of ' + f.groupTitle(line) + '?',
          message: line.id != null
            ? 'It is deleted from the schedule now, not when you save (as in Old EquipRite).'
            : 'It was never saved, so it is simply dropped.',
          ok: 'Remove line',
        };
        return;
      }
      v.ask = null;
      if (line.id != null) {
        const deleteResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/deleteRatePeriodLine',
          uriParams: { id: line.id }
        });
        if (!deleteResp.ok) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Delete Error',
            message: 'Failed to delete line from server: ' + deleteResp.status,
            displayMode: 'transient',
            type: 'error',
          });
          return;
        }
      }
      v.lines = (v.lines || []).filter((l) => f.lineKey(l) !== key);
      await Actions.fireNotificationEvent(context, {
        summary: 'Lines Deleted',
        message: 'Successfully deleted 1 line(s).',
        displayMode: 'transient',
        type: 'confirmation',
      });
    }
  }

  return removeLineChain;
});
