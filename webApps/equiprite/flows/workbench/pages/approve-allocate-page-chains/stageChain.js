define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Stages a change in the open unit picker (kept in the page module, as on the old line-detail page): assign,
  // release, cancel, a lot quantity, or fill the line from free units. Nothing is written until Save.
  class stageChain extends ActionChain {
    async run(context, { action, id, qty }) {
      const { $page } = context;
      const f = $page.functions;
      let outcome = '';
      if (action === 'assign') {
        outcome = f.isQtyMode() ? f.stageLot(id) : f.stageAssign(id);
      } else if (action === 'release') {
        outcome = f.stageRelease(id);
      } else if (action === 'cancel') {
        f.cancelStage(id);
      } else if (action === 'qty') {
        f.setLotQty(id, qty);
      } else if (action === 'fill') {
        const n = f.fillFree();
        if (!n) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Nothing to add',
            message: 'No free unit is left for these dates, or the line already has its quantity.',
            displayMode: 'transient',
            type: 'info'
          });
        }
      }
      if (outcome === 'FULL') {
        await Actions.fireNotificationEvent(context, {
          summary: 'Line quantity reached',
          message: 'Release a unit first to assign another.',
          displayMode: 'transient',
          type: 'warning'
        });
      }
      $page.variables.stagingTick = ($page.variables.stagingTick || 0) + 1;
    }
  }

  return stageChain;
});
