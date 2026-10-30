define([
  'vb/action/actionChain',
  'resources/js/trackList',
], (ActionChain, trackList) => {
  'use strict';

  // The chip and the search: which cards show, and the chips' counts.
  class applyChain extends ActionChain {
    async run(context, { chip, text }) {
      const pv = context.$page.variables;
      if (chip != null && chip !== '') pv.chip = chip;
      if (text != null) pv.text = String(text);
      const all = (pv.all || []).map((c) => Object.assign({}, c));
      pv.chips = trackList.chips(all);
      pv.shown = trackList.filter(all, pv.chip || 'all', pv.text);
    }
  }

  return applyChain;
});
