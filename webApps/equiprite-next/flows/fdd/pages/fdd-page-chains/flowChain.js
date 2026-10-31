define([
  'vb/action/actionChain',
  'resources/js/fddModel',
  'resources/js/shellBus',
], (ActionChain, model, bus) => {
  'use strict';

  // The Flows tab:
  //   flow     shows another flow (its step panel closes)
  //   select   opens a step below the diagram (a click or Enter on it); again closes it
  //   prev / next   the step before or after
  //   open     the Next screen that takes the step, in its tab (only a screen this user may open)
  //   draw     (re)draws the diagram, the open step highlighted (static SVG from fddModel.svg)
  class flowChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      if (!act) return;
      if (act === 'open') {
        if (key && v.names && v.names.open && v.names.open[key]) bus.open({ navId: key });
        return;
      }
      if (act === 'flow') {
        if (!key || key === v.flowId) return;
        const info = model.flowInfo(key);
        v.flowId = key;
        v.flowInfo = info;
        v.sel = { key: '' };
      } else if (act === 'select' || act === 'prev' || act === 'next') {
        let target = key || '';
        if (act === 'select') {
          if (!target) return;
          if (v.sel && v.sel.key === target) target = '';
        } else {
          target = (v.sel && v.sel[act]) || '';
          if (!target) return;
        }
        const d = target ? model.stepDetail(v.flowId, target, v.names) : null;
        v.sel = d || { key: '' };
      }
      // The diagram is static markup, drawn into its box once the page shows it.
      const markup = model.svg(v.flowId, { selected: (v.sel && v.sel.key) || '' });
      for (let i = 0; i < 60; i++) {
        const el = typeof document !== 'undefined' ? document.getElementById('fddDiagram') : null;
        if (el) { el.innerHTML = markup; break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (act === 'select' && v.sel && v.sel.key && typeof document !== 'undefined') {
        const card = document.getElementById('fddStep');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  return flowChain;
});
