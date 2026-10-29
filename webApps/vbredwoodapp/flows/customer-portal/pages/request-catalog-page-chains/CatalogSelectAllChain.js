define([
  'vb/action/actionChain',
  'resources/js/catalogCart',
], function(ActionChain, cart) {
  'use strict';

  // Select All / Deselect All toggle over every row the current filters match.
  // Stages qty 1 for each selected id (no cart change). Deselecting items that
  // are in the cart is gated behind the confirmation dialog.
  //
  // Ids come from the DATA PROVIDER, not the DOM. The previous version read
  // document.querySelectorAll over the rendered cards, which made "Select All"
  // silently mean "select all the rows I have scrolled past" -- with
  // scroll-policy="loadMoreOnScroll" and fetch-size 24, a user who had not
  // scrolled selected 24 of 306 rows and got no indication the rest were
  // missed. Fetching from the provider makes the label honest and keeps the
  // result independent of scroll position.
  class CatalogSelectAllChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var $flow = context.$flow;

      var loadedIds = await fetchAllIds($page);
      if (loadedIds.length === 0) return;

      var currentSelected = $page.variables.selectedEquipmentKeys || [];
      var allSelected = loadedIds.every(function(id) { return currentSelected.includes(id); });
      var selecting = !allSelected;                          // toggle direction
      var affected = new Set(loadedIds);

      // Deselect path: if any affected items are in the cart, confirm first.
      if (!selecting) {
        var cartItems = $flow.variables.CartItemsArray || [];
        var inCart = cartItems.filter(function(ci) { return affected.has(Number(ci.id)); });
        if (inCart.length > 0) {
          $page.variables.pendingUncheckEquipmentIds = inCart.map(function(ci) { return Number(ci.id); });
          $page.variables.pendingUncheckDialogMessage = (inCart.length === 1)
            ? ((inCart[0].name || 'This item') + ' is in your cart (qty ' + (inCart[0].quantity || 1) +
               '). Do you also want to remove it from the cart?')
            : (inCart.length + ' of the items you want to deselect are in your cart. ' +
               'Do you also want to remove them from the cart?');
          var dialog = document.getElementById('removeFromCartDialog');
          if (dialog && typeof dialog.open === 'function') dialog.open();
          return; // wait for the user's choice
        }
      }

      // Commit selection + staged qty.
      var pendingQty = Object.assign({}, $page.variables.pendingQtyById || {});
      if (selecting) {
        loadedIds.forEach(function(id) {
          if (!(cart.stagedQtyFor(pendingQty, id) > 0)) pendingQty[id] = 1;
        });
        $page.variables.selectedEquipmentKeys = mergeUnique(currentSelected, loadedIds);
        $page.variables.selectedById = $page.functions.buildSelectedById($page.variables.selectedEquipmentKeys);
      } else {
        loadedIds.forEach(function(id) { delete pendingQty[id]; });
        $page.variables.selectedEquipmentKeys = (currentSelected || [])
          .filter(function(id) { return !affected.has(Number(id)); });
        $page.variables.selectedById = $page.functions.buildSelectedById($page.variables.selectedEquipmentKeys);
      }
      $page.variables.pendingQtyById = pendingQty;
    }
  }

  // Every id the current filter set matches, straight from the list-view's data
  // provider. iterateAll walks the provider's own pages, so it honours the
  // active filters and sort without re-implementing them, and does not depend
  // on how far the user scrolled.
  async function fetchAllIds($page) {
    var dpv = $page.variables.equipmentDPV && $page.variables.equipmentDPV.instance;
    if (!dpv || typeof dpv.fetchFirst !== 'function') {
      // Provider not bound yet -- fall back to the rendered cards rather than
      // silently selecting nothing.
      return cart.loadedEquipmentIds();
    }
    var ids = [];
    var it = dpv.fetchFirst({ size: 500 })[Symbol.asyncIterator]();
    for (;;) {
      var res = await it.next();
      var value = res && res.value;
      if (value && value.data) {
        value.data.forEach(function(row) {
          var v = Number(row && row.eqrEquipmentMasterId);
          if (!isNaN(v)) ids.push(v);
        });
      }
      if (!value || res.done) break;
    }
    return ids;
  }

  function mergeUnique(a, b) {
    var set = {};
    (a || []).forEach(function(x) { set[Number(x)] = true; });
    (b || []).forEach(function(x) { set[Number(x)] = true; });
    return Object.keys(set).map(Number);
  }

  return CatalogSelectAllChain;
});
