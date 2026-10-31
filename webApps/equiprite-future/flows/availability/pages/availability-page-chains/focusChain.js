define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/availability',
  'resources/js/shellBus',
], (ActionChain, Actions, av, bus) => {
  'use strict';

  // Opens Availability on what another screen handed over (Check availability:
  // bus.focus('availability', { text, from, to, view })), once the fleet has loaded: the search, your window and the
  // card's view (timeline | grid). A search handed over clears the class, yard and chip, so nothing left from before
  // hides what it finds. Anything not handed over stays as it is.
  class focusChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      for (let i = 0; i < 600 && v.isLoading; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const what = bus.takeFocus('availability');
      if (!what) return;
      const today = (v.model && v.model.today) || av.todayKey();
      const fromIn = av.d10(what.from);
      const toIn = av.d10(what.to);
      if (fromIn || toIn) {
        const from = fromIn || v.from || today;
        // A start alone keeps a window of two weeks.
        const to = toIn || (fromIn ? av.addDays(fromIn, 13) : v.to);
        const win = av.windowOf(from, to, today);
        v.from = win.from;
        v.to = win.to;
        const fit = av.fitView(win, v.zoom);
        v.zoom = fit.zoom;
        v.viewStart = fit.viewStart;
      }
      if (what.text !== undefined && what.text !== null) {
        v.text = String(what.text).trim();
        v.cls = '';
        v.yard = '';
        v.chip = 'all';
        v.collapsed = {};
        v.more = {};
        v.gridCollapsed = {};
        v.gridMore = {};
      }
      v.exportOpen = false;
      v.yardOpen = false;
      const layout = what.view === 'grid' || what.view === 'timeline' ? what.view : v.layout;
      await Actions.callChain(context, { chain: 'applyChain', params: { layout } });
    }
  }

  return focusChain;
});
