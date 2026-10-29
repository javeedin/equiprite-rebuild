define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Leaving the page: free the Gantt and the map (both hold DOM, listeners and, for the map, a WebGL context).
  class leaveChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      try {
        $page.functions.destroyViews();
      } catch (e) {
        console.warn('[schedule] could not free the views', e);
      }
    }
  }

  return leaveChain;
});
