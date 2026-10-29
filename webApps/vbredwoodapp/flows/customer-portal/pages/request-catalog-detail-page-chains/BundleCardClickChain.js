define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Click on a bundle suggestion card body → show that item on THIS page.
  //
  // Swapped in place (set equipmentId, re-run the init chain) rather than a
  // navigateToPage to the page we're already on: a same-page navigation does
  // not reliably re-fire vbEnter, and nothing in the app relies on it. Back /
  // go-to-parent still returns to the catalog, same as before.
  class BundleCardClickChain extends ActionChain {
    async run(context, params) {
      const $page = context.$page;

      const equipmentId = Number(params && params.equipmentId);
      if (isNaN(equipmentId) || String(equipmentId) === String($page.variables.equipmentId)) return;

      $page.variables.equipmentId = String(equipmentId);
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { /* non-fatal */ }

      await Actions.callChain(context, { chain: 'EquipmentDetailInitChain' });
    }
  }

  return BundleCardClickChain;
});
