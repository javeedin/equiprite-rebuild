define([
  'vb/action/actionChain',
  'resources/js/draftStorage',
], function(ActionChain, draftStorage) {
  'use strict';

  // Local calendar day as 'YYYY-MM-DD' — the format oj-input-date writes.
  function todayIso() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  class CartSaveQtyChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var $flow = context.$flow;

      var itemId       = $page.variables.editingItemId;
      var newQty       = Number($page.variables.editingQty) || 1;
      var newStartDate = ($page.variables.editingStartDate || '').slice(0, 10);
      var newEndDate   = ($page.variables.editingEndDate   || '').slice(0, 10);
      // Hours is optional — blank/null in the dialog stays null on the line.
      var hoursVal     = $page.variables.editingHours;
      var newHours     = (hoursVal != null && hoursVal !== '') ? Number(hoursVal) : null;

      // ── Blocking date rules ────────────────────────────────────────────
      // A past start is only rejected when the user CHANGED it: a resumed
      // draft can already carry one, and that must not stop a quantity edit.
      // (The submitted request still carries it; that is a submit-time call.)
      var errors = {};
      var today = todayIso();
      if (!newStartDate) {
        errors.start = 'Enter a start date.';
      } else if (newStartDate < today && newStartDate !== $page.variables.editingOrigStartDate) {
        errors.start = 'Start date cannot be in the past.';
      }
      if (!newEndDate) {
        errors.end = 'Enter an end date.';
      } else if (newStartDate && newEndDate < newStartDate) {
        errors.end = 'End date cannot be before the start date.';
      }
      $page.variables.editingDateErrors = errors;
      if (errors.start || errors.end) { return; }

      var detail = $flow.variables.ActiveRequestDetail || {};
      var hdrStart = (detail.requestedStartDate || '').slice(0, 10);
      var hdrEnd   = (detail.requestedEndDate   || '').slice(0, 10);

      var cartItems = ($flow.variables.CartItemsArray || []).slice();
      var idx = cartItems.findIndex(function(ci) { return String(ci.id) === String(itemId); });
      if (idx !== -1) {
        // Pin every line to its effective dates BEFORE the header moves. Lines
        // without their own dates fall back to the header, so widening the
        // header for this line would otherwise silently stretch all of them.
        cartItems = cartItems.map(function(ci, i) {
          if (i === idx) {
            return Object.assign({}, ci, {
              quantity:  newQty,
              startDate: newStartDate,
              endDate:   newEndDate,
              hours:     newHours
            });
          }
          return Object.assign({}, ci, {
            startDate: ci.startDate || hdrStart,
            endDate:   ci.endDate   || hdrEnd
          });
        });
        $flow.variables.CartItemsArray = cartItems;
        draftStorage.save('CartItemsArray', cartItems);

        // Request window = span of all lines: REQUIRED FROM is the earliest
        // line start, REQUIRED TO the latest line end. Both header fields and
        // the submitted requestedStartDate / requestedEndDate must cover every
        // line, and may shrink back when the outlying line is edited in again.
        var minStart = '', maxEnd = '';
        cartItems.forEach(function(ci) {
          var s = (ci.startDate || '').slice(0, 10);
          var e = (ci.endDate   || '').slice(0, 10);
          if (s && (!minStart || s < minStart)) { minStart = s; }
          if (e && (!maxEnd   || e > maxEnd))   { maxEnd   = e; }
        });
        if ((minStart && minStart !== hdrStart) || (maxEnd && maxEnd !== hdrEnd)) {
          var updatedDetail = Object.assign({}, detail, {
            requestedStartDate: minStart || detail.requestedStartDate,
            requestedEndDate:   maxEnd   || detail.requestedEndDate
          });
          $flow.variables.ActiveRequestDetail = updatedDetail;
          draftStorage.save('ActiveRequestDetail', updatedDetail);
          // Keep the create form on the same window. Going back to the form
          // and clicking Next rebuilds the request window from these two; left
          // stale, that would undo this edit (and NavigateToCatalogChain would
          // read it as the user changing the dates).
          if ($flow.variables.request) {
            $flow.variables.request.startDate = updatedDetail.requestedStartDate;
            $flow.variables.request.endDate   = updatedDetail.requestedEndDate;
            draftStorage.save('request', $flow.variables.request);
          }
        }

        // Same arguments as InitCartChain — dropping the last two flipped the
        // RATE column from the PPM / quote text back to amounts.
        $page.variables.dataGridProvider = $page.functions.initGridData(
          $flow.variables.CartItemsArray,
          $flow.variables.ActiveRequestDetail || {},
          !$page.variables.showHoursColumn,
          $page.variables.hideRatesForQuote,
          $page.variables.ppmRateText
        );
      }

      $page.variables.editingItemId    = null;
      $page.variables.editingStartDate = '';
      $page.variables.editingEndDate   = '';
      $page.variables.editingHours     = null;
      $page.variables.editingDateErrors = {};
      var dialog = document.getElementById('editQtyDialog');
      if (dialog) { dialog.close(); }
    }
  }

  return CartSaveQtyChain;
});
