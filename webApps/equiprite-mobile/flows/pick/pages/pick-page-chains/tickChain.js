define([
  'vb/action/actionChain',
  'resources/js/yardWork',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
], (ActionChain, yw, mp, snapshot, cu) => {
  'use strict';

  // One piece ticked or unticked (Next's tickChain: the single ticked transfer order follows the ticks, as in New).
  // checked: true | false, or none to turn it over (a tap). Only with full access, and only a piece a phone may tick
  // (mobilePick.tickable: being picked, or a fixed asset waiting for release). Nothing is sent: the ticks are kept on
  // this phone, marked when made with no connection (picked, not yet sent).
  class tickChain extends ActionChain {
    async run(context, { lineId, checked, source }) {
      const { $application } = context;
      const v = context.$page.variables;
      if (lineId === undefined || lineId === null || lineId === '') return;
      if (!v.can.act || v.busy) return;
      const work = v.work;
      const line = (work.lines || []).filter((l) => String(l.lineId) === String(lineId))[0];
      if (!line || !mp.tickable(line)) return;
      const was = (v.ticks || []).map(String).indexOf(String(lineId)) !== -1;
      const on = checked === undefined || checked === null || checked === '' ? !was : (checked === true || checked === 'true');
      const ticks = yw.toggleTick(v.ticks, lineId, on);
      const selectedTOId = yw.selectedTOIdFor(work.tos, work.lines, ticks);
      v.selectedTOId = selectedTOId;
      v.ticks = ticks;
      v.check = mp.checklist(work, ticks, selectedTOId, { syncOn: v.can.sync, external: work.req && work.req.isCustomer });
      if (source === 'tap' && on && typeof navigator !== 'undefined') mp.vibrate(navigator, 'tap');
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const user = cu.auditActor(context) || ($application.user || {}).username || '';
      const id = String((work.req && work.req.id) || v.openId);
      const number = (work.req && work.req.requestNumber) || '';
      mp.keep(snapshot, user, (k, at) => mp.withTicks(k, id, number, ticks, offline ? true : undefined, at));
    }
  }

  return tickChain;
});
