define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Open the Equipment Settings "Add BU Settings" drawer in CREATE mode.
  // Resets the draft so each open starts clean. The BU picker (EsBuLovSDP) queries
  // Fusion itself, so there's nothing to preload here; captureEsBuChain fills
  // buAttrs once a BU is picked.
  class openEsDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.esIsEditMode = false;
      $page.variables.EsBuSelectedName = '';
      $page.variables.EsDraft = {
        buId: null, buName: '', buAttrs: null,
        RATE_SOURCE: '', PPM_TRANS_SOURCE: '', PPM_BATCH_PREFIX: '',
        PASS_PROCUREMENT_COST: false,
        ADHOC_TIMESHEET_ENABLED: false,
        // null, not 0: a new BU has expressed no markup policy, and null says that.
        // 0 is a real policy ("pass the PO cost through untouched") and the views
        // treat the two the same via NVL, but only null keeps "unset" legible in the
        // grid. Seeded here because esColumnMap carries the key — see the wipe-hazard
        // note there.
        MARGIN_PERCENTAGE: null
        // IS_SHIP_DOCUMENT dropped: the Ship Doc switch is gone from the drawer.
      };

      $page.variables.isEsDrawerOpen = true;
    }
  }

  return openEsDrawerChain;
});
