define(['resources/js/catalogCart'], function(cart) {
  'use strict';

  var PageModule = function PageModule() {};

  // Same resolution rule as the catalog page's imageObj: absolute/data URIs
  // are used as-is, app-relative paths get $application.path prepended.
  PageModule.prototype.imageObj = function(imageUrl, appPath, equipmentId) {
    var raw = imageUrl || 'resources/images/equipment-placeholder.png';
    var src = (/^(https?:|data:)/.test(raw)) ? raw : ((appPath || '') + raw);
    return { src: src };
  };

  // Quantity this equipment already has in the cart (0 if not in cart).
  PageModule.prototype.cartQtyFor = function(equipmentId, cartItems) {
    var hit = (cartItems || []).find(function(ci) { return Number(ci.id) === Number(equipmentId); });
    return hit ? hit.quantity : 0;
  };

  // Price line for a bundle suggestion card, from that item's own catalog row.
  // MIRRORS request-catalog-page.js formatCatalogRate (+ priceFieldLabel) so a
  // suggestion reads exactly like its catalog card — keep the two in step.
  //   • Fusion PPM pricing  → "Rate: <ppmRateText>" (no EquipRite price)
  //   • quoted request      → "Rate on request" (prices hidden, consumables too)
  //   • no row              → no request window yet
  //   • consumable          → "Unit Price: $90 / unit"
  //   • rentable, period    → "Rate: $3,200 / WEEK"; else "$270 / DAY"
  PageModule.prototype.bundleRateText = function(row, hideRatesForQuote, ppmRateText) {
    if (ppmRateText) return ((row && row.isRentable === false) ? 'Unit Price: ' : 'Rate: ') + ppmRateText;
    if (hideRatesForQuote) return 'Rate on request';
    if (!row) return 'Select dates to see rate';
    var fmt = function(n) { var v = Number(n); return isNaN(v) ? '0' : v.toLocaleString('en-US'); };
    if (row.isRentable === false) {
      return row.unitPrice != null ? 'Unit Price: $' + fmt(row.unitPrice) + ' / unit' : 'Unit price not set';
    }
    if (row.rate == null) return 'Rate on request';
    if (row.periodAmount == null) {
      var rateUom = (row.rateUom || '').toString().trim().toUpperCase();
      return 'Rate: $' + fmt(row.rate) + (rateUom ? ' / ' + rateUom : '');
    }
    var t = (row.periodType || '').toString().trim().toUpperCase();
    var NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };
    var uom = t ? (NOUNS[t] || t) : '';
    return 'Rate: $' + fmt(row.periodAmount) + (uom ? ' / ' + uom : '');
  };

  // Availability badge class, same eq-status-* naming as the catalog card.
  PageModule.prototype.bundleStatusClass = function(status) {
    return 'eq-status-badge eq-status-' + String(status || 'unknown').replace(/ /g, '-').toLowerCase();
  };

  // Stepper value for a Frequently bundled with card: the qty the customer set,
  // else the link's suggestedQuantity.
  PageModule.prototype.bundleQtyFor = function(suggestion, qtyById) {
    if (!suggestion) return 0;
    var v = qtyById && qtyById[suggestion.id];
    return v != null ? Number(v) : Number(suggestion.suggestedQty || 1);
  };

  // Toolbar text next to "Add bundle" — same selection rule the chain uses.
  PageModule.prototype.bundleSummaryText = function(record, mainQty, suggestions, qtyById) {
    var sel = cart.bundleSelection(record, mainQty, suggestions, qtyById);
    var n = sel.items.length;
    if (!sel.includeMain && n === 0) return 'Select your rental dates to add this bundle.';
    var bundled = n + ' bundled item' + (n === 1 ? '' : 's');
    return sel.includeMain
      ? 'Add this item (qty ' + sel.mainQty + ') and ' + bundled + ' to your cart in one step.'
      : 'Add ' + bundled + ' to your cart in one step.';
  };

  PageModule.prototype.bundleHasAddable = function(record, mainQty, suggestions, qtyById) {
    var sel = cart.bundleSelection(record, mainQty, suggestions, qtyById);
    return sel.includeMain || sel.items.length > 0;
  };

  return PageModule;
});
