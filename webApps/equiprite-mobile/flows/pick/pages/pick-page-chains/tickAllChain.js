define([
  'vb/action/actionChain',
  'resources/js/yardWork',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
], (ActionChain, yw, mp, snapshot, cu) => {
  'use strict';

  // A group's box (Next's tickAllChain, for one step's pieces): every piece being picked, or every fixed asset waiting
  // for release, or none of them when all are ticked. The other step's ticks stay. Kept on this phone.
  class tickAllChain extends ActionChain {
    async run(context, { group, warm }) {
      const { $application } = context;
      const v = context.$page.variables;
      if (warm || !v.can.act || v.busy) return;
      const key = group === 'release' ? 'release' : 'pick';
      const work = v.work;
      const ticks = mp.toggleGroup(work.lines, v.ticks, key);
      const selectedTOId = yw.selectedTOIdFor(work.tos, work.lines, ticks);
      v.selectedTOId = selectedTOId;
      v.ticks = ticks;
      v.check = mp.checklist(work, ticks, selectedTOId, { syncOn: v.can.sync, external: work.req && work.req.isCustomer });
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const user = cu.auditActor(context) || ($application.user || {}).username || '';
      mp.keep(snapshot, user, (k, at) => mp.withTicks(k, String((work.req && work.req.id) || v.openId), (work.req && work.req.requestNumber) || '',
        ticks, offline ? true : undefined, at));
    }
  }

  return tickAllChain;
});
