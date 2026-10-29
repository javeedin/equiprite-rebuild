define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/directReturn',
], (ActionChain, Actions, dr) => {
  'use strict';

  /**
   * Search for equipment still in the field, for a Direct Return.
   *
   * Runs on every submit of the dialog's search box — Enter (a barcode scanner
   * types then sends Enter) or the Search button.
   *
   * The result is a LIST OF CANDIDATES, never a resolution. A serial does not
   * identify a rental: 47% of deployed serials map to more than one line, so
   * this chain deliberately does not pre-select anything, not even on a single
   * hit. See resources/js/directReturn for the measured detail.
   */

  class DirectReturnSearchChain extends ActionChain {
    /**
     * @param {Object} params
     *   page {number} optional — for paging through a broad result set
     */
    async run(context, params) {
      const { $page } = context;
      const term = String($page.variables.directReturnQuery || '').trim();
      const page = (params && Number(params.page)) || 0;

      if (!term) {
        $page.variables.directReturnRows     = [];
        $page.variables.directReturnSelected = [];
        $page.variables.directReturnMeta     = { recordCount: 0, page: 0, hasMore: false, tooShort: false, searched: false };
        return;
      }

      $page.variables.directReturnSearching = true;
      try {
        // Sent as BOTH q and serialNumber: a scanner produces an exact unit
        // identifier, a human types a fragment, and we cannot tell which we
        // just received. The endpoint treats serialNumber as an exact match on
        // unit_identifier, so a scanned LOT or ITEM label resolves too — not
        // only serials.
        const exact = await dr.findDeployedUnits(context, Actions, {
          serialNumber: term, page: page, size: dr.DEFAULT_PAGE_SIZE
        });

        let result = exact;
        // Fall back to the broad match when the exact one found nothing, which
        // is the normal path for a typed term like "Bobcat".
        if (exact.ok && !exact.rows.length) {
          result = await dr.findDeployedUnits(context, Actions, {
            q: term, page: page, size: dr.DEFAULT_PAGE_SIZE
          });
        }

        if (!result.ok) {
          $page.variables.directReturnRows = [];
          $page.variables.directReturnMeta = {
            recordCount: 0, page: 0, hasMore: false, tooShort: false,
            searched: true, error: true
          };
          return;
        }

        $page.variables.directReturnRows     = result.rows;
        // NEVER pre-select. Even one result must be ticked deliberately —
        // returning the wrong rental frees a unit that is still on site.
        $page.variables.directReturnSelected = [];
        $page.variables.directReturnMeta = {
          recordCount: result.recordCount,
          page:        result.page,
          pageSize:    result.pageSize,
          totalPages:  result.totalPages,
          hasMore:     result.hasMore,
          tooShort:    result.tooShort === true,
          searched:    true,
          error:       false,
          // A serial resolving to several lines is the case the operator most
          // needs warning about — same unit, different rentals.
          ambiguous:   result.rows.length > 1
        };
      } finally {
        $page.variables.directReturnSearching = false;
      }
    }
  }

  return DirectReturnSearchChain;
});
