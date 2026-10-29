define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Bridges the page module's staging state into reactive page variables.
   *
   * The page module (line-detail-page.js) tracks pending assign/release
   * staging client-side, but it CANNOT write $page.variables itself —
   * `context.variables.X = v` from a page-module method is inert and never
   * reaches the KO bindings (the Save button + progress circle were the
   * casualties: Save stayed greyed even with a lot staged). So the module
   * fires the `onStagingChanged` custom event (via getEventHelper().
   * fireCustomEvent) whenever staging changes, and this chain — which has a
   * writable $page — applies the values.
   *
   *   saveEnabled       → header primary-action display ("on" / "disabled")
   *   allocationPercent → oj-c-progress-circle value
   *
   * Params (forwarded from the page JSON listener via $event.detail):
   *   saveEnabled       {boolean}
   *   allocationPercent {number}
   */
  class StagingChangedChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      $page.variables.saveEnabled       = !!(params && params.saveEnabled);
      $page.variables.allocationPercent = Number((params && params.allocationPercent) || 0);
    }
  }

  return StagingChangedChain;
});
