define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobilePick',
], (ActionChain, Actions, mp) => {
  'use strict';

  // Back to the list (Next's closeWorkChain; not while a step is in flight): frees the pick slip, forgets the open
  // request (its ticks stay on this phone), and the list comes back where it was scrolled to, its cards counting the
  // ticks.
  class closeWorkChain extends ActionChain {
    async run(context, { warm } = {}) {
      const v = context.$page.variables;
      if (warm || v.busy) return;
      if (v.scan && v.scan.open) await Actions.callChain(context, { chain: 'scanCloseChain' });
      if (v.slip && v.slip.url) {
        try { URL.revokeObjectURL(v.slip.url); } catch (e) { /* already gone */ }
      }
      const y = v.listY || 0;
      v.slip = { url: '', fileName: '', docNumber: '', rows: 0 };
      v.sheet = '';
      v.openId = '';
      v.ticks = [];
      v.selectedTOId = '';
      v.banner = { type: '', text: '' };
      v.workError = '';
      v.workSaved = '';
      v.flash = '';
      v.work = { req: {}, lines: [], exceptions: [], tos: [], yards: '' };
      v.check = mp.checklist(null, [], '', {});
      v.view = 'list';
      await Actions.callChain(context, { chain: 'applyChain' });
      if (typeof window !== 'undefined' && window.requestAnimationFrame) window.requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }

  return closeWorkChain;
});
