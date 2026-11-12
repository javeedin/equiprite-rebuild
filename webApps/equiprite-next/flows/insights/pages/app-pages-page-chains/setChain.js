define(['vb/action/actionChain', 'resources/js/pageMap'], (ActionChain, PM) => {
  'use strict';

  // A filter, a tick or a tab.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (!field) return;
      if (field === 'onlyMapped' || field === 'onlySheet' || field === 'commit' || field === 'showDeleted') v[field] = value === true || value === 'true';
      else v[field] = value == null ? '' : String(value);
      if (field === 'view' && v.view !== 'page') PM.redraw(); // the map's lines, once its boxes are laid out
    }
  }
  return setChain;
});
