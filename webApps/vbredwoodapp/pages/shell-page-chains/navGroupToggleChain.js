define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Expand/collapse one nav group in the role-filtered drawer.
  //
  // The eight groups used to be eight separate is*Expanded booleans toggled by
  // inline arrow expressions in the markup. Now that the drawer renders from a
  // DERIVED list (only the groups the current role may see), the groups are no
  // longer statically known, so their state lives in a single map keyed by
  // NAV_GROUPS[].key: $page.variables.navExpanded.
  //
  // Reassigns a NEW object rather than mutating in place — VB change detection
  // is by reference, so an in-place property write would not repaint the
  // chevron or open the group.
  class navGroupToggleChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.groupKey - NAV_GROUPS[].key from data-group-key
     */
    async run(context, { groupKey }) {
      const { $page } = context;

      if (!groupKey) {
        return;
      }

      const current = $page.variables.navExpanded || {};
      const next = Object.assign({}, current);
      next[groupKey] = !current[groupKey];

      $page.variables.navExpanded = next;
    }
  }

  return navGroupToggleChain;
});
