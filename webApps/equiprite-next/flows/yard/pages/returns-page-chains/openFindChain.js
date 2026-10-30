define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/unitScanner',
], (ActionChain, Actions, scanner) => {
  'use strict';

  // Opens the unit search beside the list, cleared (the operator is holding a different piece: an old result would invite
  // returning the wrong one). New's OpenDirectReturnChain: whether a camera can scan here, and why not when it cannot.
  class openFindChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.busy) return;
      if (v.side === 'find') {
        await Actions.callChain(context, { chain: 'closeWorkChain' });
        return;
      }
      v.side = 'find';
      v.openId = '';
      v.exportOpen = '';
      v.ticks = [];
      v.banner = { type: '', text: '' };
      v.work = { req: {}, lines: [], tos: [], yards: '' };
      v.findQuery = '';
      v.found = [];
      v.foundTicks = [];
      v.foundMeta = { searched: false };
      v.findBanner = { type: '', text: '' };
      const probe = scanner.isCameraAvailable();
      v.scan = { supported: !!probe.ok, open: false, status: probe.ok ? '' : probe.message, reading: false, torch: false, torchOn: false };
      setTimeout(() => {
        const input = document.querySelector('#ydrQuery input');
        if (input && typeof input.focus === 'function') input.focus();
      }, 60);
    }
  }

  return openFindChain;
});
