define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Tells the user that changing the expenditure type changed the UNIT, and
   * that their hours were cleared because of it.
   *
   * The clearing itself happens in the page module (handleEditEnd), which has no
   * way to raise a VB notification. It parks a notice instead; the grid's inline
   * oj-before-edit-end handler drains it and calls this chain.
   *
   * Inert until something populates `uom` on the expenditure-type options — the
   * module only parks a notice when BOTH the old and new types carry a unit and
   * the two differ.
   */
  class uomNoticeChain extends ActionChain {
    async run(context, { from, to }) {
      if (!from || !to) { return; }

      await Actions.fireNotificationEvent(context, {
        summary:     'Unit changed to ' + to,
        message:     'Hours on this equipment were cleared because they were entered in ' +
                     from + '. Re-enter them in ' + to + '.',
        type:        'warning',
        displayMode: 'persist'
      });
    }
  }

  return uomNoticeChain;
});
