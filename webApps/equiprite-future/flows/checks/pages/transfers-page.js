define(['resources/js/exportKit', 'resources/js/nav', 'resources/js/transferList'], (exportKit, nav, list) => {
  'use strict';

  // Transfers: binding helpers. The logic is resources/js/transferList.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }

    sortMark(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''; }

    ariaSort(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'; }

    /** A screen in New EquipRite ('' when New's address is not known). */
    newUrl(base, navId) { return nav.newUrl(base, navId); }

    /** Inter-project transfer switched off in Configuration (ENABLE_INTER_PROJECT_TRANSFER explicitly false). */
    interProjectOff(flags, loaded) { return list.interProjectOff(flags, loaded); }

    /** "3 units" / "Open to see the equipment". */
    unitsText(r) {
      if (!r.read) return r.state === 'cancelled' ? '' : 'Open it to see the equipment';
      return r.unitCount === 1 ? '1 unit' : r.unitCount + ' units';
    }
  }

  return PageModule;
});
