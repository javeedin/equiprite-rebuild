define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Stages a change in the open unit picker (New EquipRite's stageChain): assign, release, undo, a lot's quantity,
  // or fill the line from free units. Nothing is written until Save; the picker says what Save will do.
  class stageChain extends ActionChain {
    async run(context, { action, id, qty }) {
      const { $page } = context;
      const v = $page.variables;
      const p = $page.functions.picker();
      let outcome = '';
      v.pickNote = '';
      if (action === 'assign') {
        outcome = p.isQtyMode() ? p.stageLot(id) : p.stageAssign(id);
      } else if (action === 'release') {
        outcome = p.stageRelease(id);
      } else if (action === 'cancel') {
        p.cancelStage(id);
      } else if (action === 'qty') {
        p.setLotQty(id, qty);
      } else if (action === 'fill') {
        if (!p.fillFree()) v.pickNote = 'Nothing to add: no free unit is left for these dates, or the line already has its quantity.';
      }
      if (outcome === 'FULL') v.pickNote = 'The line already has its quantity: release a unit first to assign another.';
      if (outcome === 'GONE') v.pickNote = 'That unit is no longer free for these dates.';
      v.pickTick = (v.pickTick || 0) + 1;
    }
  }

  return stageChain;
});
