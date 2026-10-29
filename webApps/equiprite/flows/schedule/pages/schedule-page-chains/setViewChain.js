define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * How the schedule is viewed (nothing here reads or writes data): the Day / Week / Month scale, the month at the
   * left of the timeline (previous, next, today), Map or List beside it, the map style, showing every unit in the
   * list, and folding the conflict panel.
   */
  class setViewChain extends ActionChain {
    async run(context, { scale, month, panel, mapStyle, more, conflictsOpen }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (scale && ['day', 'week', 'month'].indexOf(scale) !== -1 && scale !== v.scale) {
        v.scale = scale;
        fns.setScale(scale, v.viewMonth);
      }
      if (month) {
        const now = fns.monthKey(new Date());
        const target = month === 'today' ? now : fns.addMonths(v.viewMonth || now, month === 'prev' ? -1 : 1);
        v.viewMonth = target;
        fns.scrollToMonth(target);
      }
      if (panel === 'map' || panel === 'list') {
        v.panel = panel;
        if (panel === 'map') {
          fns.resizeMap();
        }
      }
      if (mapStyle) {
        v.mapStyle = mapStyle;
        fns.setMapStyle(mapStyle);
      }
      if (conflictsOpen === 'toggle') {
        v.conflictsOpen = !v.conflictsOpen;
      }
      if (more) {
        v.listLimit = (v.visibleIds || []).length || v.listLimit;
        await Actions.callChain(context, { chain: 'applyFilterChain' });
      }
    }
  }

  return setViewChain;
});
