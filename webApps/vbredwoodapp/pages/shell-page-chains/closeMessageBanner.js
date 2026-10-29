/* Copyright (c) 2025, Oracle and/or its affiliates */

define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (
  ActionChain,
  Actions,
) => {
  'use strict';

  class closeMessageBanner extends ActionChain {

    /**
     * @param {Object} context
     */
    async run(context, { event }) {
      const { $page } = context;

      const msgId  = event.detail.messageId;
      const adp    = $page.variables.messagesBannerADP;

      // Fetch the item so we can supply both keys and data (required by ADP remove)
      let itemData;
      try {
        const result = await adp.fetchByKeys({ keys: new Set([msgId]) });
        const entry  = result.results.get(msgId);
        itemData = entry ? entry.data : null;
      } catch (e) {
        itemData = null;
      }

      if (!itemData) return;

      await Actions.fireDataProviderEvent(context, {
        target: adp,
        remove: {
          keys: [msgId],
          data: [itemData],
        },
      });
    }
  }

  return closeMessageBanner;
});
