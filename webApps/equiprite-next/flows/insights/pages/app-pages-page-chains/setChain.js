define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/pageMap', 'resources/js/codeView'], (ActionChain, Actions, PM, CV) => {
  'use strict';

  // A filter, a tick or a tab.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (!field) return;
      if (field === 'onlyMapped' || field === 'onlySheet' || field === 'commit' || field === 'showDeleted') v[field] = value === true || value === 'true';
      else v[field] = value == null ? '' : String(value);
      if (field === 'view' && (v.view === 'map' || v.view === 'global')) PM.redraw(); // the map's lines, once its boxes are laid out
      if (field === 'view' && v.view === 'fix') await Actions.callChain(context, { chain: 'fixChain', params: { act: 'open', key: '' } });
      if (field === 'view' && v.view === 'code') await Actions.callChain(context, { chain: 'codeChain', params: { act: 'open', key: '' } });
      if (field === 'codeFind') CV.scrollTo('pgCodeFrame'); // to the first match
    }
  }
  return setChain;
});
