define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Check-out / Check-in, the point chips and "asked for / everything waiting". A new mode clears the point.
  class setQueueChain extends ActionChain {
    async run(context, { mode, point, scope }) {
      const { $page } = context;
      const v = $page.variables;
      if (mode === 'out' || mode === 'in') {
        if (v.mode !== mode) {
          v.point = '';
        }
        v.mode = mode;
      }
      if (point !== undefined && point !== null) {
        v.point = String(point);
      }
      if (scope === 'required' || scope === 'all') {
        v.scope = scope;
      }
    }
  }

  return setQueueChain;
});
