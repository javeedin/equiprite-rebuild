define([], function() {
  'use strict';

  // Cart helpers, shared by the catalog's add-to-cart pathways.
  //
  // IMPORTANT — staging vs cart are SEPARATE:
  //   • STAGING: selectedEquipmentKeys (checkbox highlight) + pendingQtyById
  //     ({id: qty}) + pendingRowById ({id: rawRow}). Set by checking a card /
  //     changing its stepper. NOT yet in the cart.
  //   • CART: CartItemsArray — the real cart, changed ONLY by an explicit Add
  //     to Cart / Add Checked / Select-All+Add action, which consumes staging.
  //
  // Under SDP+DPV the equipment rows live in the data provider (not a page
  // array), so staged qty/row data is kept in the pending* maps captured at
  // click time rather than mutated onto a catalog array.
  //
  // A cart item carries the display fields the cart/summary need:
  //   { id, equipmentId, name, class, classId, quantity, billingRate, billingUnit,
  //     isConsumable, source }
  // billingUnit is 'DAY' for rentables (billingRate = per-day) and 'EACH' for
  // consumables (billingRate = per-unit, never multiplied by days).

  // Build a cart item from a raw catalog SDP row (captured at click time).
  //
  // agreementRateMap (optional) — { masterId: { billingRate, billingUnit } }.
  // When the item is covered by the active agreement, the AGREEMENT rate wins
  // regardless of which view it was added from (agreement-scoped OR full
  // catalog). Rows already built from the agreement dataset also carry their
  // agreement rate on billRate/rateUom, so this is belt-and-suspenders for the
  // full-catalog add path.
  function itemFromRow(row, qty, agreementRateMap) {
    var id = Number(row.eqrEquipmentMasterId != null ? row.eqrEquipmentMasterId : row.equipmentId);
    // Price + unit, branching on RENTABLE vs CONSUMABLE. Only an explicit
    // isRentable === false marks a consumable, so rows with the flag missing keep
    // the rentable path (same convention as the catalog page's formatCatalogRate).
    //
    //   • RENTABLE   → row.rate, the PER-DAY amount the endpoint already resolved
    //     for the requested startDate/endDate window. Rates are always per day; a
    //     longer rental just resolves to a cheaper daily number once it crosses a
    //     rate-schedule threshold. So the unit is ALWAYS 'DAY' — never infer
    //     WEEK/MONTH from which threshold was crossed (the old tier-field code
    //     did, persisting a 7-day crane's 500/day onto the line as 500/WEEK).
    //   • CONSUMABLE → row.unitPrice, a per-unit amount with unit 'EACH'. It is
    //     NOT per-day: the cart must not multiply it by rental days.
    //
    // isConsumable rides along on the cart item so the cart's subtotal math and
    // the submitted line can tell the two apart without re-fetching the catalog.
    // Legacy billRate/billingRate remain as fallbacks for rows built elsewhere.
    var isConsumable = row.isRentable === false;
    var billingRate, billingUnit;
    if (isConsumable) {
      billingRate = row.unitPrice != null ? row.unitPrice : 0;
      billingUnit = 'EACH';
    } else if (row.rate != null) {
      billingRate = row.rate;
      billingUnit = 'DAY';
    } else {
      billingRate = row.billRate != null ? row.billRate : (row.billingRate != null ? row.billingRate : 0);
      billingUnit = row.rateUom || row.billingUnit || 'DAY';
    }
    var agr = agreementRateMap && (agreementRateMap[id] || agreementRateMap[String(id)]);
    if (agr) {
      if (agr.billingRate != null) billingRate = agr.billingRate;
      if (agr.billingUnit)         billingUnit = agr.billingUnit;
    }
    return {
      id:          id,
      equipmentId: id,
      name:        row.equipmentName || row.name || '',
      class:       row.className || row.category || row.class || '',
      classId:     row.eqrEquipmentClassId != null ? Number(row.eqrEquipmentClassId) : (row.classId != null ? Number(row.classId) : null),
      quantity:    qty,
      billingRate: billingRate,
      billingUnit: billingUnit,
      // Period pricing, carried through so the cart can show "$1,890 / WEEK ·
      // $270 / day" the same way the catalog card does. Stamped at add-time
      // because the cart never re-fetches the catalog — without this the cart
      // could only ever show the derived daily rate.
      //
      // NOT applied when an agreement overrides the rate below: a negotiated
      // rate has its own (unknown) period basis, so the list-price period
      // amount would contradict the rate actually shown.
      //
      // NOR FOR CONSUMABLES — they are priced per unit and have no rental
      // period. The catalog view nonetheless returns periodAmount/periodType on
      // consumable rows (verified live: "Structural Anchor Bolts M20 (Box)"
      // comes back isRentable=false, unitPrice=25, periodAmount=25,
      // periodType='DAILY'), so copying those through made the cart's rate
      // formatter take its period branch and render "$25.00 / DAY" for an item
      // that is billed EACH. Leaving them null is what makes formatRateCell
      // fall back to billingRate + billingUnit, i.e. "$25.00 / EACH".
      periodAmount:  (!agr && !isConsumable && row.periodAmount  != null) ? Number(row.periodAmount)  : null,
      periodDivisor: (!agr && !isConsumable && row.periodDivisor != null) ? Number(row.periodDivisor) : null,
      // The period's own unit, from periodType ('DAILY'|'WEEKLY'|'MONTHLY').
      //
      // NOT rateUom: that is the unit the RATE is quoted in and is always 'DAY'
      // for a rentable, so using it here labelled a weekly price "$3,200 / DAY".
      // Distinct from billingUnit for the same reason — see the comment above.
      periodUom:     (!agr && !isConsumable && row.periodType) ? String(row.periodType) : null,
      // Consumables are priced per unit, not per day — the cart's subtotal must
      // NOT multiply by rental days. Stamped at add-time so downstream consumers
      // don't have to re-resolve isRentable off the catalog.
      isConsumable: isConsumable,
      // Line origin: 'agreement' when this item is covered by the active
      // agreement (negotiated rate applied), else 'catalog'. Stamped at add-time
      // so it survives the agreement FILTER being removed later — the cart can
      // badge each line by where it came from.
      source:      agr ? 'agreement' : 'catalog'
    };
  }

  // Insert/update a staged item by id; returns a NEW array.
  function upsert(cartItems, item) {
    var out = (cartItems || []).slice();
    var i = out.findIndex(function(ci) { return Number(ci.id) === Number(item.id); });
    if (i === -1) out.push(item);
    else out[i] = Object.assign({}, out[i], item);
    return out;
  }

  // Commit ONE built cart item to $flow.variables.CartItemsArray, persist the
  // draft, and fire the matching toast: added / already in cart (same qty) /
  // qty updated. Shared by the detail page's header Add and its bundle
  // suggestion Add so the two can't drift. Actions and draftStorage are passed
  // in because this module deliberately has no dependencies.
  async function commitItem(context, Actions, draftStorage, cartItem) {
    var $flow = context.$flow;
    var cartItems = ($flow.variables.CartItemsArray || []).slice();
    var i = cartItems.findIndex(function(ci) { return Number(ci.id) === Number(cartItem.id); });

    if (i === -1) {
      cartItems.push(cartItem);
      $flow.variables.CartItemsArray = cartItems;
      draftStorage.save('CartItemsArray', cartItems);
      await Actions.fireNotificationEvent(context, {
        summary: 'Added to Cart',
        message: cartItem.name + ' (qty ' + cartItem.quantity + ') added.',
        type: 'info', displayMode: 'transient'
      });
    } else if (cartItems[i].quantity === cartItem.quantity) {
      await Actions.fireNotificationEvent(context, {
        summary: 'Already in Cart',
        message: cartItem.name + ' is already in your cart (qty ' + cartItem.quantity + ').',
        type: 'info', displayMode: 'transient'
      });
    } else {
      var oldQty = cartItems[i].quantity;
      cartItems[i] = cartItem;
      $flow.variables.CartItemsArray = cartItems;
      draftStorage.save('CartItemsArray', cartItems);
      await Actions.fireNotificationEvent(context, {
        summary: 'Cart Updated',
        message: cartItem.name + ' qty ' + oldQty + ' → ' + cartItem.quantity + '.',
        type: 'info', displayMode: 'transient'
      });
    }
  }

  // Commit SEVERAL built cart items in one write (the detail page's "Add
  // bundle"): new ids are added, existing ones take the new qty. One draft
  // save and ONE toast listing what changed, instead of a toast per item.
  async function commitItems(context, Actions, draftStorage, cartItemsToAdd) {
    var $flow = context.$flow;
    var cartItems = ($flow.variables.CartItemsArray || []).slice();
    var added = 0, updated = 0, unchanged = 0;
    (cartItemsToAdd || []).forEach(function(item) {
      var i = cartItems.findIndex(function(ci) { return Number(ci.id) === Number(item.id); });
      if (i === -1) { cartItems.push(item); added++; }
      else if (cartItems[i].quantity === item.quantity) { unchanged++; }
      else { cartItems[i] = item; updated++; }
    });
    if (added + updated > 0) {
      $flow.variables.CartItemsArray = cartItems;
      draftStorage.save('CartItemsArray', cartItems);
    }
    var parts = [];
    if (added)     parts.push(added + ' added');
    if (updated)   parts.push(updated + ' updated');
    if (unchanged) parts.push(unchanged + ' already in cart');
    await Actions.fireNotificationEvent(context, {
      summary: added + updated > 0 ? 'Bundle added to cart' : 'Bundle already in cart',
      message: parts.join(', ') + '.',
      type: 'info', displayMode: 'transient'
    });
  }

  // Catalog-shaped row for the item a catalog DETAIL page is showing, rebuilt
  // from its recordData, for itemFromRow. isRentable/unitPrice must ride along:
  // without them itemFromRow can't take its consumable branch and a per-unit
  // price would be carried as a daily rate. Shared by the detail page's header
  // Add and its "Add bundle" so both price this item identically.
  function rowFromDetailRecord(equipmentId, record) {
    return {
      eqrEquipmentMasterId: Number(equipmentId),
      equipmentName: record.name,
      className: record.class,
      eqrEquipmentClassId: record.classId,
      isRentable: record.isRentable,
      unitPrice: record.unitPrice,
      billRate: record.billRate,
      rateUom: record.rateUom
    };
  }

  // What "Add bundle" on a catalog detail page would add. ONE rule, used both
  // by the page (toolbar text + button enablement) and by AddBundleToCartChain.
  //   • this item, at the header qty — only when it is priced (catalogAvailable)
  //   • each suggestion with a priced catalog row, at its stepper qty (> 0);
  //     a stepper set to 0 leaves that item out
  function bundleSelection(record, mainQty, suggestions, qtyById) {
    var main = !!(record && record.catalogAvailable) && Number(mainQty) > 0;
    var items = (suggestions || []).filter(function(s) { return !!s.row; })
      .map(function(s) {
        var q = qtyById && qtyById[s.id] != null ? Number(qtyById[s.id]) : Number(s.suggestedQty || 1);
        return { suggestion: s, qty: q };
      })
      .filter(function(x) { return x.qty > 0; });
    return { includeMain: main, mainQty: Number(mainQty) || 0, items: items };
  }

  // Set quantity for an id; qty<=0 removes it. Returns a NEW array.
  function setQty(cartItems, id, qty, rowForInsert) {
    var out = (cartItems || []).slice();
    var i = out.findIndex(function(ci) { return Number(ci.id) === Number(id); });
    if (qty <= 0) {
      return out.filter(function(ci) { return Number(ci.id) !== Number(id); });
    }
    if (i === -1) {
      // not staged yet — need row data to create the entry
      if (rowForInsert) out.push(itemFromRow(rowForInsert, qty));
      return out;
    }
    out[i] = Object.assign({}, out[i], { quantity: qty });
    return out;
  }

  function removeIds(cartItems, idSet) {
    return (cartItems || []).filter(function(ci) { return !idSet.has(Number(ci.id)); });
  }

  function qtyFor(cartItems, id) {
    var hit = (cartItems || []).find(function(ci) { return Number(ci.id) === Number(id); });
    return hit ? hit.quantity : 0;
  }

  // Read the equipment ids of the cards currently rendered in the list-view
  // (used by Select All — only loaded cards are selectable). Reads the
  // data-equipment-id attributes the card checkboxes carry.
  function loadedEquipmentIds() {
    var ids = [];
    // Either the full-catalog list-view or the agreement-scoped one is rendered
    // at a time (viewMode branch) — query both so Select All works in both.
    var nodes = document.querySelectorAll('#equipmentListView .eq-card-checkbox[data-equipment-id], #agreementListView .eq-card-checkbox[data-equipment-id]');
    nodes.forEach(function(n) {
      var v = Number(n.getAttribute('data-equipment-id'));
      if (!isNaN(v)) ids.push(v);
    });
    return ids;
  }

  // ── STAGING helpers (pendingQtyById / pendingRowById) ────────────────
  // Staged quantity per equipment id, kept BEFORE an item reaches the cart.
  // Maps are plain objects so they round-trip through page variables cleanly.

  // Return a NEW pendingQtyById with id set to qty (qty<=0 removes the key).
  function stageQty(pendingQtyById, id, qty) {
    var out = Object.assign({}, pendingQtyById || {});
    if (qty > 0) out[id] = qty; else delete out[id];
    return out;
  }

  // Return a NEW pendingRowById with the row captured for id (so Add actions
  // have display data even after the card scrolls out of the SDP window).
  function stageRow(pendingRowById, id, row) {
    if (!row) return pendingRowById || {};
    var out = Object.assign({}, pendingRowById || {});
    out[id] = row;
    return out;
  }

  function stagedQtyFor(pendingQtyById, id) {
    var v = pendingQtyById && pendingQtyById[id];
    return v != null ? v : 0;
  }

  return {
    itemFromRow:        itemFromRow,
    upsert:             upsert,
    commitItem:         commitItem,
    commitItems:        commitItems,
    rowFromDetailRecord: rowFromDetailRecord,
    bundleSelection:    bundleSelection,
    setQty:             setQty,
    removeIds:          removeIds,
    qtyFor:             qtyFor,
    loadedEquipmentIds: loadedEquipmentIds,
    stageQty:           stageQty,
    stageRow:           stageRow,
    stagedQtyFor:       stagedQtyFor
  };
});
