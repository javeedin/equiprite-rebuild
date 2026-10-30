define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A search, a chip, the view, the map's location, "show more", the filters panel, the export menu, or dismissing
  // the Sync's result.
  //   text                    matched on the rows at once; after a short pause the server is asked too (searchChain)
  //   class, subclass, status, tracking, source, location
  //                           narrow the rows (applyChain); the chip that is on turns off; '' is "All"
  //   group                   the asset group: the server answers that one, so the list is read again
  //   view                    list | map | import (FULL only; the Import view loads its lists the first time)
  //   clear                   every filter and the search off; the list is read again only when a group was on
  const PAGE = 100;
  const PAUSE_MS = 300;
  const VIEWS = ['list', 'map', 'import'];
  let typing = 0;

  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      const val = value == null ? '' : String(value);
      const toggle = (cur) => (String(cur || '') === val ? '' : val);
      const apply = (p) => Actions.callChain(context, { chain: 'applyChain', params: p || {} });

      switch (field) {
        case 'exportOpen':
          v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value;
          return;
        case 'limit':
          v.limit += PAGE;
          return;
        case 'filtersOpen':
          v.filtersOpen = !v.filtersOpen;
          return;
        case 'syncResult':
          v.syncResult = null;
          return;
        case 'allClasses':
          v.allClasses = !v.allClasses;
          await apply();
          return;
        case 'text': {
          v.text = val;
          v.limit = PAGE;
          await apply();
          const mine = ++typing;
          await new Promise((r) => setTimeout(r, PAUSE_MS));
          if (mine !== typing) return;
          await Actions.callChain(context, { chain: 'searchChain' });
          return;
        }
        case 'class':
          v.classId = toggle(v.classId);
          v.subclassId = '';
          break;
        case 'subclass':
          v.subclassId = toggle(v.subclassId);
          break;
        case 'status':
          v.status = toggle(v.status);
          break;
        case 'tracking':
          v.tracking = toggle(v.tracking);
          break;
        case 'source':
          v.source = toggle(v.source);
          break;
        case 'location':
          v.location = toggle(v.location);
          break;
        case 'group':
          v.assetGroupId = toggle(v.assetGroupId);
          v.limit = PAGE;
          await this.reread(context);
          return;
        case 'view': {
          const view = VIEWS.indexOf(val) !== -1 ? val : 'list';
          if (view === 'import' && !v.canWrite) return;
          v.exportOpen = false;
          await apply({ view: view });
          if (view === 'import' && !v.importReady) {
            v.importReady = true;
            await Actions.callChain(context, { chain: 'importInitChain' });
          }
          return;
        }
        case 'clear': {
          const group = !!v.assetGroupId;
          v.text = '';
          v.classId = '';
          v.subclassId = '';
          v.status = '';
          v.tracking = '';
          v.source = '';
          v.location = '';
          v.assetGroupId = '';
          v.limit = PAGE;
          typing++;
          if (group) {
            await this.reread(context);
            return;
          }
          break;
        }
        default:
          return;
      }
      v.limit = PAGE;
      await apply();
    }

    /** The asset group changed: the server's answers for the old one no longer hold. */
    async reread(context) {
      const v = context.$page.variables;
      v.server = { q: '', ids: {}, rows: [], failed: false };
      await Actions.callChain(context, { chain: 'loadListChain' });
      await Actions.callChain(context, { chain: 'searchChain' });
    }
  }

  return setChain;
});
