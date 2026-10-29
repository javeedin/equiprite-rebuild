define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Search, filter chips, view and map picks.
  //   search (typed), class, subclass, group  → server filters: the list is read again (loadEquipmentChain).
  //                                             Typing waits for a short pause, and only the last text is sent.
  //   status, tracking, source, location      → narrow the rows already loaded (applyFilterChain).
  //   view, panel                             → grid or map; open or close the class / group filters.
  //   clear                                   → every filter off; read again only when a server filter was on.
  // Clicking the chip that is on turns it off.
  const PAUSE_MS = 300;
  let typing = 0;

  class setFilterChain extends ActionChain {
    async run(context, { kind, value }) {
      const { $page } = context;
      const v = $page.variables;
      const val = value == null ? '' : String(value);
      const toggle = (cur) => (String(cur) === val ? '' : val);

      switch (kind) {
        case 'search': {
          v.searchText = val;
          const mine = ++typing;
          await new Promise((r) => setTimeout(r, PAUSE_MS));
          if (mine !== typing) return;
          await Actions.callChain(context, { chain: 'loadEquipmentChain' });
          return;
        }
        case 'class':
          v.classId = toggle(v.classId);
          v.subclassId = '';
          break;
        case 'subclass':
          v.subclassId = toggle(v.subclassId);
          break;
        case 'group':
          v.assetGroupId = toggle(v.assetGroupId);
          break;
        case 'status':
          v.statusFilter = val && val !== v.statusFilter ? val : 'all';
          return;
        case 'tracking':
          v.trackingFilter = toggle(v.trackingFilter);
          return;
        case 'source':
          v.sourceFilter = toggle(v.sourceFilter);
          return;
        case 'location':
          v.mapLocation = toggle(v.mapLocation);
          return;
        case 'view':
          v.view = val === 'map' ? 'map' : 'grid';
          return;
        case 'panel':
          v.filtersOpen = !v.filtersOpen;
          return;
        case 'clear': {
          // Read the list again only when a filter the server applies was on; the chips narrow what is loaded.
          const serverSide = !!(String(v.searchText || '').trim() || v.classId || v.subclassId || v.assetGroupId);
          v.searchText = '';
          v.classId = '';
          v.subclassId = '';
          v.assetGroupId = '';
          v.statusFilter = 'all';
          v.trackingFilter = '';
          v.sourceFilter = '';
          v.mapLocation = '';
          if (!serverSide) return;
          break;
        }
        default:
          return;
      }
      await Actions.callChain(context, { chain: 'loadEquipmentChain' });
    }
  }

  return setFilterChain;
});
