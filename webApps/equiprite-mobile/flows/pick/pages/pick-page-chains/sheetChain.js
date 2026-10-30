define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobilePick',
], (ActionChain, Actions, mp) => {
  'use strict';

  // Opens or closes a bottom sheet ('' closes):
  //   ship     what Pick and ship will move, before anything is sent (mobilePick.shipSheet, picked as the chain picks)
  //   release  the ticked fixed assets Release will move (mobilePick.releaseSheet)
  //   yard     the yard this person works from
  //   slip     the pick slip once made: share or download it
  // Ship and Release open only with full access and when Next's gate lets the step run (canShip; a ticked fixed asset
  // waiting for release). Closing the scanner stops the camera. Opening a sheet sends nothing.
  class sheetChain extends ActionChain {
    async run(context, { sheet }) {
      const v = context.$page.variables;
      if (v.sheet === 'scan' && sheet !== 'scan') await Actions.callChain(context, { chain: 'scanCloseChain' });
      if (!sheet) {
        if (v.busy === 'ship' || v.busy === 'release') return;
        v.sheet = '';
        return;
      }
      if (v.busy) return;
      if (sheet === 'ship') {
        if (!v.can.act || !v.check.canShip) return;
        v.sheetData = mp.shipSheet(v.work, v.ticks, v.selectedTOId);
      } else if (sheet === 'release') {
        if (!v.can.act || !v.check.release) return;
        v.sheetData = mp.releaseSheet(v.work, v.ticks);
      } else if (sheet === 'slip') {
        if (!v.slip || !v.slip.url) return;
      } else if (sheet !== 'yard') {
        return;
      }
      v.sheet = sheet;
    }
  }

  return sheetChain;
});
