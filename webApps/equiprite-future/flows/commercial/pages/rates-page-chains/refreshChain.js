define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Refresh: the list again, then the open schedule again (unsaved changes are asked about first, as on leaving it).
  class refreshChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.hidden) return;
      v.isLoading = true;
      try {
        await Actions.callChain(context, { chain: 'loadSchedulesChain' });
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
      if (v.selectedId && v.selectedId !== 'new') {
        await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: v.selectedId } });
      }
    }
  }

  return refreshChain;
});
