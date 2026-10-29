define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Carried over from the old equipment-master-page-chains/LoadStagingChain.js. Changes: the rows are drawn by a div
  // grid, so the rebuild step is indexRows (the old buildStagingGrid's row-key map, without the oj-data-grid
  // provider); the load-error text says Refresh instead of reopening the dialog.
  /**
   * Loads EQR_EQUIPMENT_MASTER_T into the import screen's review grid.
   *
   * Called when the screen opens, after every import, and after every save,
   * so the user sees what actually landed rather than a count they must trust.
   *
   * GET /equiprite/v1/equipment-import/staging was implemented 2026-09-24.
   * Verified live: all 5,266 rows reachable by paging, unclassified rows
   * ordered first, and totalElements is honest even when a requested size is
   * capped — so a short page never has to be guessed at.
   *
   * EVERY row is shown. No status filter is applied by default: a row's
   * status (AUTO_MAPPED, ERRORED, UNMAPPED...) describes what the Class
   * Mapping config made of it, and the user decides by ticking. importStatus
   * is an explicit user filter only.
   */
  // Newest call wins. Opening the dialog, a filter change, paging, Import,
  // Fetch and Clear can all start a load; without this a slow, older response
  // overwrote a newer page or filter and the grid disagreed with its dropdowns.
  let latest = 0;

  class LoadStagingChain extends ActionChain {
    /**
     * @param {{preserve?: boolean}} params
     *   preserve -- keep ticks and pending class edits for rows that are still
     *   on the reloaded page (Import's reload: failed rows stay ticked for a
     *   one-click retry, and edits on unticked rows survive). Without it a load
     *   clears both: the rows on screen changed (paging, filter, Fetch, Clear),
     *   and the caller has already asked the user before discarding them.
     */
    async run(context, params) {
      const { $page } = context;
      const preserve = !!(params && params.preserve);
      const ticket = ++latest;

      $page.variables.stagingLoading = true;

      try {
        const size = $page.variables.stagingPageSize || 100;
        let page = $page.variables.stagingPage || 0;

        // ── ITEM CLASS / ITEM TYPE / STATUS FILTER THE REVIEW, NOT THE EXTRACT
        // The import always pulls every item: OIC forwards only three fixed
        // parameters to BIP, so a filter sent there is dropped (measured
        // 2026-10-01 — itemClass=ROOT_ICC returned the same 922/951/993/999/955
        // batches as no filter). The dropdowns narrow THIS read instead, on the
        // server, so paging and totalElements stay honest. Filtering the 100
        // rows of one page in the browser would hide matches on other pages.
        //
        // Only set keys are sent: an empty param would be bound as '' and
        // match nothing. All three must be declared in openapi3.json — VB
        // silently drops undeclared uriParams.
        const itemClass    = $page.variables.selectedItemClass    || null;
        const itemType     = $page.variables.selectedItemType     || null;
        const importStatus = $page.variables.selectedImportStatus || null;
        // Free-text search over EVERY fetched row, on the server (item number,
        // description, category, item class, segments) -- searching only
        // the 100 rows of this page would miss everything else.
        const search       = (($page.variables.stagingSearch || '') + '').trim() || null;

        const fetchPage = (p) => {
          const q = { page: p, size: size };
          if (itemClass)    q.itemClass    = itemClass;
          if (itemType)     q.itemType     = itemType;
          if (importStatus) q.importStatus = importStatus;
          if (search)       q.search       = search;
          return Actions.callRest(context, { endpoint: 'eqp-v1/getEquipmentImportStaging', uriParams: q });
        };

        let resp = await fetchPage(page);
        if (ticket !== latest) return;

        if (!resp || !resp.ok || !resp.body) {
          this.showLoadError($page);
          return;
        }

        let rows = Array.isArray(resp.body)       ? resp.body
                 : Array.isArray(resp.body.items) ? resp.body.items
                 : [];
        let total = (typeof resp.body.totalElements === 'number')
          ? resp.body.totalElements : rows.length;

        // Past the end: importing every row of the last page (they leave
        // staging) or a Fetch/Clear that shrank staging left the page number
        // beyond the data -- "Showing 5201–5200 of 5150" over an empty grid.
        // Clamp to the last page and read it once more.
        if (!rows.length && total > 0 && page > 0) {
          page = Math.max(0, Math.ceil(total / size) - 1);
          $page.variables.stagingPage = page;
          resp = await fetchPage(page);
          if (ticket !== latest) return;
          if (!resp || !resp.ok || !resp.body) { this.showLoadError($page); return; }
          rows = Array.isArray(resp.body) ? resp.body
               : Array.isArray(resp.body.items) ? resp.body.items : [];
          total = (typeof resp.body.totalElements === 'number') ? resp.body.totalElements : rows.length;
        }

        // ── Ticks and pending edits ───────────────────────────────────────
        // Both are keyed on fusionInventoryItemId. With preserve they are kept
        // for rows still on screen, and each kept edit is re-applied to its
        // row so the grid shows the user's class, not the server's. Otherwise
        // both are cleared -- BEFORE the rebuild, which draws from them.
        const onScreen = {};
        rows.forEach(r => { if (r && r.fusionInventoryItemId != null) onScreen[r.fusionInventoryItemId] = true; });
        const keepTicks = {};
        const keepEdits = {};
        if (preserve) {
          Object.keys($page.variables.stagingSelectedRows || {}).forEach(k => {
            if (onScreen[k]) keepTicks[k] = true;
          });
          const edits = $page.variables.stagingChangedRows || {};
          Object.keys(edits).forEach(k => { if (onScreen[k]) keepEdits[k] = edits[k]; });
          rows = rows.map(r => {
            const e = r && keepEdits[r.fusionInventoryItemId];
            return e ? Object.assign({}, r, { resolvedClassId: e.resolvedClassId,
                                             resolvedSubclassId: e.resolvedSubclassId }) : r;
          });
        }

        $page.variables.stagingArray = rows;
        $page.variables.stagingTotalElements = total;
        $page.variables.stagingSelectedRows = keepTicks;
        $page.variables.stagingChangedRows  = keepEdits;

        // What a cancelled filter change snaps back to (ClearImportWarningChain).
        $page.variables.stagingAppliedFilters = {
          itemClass: itemClass, itemType: itemType, importStatus: importStatus, search: search
        };

        // Rebuild the grid provider from the rows just loaded. This ALSO
        // rebuilds the rowIndex -> fusionInventoryItemId map the edit handler
        // writes through, so it must happen on every load — a stale key map
        // would write a user's class onto the wrong item.
        $page.functions.indexRows(rows, $page.variables);

        // What matters is how many still need someone to assign a class.
        const unclassified = rows.filter(r => r && r.resolvedClassId == null).length;
        // Classified by the Class Mapping config but NOT merged: they wait for
        // a person to tick them and click Import.
        const autoMapped = rows.filter(r => r && r.importStatus === 'AUTO_MAPPED').length;
        const from = total ? (page * size) + 1 : 0;
        const to   = (page * size) + rows.length;

        const filterLabel = [itemClass, itemType, importStatus, search ? '"' + search + '"' : null]
          .filter(Boolean).join(' / ');

        let summary = total
          ? 'Showing ' + from + '–' + to + ' of ' + total
          : (filterLabel
              ? 'No fetched items match ' + filterLabel + '.'
              : 'Nothing fetched yet. Select Fetch to pull items from Fusion.');
        if (total && filterLabel) {
          summary += ' matching ' + filterLabel;
        }
        if (total && unclassified) {
          summary += '  ·  ' + unclassified + ' on this page need a class';
        }
        if (total && autoMapped) {
          summary += '  ·  ' + autoMapped + ' auto-mapped — tick and Import to merge';
        }

        // Guard against the server ignoring the filter (an older backend, or a
        // param name mismatch): it returns 200 with every row, which would
        // otherwise read as a filtered list. Any row that does not match means
        // the filter was not applied — say so rather than mislead.
        const needle = search ? search.toLowerCase() : null;
        const hasText = r => [r.itemNumber, r.itemDescription, r.categoryName, r.itemClassCode,
                              r.catalogCode, r.catSegment1, r.catSegment2]
          .some(x => x != null && String(x).toLowerCase().indexOf(needle) !== -1);
        const unmatched = rows.filter(r => r && (
          (itemClass    && r.itemClassCode !== itemClass) ||
          (itemType     && r.itemType      !== itemType)  ||
          (importStatus && r.importStatus  !== importStatus) ||
          (needle       && !hasText(r))
        )).length;
        if (unmatched) {
          summary += '  ·  ⚠ Filter not applied by the server yet — showing all items';
        }
        $page.variables.stagingSummary = summary;

      } catch (e) {
        if (ticket === latest) this.showLoadError($page);
      } finally {
        if (ticket === latest) $page.variables.stagingLoading = false;
      }
    }

    /**
     * A failed read is NOT empty staging. It used to blank the summary, which
     * read as "nothing fetched" and sent people to re-run a 4-minute Fetch.
     * Ticks and edits are cleared too: Import must not act on rows it can no
     * longer show.
     */
    showLoadError($page) {
      $page.variables.stagingArray = [];
      $page.variables.stagingTotalElements = 0;
      $page.variables.stagingSelectedRows = {};
      $page.variables.stagingChangedRows = {};
      $page.variables.stagingSummary =
        'Could not load the fetched items. Refresh to try again.';
      $page.functions.indexRows([], $page.variables);
    }
  }

  return LoadStagingChain;
});
