define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // Delete schedule: New EquipRite's deleteScheduleChain (the old one's DELETE /rate-schedules/{id}). FULL access; it
  // asks first; afterwards the list is read again and the first schedule opens. A failure is said and nothing changes.
  class deleteScheduleChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RATE_SCHEDULE') !== 'FULL') return;

      const scheduleId = Number(v.selectedId);
      if (!scheduleId) {
        return;
      }
      if (!(params && params.confirmed)) {
        const n = (v.lines || []).length;
        v.ask = {
          kind: 'deleteSchedule', title: 'Delete ' + (v.formData.scheduleName || 'this schedule') + '?',
          message: 'Deletes the schedule and its ' + n + ' rate' + (n === 1 ? '' : 's') + '. Requests priced from it '
            + 'fall back to the next matching schedule. This cannot be undone.',
          ok: 'Delete the schedule',
        };
        return;
      }
      v.ask = null;
      const name = v.formData.scheduleName || 'The schedule';

      try {
        const deleteResponse = await Actions.callRest(context, {
          endpoint: 'eqp-v1/deleteRateSchedule',
          uriParams: { id: scheduleId }
        });

        if (deleteResponse && deleteResponse.ok) {
          v.dirty = false;
          v.selectedId = '';
          v.formData = {};
          v.lines = [];
          await Actions.callChain(context, { chain: 'loadSchedulesChain' });
          await Actions.callChain(context, { chain: 'applyChain' });
          const first = (v.schedules || [])[0];
          if (first) {
            await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: first.id, confirmed: true } });
          }
          v.saveNote = '';
          bus.toast(name + ' was deleted.', 'info');
        } else {
          v.saveNote = name + ' could not be deleted (HTTP ' + (deleteResponse && deleteResponse.status) + ').';
          v.saveTone = 'error';
          bus.toast(v.saveNote, 'error');
        }
      } catch (error) {
        if (error && (error.name === 'AbortError' || (error.message && error.message.includes('Aborting stale fetch')))) {
          return;
        }
        v.saveNote = 'The schedule could not be deleted: ' + (error && error.message);
        v.saveTone = 'error';
        bus.toast(v.saveNote, 'error');
      }
    }
  }

  return deleteScheduleChain;
});
