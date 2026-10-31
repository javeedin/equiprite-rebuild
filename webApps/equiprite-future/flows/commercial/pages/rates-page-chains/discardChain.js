define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Discard changes: the open schedule is read again as it is saved; a new one not yet saved goes, and the first
  // schedule opens. Nothing is written.
  class discardChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.saving) return;
      v.dirty = false;
      if (v.selectedId && v.selectedId !== 'new') {
        await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: v.selectedId, confirmed: true } });
        return;
      }
      const rows = v.schedules || [];
      const pick = rows.find((r) => r.status === 'ACTIVE') || rows[0];
      if (pick) {
        await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: pick.id, confirmed: true } });
      } else {
        v.selectedId = '';
        v.formData = {};
        v.lines = [];
      }
    }
  }

  return discardChain;
});
