define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rateRules',
  'resources/js/shellBus',
], (ActionChain, Actions, R, bus) => {
  'use strict';

  // Remove one rate: New EquipRite's removeLineChain (the old deleteScheduleLineChain for one line). A saved line is
  // deleted on the server at once (DELETE /rate-period-lines/{id}), not on Save; a line never saved is just dropped; a
  // failed DELETE is said and the line stays. It asks first, saying the delete is immediate.
  class removeLineChain extends ActionChain {
    async run(context, { key, confirmed }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RATE_SCHEDULE') !== 'FULL') return;
      const line = (v.lines || []).find((l) => R.lineKey(l) === key);
      if (!line) return;
      if (!confirmed) {
        v.ask = {
          kind: 'removeLine', target: key,
          title: 'Remove the ' + R.periodLabel(line.period) + ' rate of ' + R.groupTitle(line) + '?',
          message: line.id != null
            ? 'It is deleted from the schedule now, not when you save (as in Old and New EquipRite).'
            : 'It was never saved, so it is simply dropped.',
          ok: 'Remove the rate',
        };
        return;
      }
      v.ask = null;
      if (line.id != null) {
        const deleteResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/deleteRatePeriodLine',
          uriParams: { id: line.id }
        });
        if (!deleteResp || !deleteResp.ok) {
          v.lineError = 'The rate could not be deleted (HTTP ' + (deleteResp && deleteResp.status) + '). It is still on the schedule.';
          bus.toast(v.lineError, 'error');
          return;
        }
      }
      v.lines = (v.lines || []).filter((l) => R.lineKey(l) !== key);
      v.lineError = '';
      bus.toast(line.id != null ? 'The ' + R.periodLabel(line.period) + ' rate of ' + R.groupTitle(line) + ' was deleted.' : 'The new rate was dropped.', 'info');
    }
  }

  return removeLineChain;
});
