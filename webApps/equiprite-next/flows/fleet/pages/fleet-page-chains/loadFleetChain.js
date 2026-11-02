define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fleetData',
], (ActionChain, Actions, fleetData) => {
  'use strict';

  // The fleet, unit by unit (resources/js/fleetData.js): yard stock, units out and bookings, each read page by page
  // and on its own, joined by equipmentBoard.build. What could not be read is said on the page, with its HTTP status:
  // the whole fleet missing (error), or a part of it (notes). Reads only.
  class loadFleetChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.isLoading = true;
      try {
        const res = await fleetData.load((options) => Actions.callRest(context, options), Date.now());
        v.units = res.units;
        v.error = res.error || res.notes.join(' ');
        if (res.failed.length || res.skipped) console.warn('[loadFleetChain]', res.error || res.notes.join(' '));
      } catch (e) {
        console.error('[loadFleetChain] failed', e);
        v.units = [];
        v.error = 'The fleet could not be loaded: ' + ((e && e.message) || e) + '.';
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadFleetChain;
});
