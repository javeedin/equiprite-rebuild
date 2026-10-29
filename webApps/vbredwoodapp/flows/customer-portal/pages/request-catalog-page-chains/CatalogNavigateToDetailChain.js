define([
  'vb/action/actionChain',
  'vb/action/actions',
], function(ActionChain, Actions) {
  'use strict';

  class CatalogNavigateToDetailChain extends ActionChain {
    async run(context, { event }) {
      var cardEl = event && (event.currentTarget || (event.target && event.target.closest
        ? event.target.closest('[data-equipment-id]')
        : event.target));

      var equipmentId = cardEl ? Number(cardEl.getAttribute('data-equipment-id')) : NaN;

      if (isNaN(equipmentId)) return;

      await Actions.navigateToPage(context, {
        page: 'request-catalog-detail',
        params: { equipmentId: String(equipmentId) }
      });
    }
  }

  return CatalogNavigateToDetailChain;
});
