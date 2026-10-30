define([
  'vb/action/actionChain',
  'resources/js/availability',
], (ActionChain, av) => {
  'use strict';

  // What the page shows, from the model and the choices: the window's capacity, the chips, the rows and bars, the
  // header, the clashes. Worked out in one go and set as one variable, so a template never meets half of it.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.view = av.view(v.model, {
        from: v.from, to: v.to, text: v.text, cls: v.cls, yard: v.yard, chip: v.chip, groupBy: v.groupBy, zoom: v.zoom,
        viewStart: v.viewStart, collapsed: v.collapsed, more: v.more,
      });
      v.summary = v.model ? av.summary(v.model) : '';
      context.$page.functions.syncInputs(v.text, v.from, v.to);
    }
  }

  return applyChain;
});
