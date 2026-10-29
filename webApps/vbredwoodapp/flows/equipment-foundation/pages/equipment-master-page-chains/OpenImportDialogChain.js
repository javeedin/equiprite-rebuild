define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Opens the "Import From Fusion" screen: loads the two filter LOVs and the
   * staging grid.
   *
   * The screen is a WORKING VIEW of EQR_EQUIPMENT_MASTER_T, not a wizard. The
   * import stages rows rather than promoting them — class and subclass are
   * assigned by hand afterwards — so the grid stays on screen throughout and
   * refreshes after each run.
   *
   * ── WHY THERE IS A FILTER AT ALL ──────────────────────────────────────
   * The Fusion item master holds everything the customer has ever defined —
   * on Dev 20 that is 5,266 inventory items, including groceries and laptops.
   * Importing all of it and letting the user sift afterwards makes the
   * mapping screen unusable. So the user narrows the extract FIRST, by item
   * class and/or item type.
   *
   * ── WHY THESE TWO, AND WHY FROM FUSION REST ───────────────────────────
   * Item class and item type are the two classification axes the extract
   * actually carries (ESI_ITEM_CLASS_CODE and ESI_ITEM_TYPE on
   * EQP_INV_Item_Master_RP). Category was dropped when the report was cut to
   * four tables, so it is not offered here — offering a filter the extract
   * cannot honour would be worse than offering none.
   *
   * Both lists come from Fusion's own REST resources rather than a BIP report:
   *   itemClasses          -> the PIM item-class hierarchy
   *   standardLookupsLOV   -> lookup type EGP_ITEM_TYPE, which Oracle
   *                           documents as the source of valid ItemType values
   *
   * That matters. A BIP LOV would mean a SOAP call returning base64 XML to
   * decode client-side; these return plain JSON and bind straight to
   * oj-select-single. Same reason the rest of the app uses ProjectLOV.
   *
   * ── BOTH LOVS ARE OPTIONAL ────────────────────────────────────────────
   * Leaving both empty imports everything, which is the old behaviour. The
   * screen does not force a choice because a first-time user has no idea what
   * their item classes are called; they can import broadly once and narrow
   * later.
   */
  // Long enough for a slow Fusion REST response, short enough that a hung one
  // does not leave the filters disabled indefinitely.
  const LOV_TIMEOUT_MS = 20000;

  class OpenImportDialogChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      if ($page.variables.isImporting) {
        // A run owns the screen — reopen it without resetting anything.
        this.setDialog(context, true);
        return;
      }

      $page.variables.importMessage = '';
      $page.variables.importWarning = '';
      this.setDialog(context, true);
      $page.variables.lovsLoading   = true;

      // Show whatever is already staged from a previous run, IN PARALLEL with
      // the filter LOVs -- not after them. The screen is a working view of
      // EQR_EQUIPMENT_MASTER_T; waiting on two Fusion REST calls first meant
      // that one hung call (measured 2026-10-02: the dialog sat with Fetch
      // disabled and an empty grid over 4,820 staged rows) blanked the screen.
      const staging = Actions.callChain(context, { chain: 'LoadStagingChain' })
        .catch(() => null);

      // "What to map next" groups, also in parallel and for the same reason:
      // the GROUP BY behind it must not delay the grid. The chain never
      // throws; the catch only guards a VB-level callChain failure.
      const unmatched = Actions.callChain(context, { chain: 'LoadUnmatchedValuesChain' })
        .catch(() => null);

      // Each LOV is capped at LOV_TIMEOUT_MS: a Fusion call that never
      // answers yields an empty dropdown instead of a dialog stuck "loading".
      // The filters are optional, so an empty one is a safe outcome.
      const [classes, types] = await Promise.all([
        this.withTimeout(this.loadItemClasses(context), []),
        this.withTimeout(this.loadItemTypes(context), []),
      ]);

      $page.variables.itemClassOptionsArray = classes;
      $page.variables.itemTypeOptionsArray  = types;
      $page.variables.lovsLoading           = false;

      await Promise.all([staging, unmatched]);
    }

    /** Resolves with `fallback` if `promise` has not settled in LOV_TIMEOUT_MS. */
    withTimeout(promise, fallback) {
      return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve(fallback), LOV_TIMEOUT_MS))
      ]);
    }


    /**
     * Opens/closes the dialog imperatively.
     *
     * oj-dialog has NO 'open' property, so open="{{ $variables... }}" in the
     * HTML is stored as a literal string and never evaluated — the dialog
     * simply never appears, with no error anywhere. Verified in a browser.
     * The element's own open()/close() methods are the supported API.
     *
     * importDialogOpen is still maintained as page state because other logic
     * reads it; it just cannot DRIVE the component.
     */
    setDialog(context, wantOpen) {
      const { $page } = context;
      $page.variables.importDialogOpen = wantOpen;

      const dlg = document.getElementById('importFusionDialog');
      if (!dlg || typeof dlg.open !== 'function') {
        return;
      }
      const isOpen = typeof dlg.isOpen === 'function' ? dlg.isOpen() : false;
      if (wantOpen && !isOpen) {
        dlg.open();
      } else if (!wantOpen && isOpen) {
        dlg.close();
      }
    }

    /**
     * Fusion PIM item classes.
     *
     * ⚠ THE VALUE IS ItemClassCode, THE LABEL IS ItemClass. They are different
     *   attributes and the distinction is load-bearing:
     *     ItemClass      "Name of the item class"          -> what a user reads
     *     ItemClassCode  "Internal name of an item class"  -> what
     *                    EGP_SYSTEM_ITEMS_B.ITEM_CLASS_CODE actually contains
     *   Oracle defaults the code from the name at creation, so they usually
     *   look identical — until someone renames a class, after which the name
     *   changes and the code does not. Binding the value to the name would
     *   then filter on a string the database has never heard of and the import
     *   would return zero rows with no error.
     *
     * There is NO ItemClassName attribute on this resource. Asking for one
     * returns HTTP 400: "URL request parameter fields with value ... is not
     * valid." That was the first version of this call.
     *
     * q= restricts the list to classes that are enabled and can actually hold
     * items; the resource otherwise returns the whole taxonomy including the
     * root and empty classes, which would offer filters that match nothing.
     */
    async loadItemClasses(context) {
      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ItemClasses',
          uriParams: {
            q:        'EnabledFlag=true;ItemCreationAllowedFlag=true',
            fields:   'ItemClassId,ItemClass,ItemClassCode',
            onlyData: true,
            limit:    500,
            orderBy:  'ItemClass:asc',
          },
        });

        if (!resp || !resp.ok || !resp.body || !Array.isArray(resp.body.items)) {
          return [];
        }

        return resp.body.items
          .filter((r) => r && r.ItemClassCode)
          .map((r) => ({
            value: r.ItemClassCode,
            label: r.ItemClass || r.ItemClassCode,
          }));
      } catch (e) {
        // A failed LOV must not block the import — the user can still run it
        // unfiltered. Swallowing is deliberate; the empty dropdown is the
        // signal.
        return [];
      }
    }

    /**
     * Item types, from the EGP_ITEM_TYPE standard lookup.
     *
     * Oracle documents ItemType's accepted values as coming from exactly this
     * lookup type, so LookupCode/Meaning map onto value/label with no
     * translation. The extract filters on the CODE.
     */
    async loadItemTypes(context) {
      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05StandardLookupsLOV',
          uriParams: {
            q:        "LookupType='EGP_ITEM_TYPE'",
            fields:   'LookupCode,Meaning',
            onlyData: true,
            limit:    200,
          },
        });

        if (!resp || !resp.ok || !resp.body || !Array.isArray(resp.body.items)) {
          return [];
        }

        return resp.body.items
          .filter((r) => r && r.LookupCode)
          .map((r) => ({
            value: r.LookupCode,
            // Meaning is the human label; fall back to the code so a lookup
            // with no translation still renders as something selectable.
            label: r.Meaning || r.LookupCode,
          }));
      } catch (e) {
        return [];
      }
    }
  }

  return OpenImportDialogChain;
});
