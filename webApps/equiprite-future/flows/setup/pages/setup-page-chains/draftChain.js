define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A value typed into a rate or a number decision: kept as a draft (nothing changes until Save), so the page can say
  // what saving it will do.
  class draftChain extends ActionChain {
    async run(context, { key, value }) {
      const pv = context.$page.variables;
      if (!key) return;
      const d = Object.assign({}, pv.drafts || {});
      d[key] = value === undefined || value === null ? '' : String(value);
      pv.drafts = d;
    }
  }

  return draftChain;
});
