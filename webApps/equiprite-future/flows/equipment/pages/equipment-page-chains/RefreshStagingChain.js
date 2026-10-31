define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Refresh icon in the Import From Fusion dialog: re-read the review grid and
   * the "What to map next" panel. Picks up a Class Mapping change re-classified
   * on the server (async reclassify) without closing the dialog.
   *
   * preserve: ticks and class edits on rows still on screen are kept, so a
   * refresh never throws away work and needs no prompt.
   */
  class RefreshStagingChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      if ($page.variables.stagingLoading || $page.functions.isBusy($page.variables)) return;
      await Promise.all([
        Actions.callChain(context, { chain: 'LoadStagingChain', params: { preserve: true } }),
        Actions.callChain(context, { chain: 'LoadUnmatchedValuesChain' })
      ]);
    }
  }

  return RefreshStagingChain;
});
