define([
  'vb/action/actionChain',
  'resources/js/helpGuide',
  'resources/js/nav',
  'resources/js/shellBus',
], (ActionChain, guide, nav, bus) => {
  'use strict';

  // The diagram and its steps:
  //   draw     (re)draws the diagram, the open step highlighted (static SVG from helpGuide.svg)
  //   select   opens a step below the diagram (a click or Enter on it); again closes it
  //   prev / next   the step before or after
  //   open     the screen that takes the step, in its tab
  //   see      Requests, filtered to where these pieces are
  class stepChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const app = context.$application.variables;
      if (!act) return;
      if (act === 'open') {
        if (v.sel && v.sel.open) bus.open({ navId: v.sel.open.navId });
        return;
      }
      if (act === 'see') {
        if (v.sel && v.sel.chip) bus.focus('requests', { stage: v.sel.chip });
        return;
      }
      let target = key || '';
      if (act === 'prev' || act === 'next') {
        const i = guide.STEPS.findIndex((s) => s.key === (v.sel && v.sel.key));
        const j = Math.max(0, Math.min(guide.STEPS.length - 1, (i < 0 ? 0 : i) + (act === 'next' ? 1 : -1)));
        target = guide.STEPS[j].key;
      } else if (act === 'select') {
        if (!target) return;
        if (v.sel && v.sel.key === target) target = '';
      }
      if (act !== 'draw' || target !== ((v.sel && v.sel.key) || '')) {
        const d = target ? guide.detail(target, v.counts) : null;
        if (d) {
          const it = nav.item(d.navId);
          d.open = it && nav.itemVisible(it, app.pageAccessMap, app.pageAccessLoaded, app.featureFlags, app.flagsLoaded, app.buRateSources)
            ? { navId: it.id, label: it.label } : null;
          d.mine = !!(v.mine || {})[d.key];
          d.first = d.n === 1;
          d.last = d.n === guide.STEPS.length;
        }
        v.sel = d || { key: '' };
      }
      // The diagram is static markup: drawn into its box once the page shows it.
      const markup = guide.svg({ counts: v.counts, mine: v.mine, selected: (v.sel && v.sel.key) || '' });
      for (let i = 0; i < 60; i++) {
        const el = typeof document !== 'undefined' ? document.getElementById('helpDiagram') : null;
        if (el) { el.innerHTML = markup; break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (act === 'select' && v.sel && v.sel.key && typeof document !== 'undefined') {
        const card = document.getElementById('helpStep');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  return stepChain;
});
