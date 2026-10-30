define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Stages a change in the unit sheet (Next's stageChain, New EquipRite's): use a unit, release one, undo, a lot's
  // quantity, or fill the line from free units. Nothing is written until Save; the sheet says what Save will do.
  class stageChain extends ActionChain {
    async run(context, { action, id, qty }) {
      const { $page } = context;
      const pv = $page.variables;
      if (pv.busy) return;
      const p = $page.functions.picker();
      let outcome = '';
      pv.pickNote = '';
      if (action === 'assign') {
        outcome = p.isQtyMode() ? p.stageLot(id) : p.stageAssign(id);
      } else if (action === 'release') {
        outcome = p.stageRelease(id);
      } else if (action === 'cancel') {
        p.cancelStage(id);
      } else if (action === 'qty') {
        p.setLotQty(id, qty);
      } else if (action === 'fill') {
        if (!p.fillFree()) pv.pickNote = 'Nothing to add: no free unit is left for these dates, or the line already has its quantity.';
      }
      if (outcome === 'FULL') pv.pickNote = 'The line already has its quantity: release a unit first to use another.';
      if (outcome === 'GONE') pv.pickNote = 'That unit is no longer free for these dates.';
      pv.pickTick = (pv.pickTick || 0) + 1;
    }
  }

  return stageChain;
});
