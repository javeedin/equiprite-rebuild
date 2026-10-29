define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /*
   * Set every slice to an equal share, totalling exactly 100%.
   *
   * Done in integer BASIS POINTS, then converted back, so the result always
   * satisfies splitFormError's exact 10000 check. 100/3 in floating point gives
   * three 33.33s that total 99.99 and a form the user then has to fix by hand,
   * which is the opposite of what this button is for.
   *
   * The remainder goes to the FIRST slice (33.34 / 33.33 / 33.33). That is a
   * presentation choice only -- it is percentages, not money. The dollar
   * remainder is the server's problem and it uses largest-remainder on the
   * amounts, not on these percentages.
   */
  class splitEvenlyChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const slices = Array.isArray($page.variables.splitSlices)
        ? $page.variables.splitSlices
        : [];
      const n = slices.length;
      if (n < 2) return;

      const base = Math.floor(10000 / n);
      const remainder = 10000 - (base * n);

      $page.variables.splitSlices = slices.map(function (s, i) {
        const bp = base + (i === 0 ? remainder : 0);
        return Object.assign({}, s, { pct: bp / 100 });
      });
      $page.variables.splitFormError = '';
    }
  }

  return splitEvenlyChain;
});
