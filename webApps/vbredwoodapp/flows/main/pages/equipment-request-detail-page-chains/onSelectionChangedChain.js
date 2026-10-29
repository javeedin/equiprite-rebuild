define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  // Recomputes $page.variables.selectionState whenever the grid's row
  // checkboxes change. Fires a "select same status" toast at the moment
  // the selection transitions from same-status to mixed-status, so the
  // user gets warned exactly once per offending click.
  class onSelectionChangedChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const raw = ($page.functions.getSelectionStateRaw && $page.functions.getSelectionStateRaw())
        || { count: 0, sharedStatus: '', isMixed: false, allDeployed: false, allReturnable: false, allShipToSite: false };

      const prev = $page.variables.selectionState || {};
      const wasMixedBefore = !!prev.isMixed;

      // Forward allDeployed / allReturnable / allShipToSite from
      // getSelectionStateRaw so the header action buttons (Reject / Accept /
      // Initiate Return) can use them as their per-button :disabled gate.
      // EVERY field getSelectionStateRaw() returns must be copied through:
      // allReturnable was previously missing, so the Initiate Return binding read
      // undefined and the button stayed permanently disabled.
      $page.variables.selectionState = {
        count:         raw.count,
        sharedStatus:  raw.sharedStatus,
        isMixed:       raw.isMixed,
        wasMixed:      wasMixedBefore || raw.isMixed,
        // Every line on the request selected — gates the Approve button, which
        // is a whole-request action (see the button's comment in the HTML).
        allSelected:   !!raw.allSelected,
        allDeployed:   !!raw.allDeployed,
        allReturnable: !!raw.allReturnable,
        allShipToSite: !!raw.allShipToSite
      };

      // Bump tick so row checkbox :checked bindings re-evaluate after
      // a header select-all/clear-all (rows the user didn't click).
      $page.variables.selectionTick = ($page.variables.selectionTick || 0) + 1;

      // Toast only on the edge where selection just became mixed.
      if (raw.isMixed && !wasMixedBefore) {
        try {
          await Actions.fireNotificationEvent(context, {
            summary:     'Select same status lines',
            message:     'Selected lines must all share the same status to perform a bulk action.',
            displayMode: 'transient',
            type:        'warning'
          });
        } catch (e) {
          console.warn('[onSelectionChangedChain] toast failed:', e);
        }
      }
    }
  }

  return onSelectionChangedChain;
});
