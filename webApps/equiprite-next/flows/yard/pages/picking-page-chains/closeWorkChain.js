define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Closes the open request (not while a step is in flight) and frees its pick slip.
  class closeWorkChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.busy) return;
      if (v.slip && v.slip.url) {
        try { URL.revokeObjectURL(v.slip.url); } catch (e) { /* already gone */ }
      }
      v.slip = { url: '', fileName: '', docNumber: '', rows: 0 };
      v.openId = '';
      v.exportOpen = '';
      v.ticks = [];
      v.selectedTOId = '';
      v.banner = { type: '', text: '' };
      v.workError = '';
      v.work = { req: {}, lines: [], exceptions: [], tos: [], yards: '' };
    }
  }

  return closeWorkChain;
});
