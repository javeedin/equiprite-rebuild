define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/catalogCart',
], function(ActionChain, Actions, draftStorage, cart) {
  'use strict';

  // "Add Checked to Cart" — move every selected (staged) item into the cart.
  // Qty comes from pendingQtyById (default 1); display data from pendingRowById.
  // For any selected id whose row wasn't captured (e.g. select-all over a card
  // the user never touched), fetch it by id from the catalog endpoint.
  class CatalogAddCheckedToCartChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var $flow = context.$flow;

      var selectedKeys = ($page.variables.selectedEquipmentKeys || []).map(Number);
      if (selectedKeys.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing selected',
          message: 'Check at least one card before adding to cart.',
          type: 'warning', displayMode: 'transient'
        });
        return;
      }

      var pendingQty = $page.variables.pendingQtyById || {};
      var pendingRow = $page.variables.pendingRowById || {};

      // Resolve a display row for each selected id (captured, else fetch by id).
      var missingIds = selectedKeys.filter(function(id) {
        return !pendingRow[id] && !pendingRow[String(id)];
      });
      var fetchedById = await fetchRowsByIds(context, missingIds, $flow);

      var cartItems = ($flow.variables.CartItemsArray || []).slice();
      var addedCount = 0, updatedCount = 0, unchangedCount = 0, skipped = 0;

      // Agreement rate wins for any agreement-covered item (see CardActionChain).
      var agreementRateMap = ($flow.variables.fromAgreementId && draftStorage.hasStoredDraft('agreementRateByEquipmentId'))
        ? (draftStorage.load('agreementRateByEquipmentId') || {}) : null;

      selectedKeys.forEach(function(id) {
        var qty = cart.stagedQtyFor(pendingQty, id);
        if (!qty || qty <= 0) qty = 1;
        var row = pendingRow[id] || pendingRow[String(id)] || fetchedById[id];
        if (!row) { skipped++; return; }   // couldn't resolve display data

        var cartItem = cart.itemFromRow(row, qty, agreementRateMap);
        var i = cartItems.findIndex(function(ci) { return Number(ci.id) === Number(id); });
        if (i === -1) { cartItems.push(cartItem); addedCount++; }
        else if (cartItems[i].quantity !== qty) { cartItems[i] = cartItem; updatedCount++; }
        else { unchangedCount++; }
      });

      if (addedCount > 0 || updatedCount > 0) {
        $flow.variables.CartItemsArray = cartItems;
        draftStorage.save('CartItemsArray', cartItems);
      }

      var parts = [];
      if (addedCount   > 0) parts.push(addedCount   + ' added');
      if (updatedCount > 0) parts.push(updatedCount + ' updated');
      if (unchangedCount > 0) parts.push(unchangedCount + ' already in cart');
      if (skipped > 0) parts.push(skipped + ' could not be added');

      await Actions.fireNotificationEvent(context, {
        summary: (addedCount + updatedCount > 0) ? 'Cart Updated' : 'No Changes',
        message: 'Cart: ' + (parts.length ? parts.join(', ') : 'no changes') + '.',
        type: skipped > 0 ? 'warning' : 'info', displayMode: 'transient'
      });
    }
  }

  // Fetch catalog rows for specific master ids. The catalog endpoint has no
  // id filter, so we pull pages (with the request window) and index by id.
  // Only runs when select-all staged ids whose rows weren't captured.
  // When shopping an agreement, scope this fetch to the agreement too so the
  // rows come back already repriced and in-scope (consistent with the grid).
  async function fetchRowsByIds(context, ids, $flow) {
    var out = {};
    if (!ids || ids.length === 0) return out;
    var req = $flow.variables.request || {};
    if (!req.startDate || !req.endDate) return out;
    try {
      var uriParams = {
        startDate: String(req.startDate).substring(0, 10),
        endDate:   String(req.endDate).substring(0, 10),
        requestedQty: 1, page: 0, size: 10000,
        agreementId: $flow.variables.fromAgreementId || null
      };
      // Rate scoping must match the grid's (CatalogInitChain injects the same two
      // into equipmentSDP.uriParameters): the endpoint resolves `rate` against the
      // project/customer rate schedule, so omitting these prices backfilled rows
      // off the blanket schedule while visible rows use the scoped one — different
      // rates for the same equipment inside ONE cart. Injected only when present
      // (an undefined uriParam serializes as the literal string "undefined").
      if (req.projectId != null) uriParams.projectRefId = Number(req.projectId);
      var _detail = $flow.variables.ActiveRequestDetail || {};
      if (_detail.customerRefId != null) uriParams.customerRefId = Number(_detail.customerRefId);

      var resp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsEquipmentCatalog',
        uriParams: uriParams
      });
      var rows = (resp && resp.ok && resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
      var want = {};
      ids.forEach(function(id) { want[Number(id)] = true; });
      rows.forEach(function(r) {
        var id = Number(r.eqrEquipmentMasterId);
        if (want[id]) out[id] = r;
      });
    } catch (e) { /* leave unresolved → reported as skipped */ }
    return out;
  }

  return CatalogAddCheckedToCartChain;
});
