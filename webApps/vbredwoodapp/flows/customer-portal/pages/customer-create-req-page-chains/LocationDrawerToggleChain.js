define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Fired on the location drawer's on-opened-changed. When it opens, build the
  // Mapbox map into #ccr-map (page module owns the imperative widget); when it
  // closes, tear the map down so it can't leak across opens.
  class LocationDrawerToggleChain extends ActionChain {
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

  return LocationDrawerToggleChain;
});
