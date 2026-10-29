define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  // Recomputes $page.variables.selectionState whenever the grid's row
  // checkboxes change. Fires a "select same status" toast at the moment
  // selection transitions from same-status to mixed-status — exactly once
  // per offending click. Mirrors the project-mode onSelectionChangedChain.
  class onSelectionChangedChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const raw = ($page.functions.getSelectionStateRaw && $page.functions.getSelectionStateRaw())
        || { count: 0, sharedStatus: '', isMixed: false, allDeployed: false, allReturnable: false, allShipToSite: false };

      const prev = $page.variables.selectionState || {};
      const wasMixedBefore = !!prev.isMixed;

      $page.variables.selectionState = {
        count:         raw.count,
        sharedStatus:  raw.sharedStatus,
        isMixed:       raw.isMixed,
        wasMixed:      wasMixedBefore || raw.isMixed,
        allDeployed:   !!raw.allDeployed,
        // MUST be forwarded — the Initiate Return button binds to
        // selectionState.allReturnable. Omitting it here left the value
        // undefined, so !undefined === true and the button was permanently
        // disabled no matter what was selected. Every field
        // getSelectionStateRaw() returns has to be copied through, or the
        // binding silently reads undefined.
        allReturnable: !!raw.allReturnable,
        allShipToSite: !!raw.allShipToSite
      };

      $page.variables.selectionTick = ($page.variables.selectionTick || 0) + 1;

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
