define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
], (ActionChain, Actions, mp, snapshot, cu) => {
  'use strict';

  // The connection came or went (the shell's strip and toast say so). Back online: a list or a pick list shown from
  // this phone's copy is read again, and pieces ticked with no connection are pointed out: they were kept on the phone
  // and nothing was sent; the person ships them, the Ship sheet saying first what will happen. Never sent on its own.
  class connectionChain extends ActionChain {
    async run(context, { online, warm }) {
      const { $application } = context;
      const v = context.$page.variables;
      if (warm) return;
      const on = online === true || online === 'true';
      v.online = on;
      if (!on || v.busy) return;
      if (v.saved) await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      if (v.view === 'work' && v.openId && (v.workSaved || v.workError)) {
        await Actions.callChain(context, { chain: 'openWorkChain', params: { id: v.openId, keepBanner: false } });
      }
      if (v.view !== 'work' || !v.openId) return;
      const kept = mp.read(snapshot, cu.auditActor(context) || ($application.user || {}).username || '');
      const entry = mp.ticksOf(kept, v.openId, Date.now());
      const n = entry && entry.offline ? mp.liveTicks(v.work.lines, entry.ticks).length : 0;
      if (n) {
        v.banner = { type: 'info', text: 'Back online. ' + (n === 1 ? '1 piece' : n + ' pieces') + ' ticked with no connection '
          + (n === 1 ? 'is' : 'are') + ' kept on this phone: nothing was sent. Check them, then ship.' };
      }
    }
  }

  return connectionChain;
});
