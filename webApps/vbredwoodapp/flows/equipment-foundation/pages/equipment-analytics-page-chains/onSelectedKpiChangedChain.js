define([
  'vb/action/actionChain',
  'vb/action/actions',
], (
  ActionChain,
  Actions
) => {
  'use strict';

  class onSelectedKpiChangedChain extends ActionChain {

    /**
     * Fires when a KPI tile is selected on the scoreboard.
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.value — the selected KPI id
     */
    async run(context, { value }) {
      console.log('[Equipment Analytics] KPI selection changed:', value);
    }
  }

  return onSelectedKpiChangedChain;
});
