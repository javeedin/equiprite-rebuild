define([
  'vb/action/actionChain',
  'resources/js/availability',
  'resources/js/availabilityPivot',
], (ActionChain, av, pivot) => {
  'use strict';

  // What the page shows, from the model and the choices: the window's capacity, the chips, the rows and bars, the
  // header, the clashes. Worked out in one go and set as one variable, so a template never meets half of it. With the
  // yard grid on (or asked for: params.layout), the grid too, from the same units the filters let through; the grid
  // is worked out before the card switches to it, so its template never meets an old grid.
  class applyChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      const p = params || {};
      const layout = p.layout === 'grid' || p.layout === 'timeline' ? p.layout : (v.layout === 'grid' ? 'grid' : 'timeline');
      const grain = p.grain === 'units' || p.grain === 'equipment' ? p.grain : (v.grain === 'units' ? 'units' : 'equipment');
      const view = av.view(v.model, {
        from: v.from, to: v.to, text: v.text, cls: v.cls, yard: v.yard, chip: v.chip, groupBy: v.groupBy, zoom: v.zoom,
        viewStart: v.viewStart, collapsed: v.collapsed, more: v.more,
      });
      const grid = layout === 'grid' ? pivot.grid(v.model, pivot.optionsFrom(v, view.ordered, grain)) : null;
      v.view = view;
      if (grid) v.grid = grid;
      if (v.grain !== grain) v.grain = grain;
      if (v.layout !== layout) v.layout = layout;
      v.summary = v.model ? av.summary(v.model) : '';
      context.$page.functions.syncInputs(v.text, v.from, v.to);
    }
  }

  return applyChain;
});
