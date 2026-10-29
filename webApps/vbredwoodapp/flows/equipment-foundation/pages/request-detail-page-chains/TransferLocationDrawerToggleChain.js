define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /** Mirrors LocationDrawerToggleChain — inits/destroys the Mapbox map as the drawer opens/closes. */
  class TransferLocationDrawerToggleChain extends ActionChain {
    async run(context, { opened } = {}) {
      const { $page } = context;
      const isOpen = (opened === true || opened === 'true');
      const fns = $page.functions || {};
      if (isOpen) {
        if (typeof fns.initLocationMap === 'function') fns.initLocationMap();
      } else {
        if (typeof fns.destroyLocationMap === 'function') fns.destroyLocationMap();
      }
    }
  }

  return TransferLocationDrawerToggleChain;
});
