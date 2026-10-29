define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/assetChildren',
], (ActionChain, Actions, assetChildren) => {
  'use strict';

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  // Ship-time behaviour this copy must agree with. maintAssetLocation relocates
  // a shipped unit's Fusion asset (MAINT_ASSET_LOCATION_SYNC_ENABLED) and, only
  // when MAINT_ASSET_CASCADE_CHILDREN is on, its children too. With cascade ON
  // the copy adds that the children move with it in Fusion.
  function cascadeOn($application) {
    try {
      return $application.functions.isFeatureEnabled(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'MAINT_ASSET_CASCADE_CHILDREN') === true;
    } catch (e) {
      return false;
    }
  }

  // Dialog copy, built here so the HTML only binds strings.
  function describe(serial, r, cascade) {
    const p = r.parent;
    const kids = r.descendantCount;
    const grand = kids - r.childCount;

    let headline;
    if (p && kids) headline = serial + ' is a child of ' + p.assetNumber + ' and has ' + plural(r.childCount, 'child asset');
    else if (p)    headline = serial + ' is a child asset of ' + p.assetNumber;
    else           headline = serial + ' has ' + plural(r.childCount, 'child asset');

    const lines = [];
    if (p) {
      lines.push('It is attached to parent asset ' + p.assetNumber +
                 (p.description ? ' (' + p.description + ')' : '') + ' in Fusion Maintenance.');
    }
    if (grand > 0) {
      lines.push(plural(kids, 'asset') + ' sit below it in total: ' + r.childCount +
                 ' direct and ' + grand + ' further down.');
    }
    if (r.truncated) {
      lines.push('The structure is large, so only the first levels are shown.');
    }
    if (r.partial) {
      lines.push('Some components could not be read from Fusion, so the list may be incomplete.');
    }

    const kidsPhrase = grand > 0
      ? plural(kids, 'attached asset') + ' (all levels below it)'
      : plural(kids, 'child asset');

    // Allocation wording (decided 2026-10-02): components like tyres physically
    // travel with the unit, so the copy states what is TRUE in EquipRite — only
    // this unit is allocated and tracked — rather than what leaves the yard.
    const related = [];
    if (kids) related.push(kidsPhrase);
    if (p)    related.push('parent asset ' + p.assetNumber);
    const verb = (related.length > 1 || kids > 1) ? 'are' : 'is';
    let ackText = 'I understand that only this unit, ' + serial + ', is allocated on this request. Its ' +
                  related.join(' and its ') + ' ' + verb + ' not allocated or tracked separately.';
    if (cascade && kids) {
      ackText += ' Its child assets will be moved with it in Fusion when it ships.';
    }

    return { headline, detail: lines.join(' '), ackText };
  }

  /**
   * Fired by the page module's _onStageAssign (custom event onCheckChildAssets)
   * before a serial is staged. If the unit's Fusion maintenance asset sits in an
   * asset structure — it has a parent, children, or both — shows the structure
   * read-only and asks the user to acknowledge what ships; otherwise stages the
   * assign straight away.
   *
   * A warning, never a block: not maintenance, no asset, no relations, or a
   * failed / timed-out lookup all end in completeStageAssign(resourceId, true).
   *
   * Params (from the page JSON listener):
   *   resourceId   {number} scheduler row id
   *   serialRefId  {number} EQR serial id
   *   serialNumber {string} for the dialog copy
   */
  class CheckChildAssetsChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const resourceId = Number(params.resourceId);
      const serial = params.serialNumber || 'This unit';

      // Only maintenance-tracked equipment is checked; everything else assigns
      // straight through (status NOT_MAINTENANCE).
      const masterId = ($page.variables.lineData && $page.variables.lineData.equipment_master_id)
        || $page.variables.equipmentMasterId;
      const result = await assetChildren.forSerial(context, Actions, params.serialRefId, masterId);

      if (result.status !== 'HAS_RELATIONS') {
        if (result.status === 'ERROR') {
          await Actions.fireNotificationEvent(context, {
            summary:     'Asset hierarchy not checked',
            message:     'Could not read the maintenance asset hierarchy for ' + serial +
                         ' from Fusion, so it was staged without the check. Save to keep it.',
            type:        'warning',
            displayMode: 'transient'
          });
        }
        const outcome = $page.functions.completeStageAssign(resourceId, true, 0);
        await assetChildren.notifyOutcome(context, Actions, outcome, serial);
        return;
      }

      const copy = describe(serial, result, cascadeOn($application));
      $page.variables.childAssetCheck = {
        resourceId:      resourceId,
        serialNumber:    params.serialNumber || '',
        descendantCount: result.descendantCount,
        rows:            result.rows,
        headline:        copy.headline,
        detail:          copy.detail,
        ackText:         copy.ackText,
      };
      $page.variables.childAssetsAcknowledged = false;

      const dlg = assetChildren.findDialog('childAssetsDialog');
      if (dlg && typeof dlg.open === 'function') {
        dlg.open();
        // The row's "Checking…" state ends once the dialog is up; further
        // clicks stay ignored until the user decides.
        $page.functions.childCheckShown(resourceId);
      } else {
        // No dialog to warn with — don't strand the assign.
        console.warn('[line-detail] childAssetsDialog not found; assigning without the warning');
        const outcome = $page.functions.completeStageAssign(resourceId, true, result.descendantCount);
        await assetChildren.notifyOutcome(context, Actions, outcome, serial);
      }
    }
  }

  return CheckChildAssetsChain;
});
