define([
  'vb/action/actionChain',
  'resources/js/trackList',
  'resources/js/mobileRecent',
], (ActionChain, trackList, recent) => {
  'use strict';

  // The period (the last few days, or every date), the chip and the search: which cards show, and the chips' counts
  // (they follow the period). A search looks through every date. Under the list, how many older requests the period
  // leaves out under the chip (mobileRecent).
  class applyChain extends ActionChain {
    async run(context, { chip, text, period }) {
      const pv = context.$page.variables;
      if (chip != null && chip !== '') pv.chip = chip;
      if (text != null) pv.text = String(text);
      if (period === 'recent' || period === 'all') pv.period = period;
      const all = (pv.all || []).map((c) => Object.assign({}, c));
      const on = pv.chip || 'all';
      const view = recent.view(all, pv.period, pv.text, Date.now());
      const shown = trackList.filter(view.list, on, pv.text);
      const older = view.filtered ? trackList.filter(all, on, '').length - shown.length : 0;
      pv.chips = trackList.chips(view.list);
      pv.shown = shown;
      pv.dated = recent.dated(view, older, 'request');
    }
  }

  return applyChain;
});
