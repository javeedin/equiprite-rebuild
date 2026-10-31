define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
], (ActionChain, Actions, tabs, shellTabs) => {
  'use strict';

  // What a screen asked of the shell (resources/js/shellBus.js): open a screen or record, rename or close a tab, toast.
  class shellRequestChain extends ActionChain {
    async run(context, { request }) {
      const r = request || {};
      if (r.action === 'open') {
        await Actions.callChain(context, { chain: 'openChain', params: r.record ? { record: r.record, params: r.params || {} } : { navId: r.navId } });
      } else if (r.action === 'rename' && r.id && r.title) {
        await shellTabs.update(context, Actions, (st) => tabs.rename(st, r.id, r.title));
      } else if (r.action === 'close' && r.id) {
        await Actions.callChain(context, { chain: 'closeTabChain', params: { id: r.id } });
      } else if (r.action === 'toast') {
        await Actions.callChain(context, { chain: 'toastChain', params: { message: r.message, tone: r.tone } });
      }
    }
  }

  return shellRequestChain;
});
