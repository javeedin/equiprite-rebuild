define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class goToParentChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      // POP line-detail off the flow stack (don't push request-detail on top of
      // it). line-detail builds its Bryntum scheduler imperatively in vbEnter;
      // if the page stays cached, re-opening the SAME line restores the stale
      // instance without a full re-init and the picker renders empty. navigateBack
      // destroys this page instance so the next open is a fresh vbEnter build.
      try {
        await Actions.navigateBack(context, {});
        return;
      } catch (e) {
        // Fallback (e.g. deep-linked with no back history): go to the parent
        // explicitly.
        console.warn('[line-detail goToParentChain] navigateBack failed, falling back to navigateToPage:', e);
      }
      await Actions.navigateToPage(context, {
        page:   'request-detail',
        params: {
          requestId:     $page.variables.requestId,
          requestNumber: $page.variables.requestNumber
        }
      });
    }
  }

  return goToParentChain;
});
