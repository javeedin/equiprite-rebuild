define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // Closes the request's dialog (not while a step is in flight) and frees its pick slip. The list then shows where the
  // request sits: its row is scrolled to and flashes. back: the screen that opened it here comes to the front again
  // (Back to Requests, or to the request's tab).
  class closeWorkChain extends ActionChain {
    async run(context, { back }) {
      const v = context.$page.variables;
      if (v.busy) return;
      const id = String(v.openId || '');
      // A plain copy: the page variable is reset below, and a reference to it would read the reset value.
      const to = v.from && v.from.open ? JSON.parse(JSON.stringify(v.from.open)) : null;
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
      v.workLoading = false;
      v.work = { req: {}, lines: [], exceptions: [], tos: [], yards: '' };
      v.from = { label: '' };
      if (back && to) { bus.open(to); return; }
      if (!id) return;
      v.flashId = id;
      setTimeout(() => {
        const row = document.querySelector('#ydPicking .nx-yd-row[data-id="' + id + '"]');
        if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
      await new Promise((r) => setTimeout(r, 2600));
      if (v.flashId === id) v.flashId = '';
    }
  }

  return closeWorkChain;
});
