define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openEditClassSubclassChain.js. Unchanged except the
  // dialog: the old dialog is an inline editor in its section (shown while its is…Open flag is true).

  // Pencil (edit) affordance on the Equipment Classes grid: pre-fill the edit
  // dialog with the selected subclass row's Consumable / Auto-Consume flags and
  // Buffer Period, then open the dialog.
  class openEditClassSubclassChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;

      const all = $page.variables.AllSubclassesArray || [];
      const row = all.find(function(r) { return Number(r.id) === Number(id); });
      if (!row) return;

      $page.variables.EditClassSubclass = {
        id:              Number(row.id),
        classId:         row.classId != null ? Number(row.classId) : null,
        subclassName:    row.subclassName || '',
        // TYPE — mapSubclassRows already normalised this to a known code, so the
        // select always has a bindable value.
        trackingType:    row.trackingType || 'INVENTORY',
        consumableFlag:  row.consumableFlag === 'Y' ? 'Y' : 'N',
        autoConsumeFlag: row.autoConsumeFlag === 'Y' ? 'Y' : 'N',
        // Real round trip: GET returns it, mapSubclassRows maps it, PATCH persists it.
        // The 'N' fallback is the column default for a row never set, not a placeholder
        // for a missing backend.
        timesheetEntryEnabled: row.timesheetEntryEnabled === 'Y' ? 'Y' : 'N',
        // Procurement markup (subclass-level, external procurement only). No column
        // exists yet and the save chain does not send it, so this is always null on
        // open and any edit is discarded with the dialog. oj-input-number needs
        // number|null — never '' (that throws a fatal JetElementError).
        procurementMarkupPct: row.procurementMarkupPct != null && row.procurementMarkupPct !== ''
          ? Number(row.procurementMarkupPct) : null,
        bufferPeriodDays: row.bufferPeriodDays != null ? Number(row.bufferPeriodDays) : 0
      };

      $page.variables.isSubclassEditOpen = true;
    }
  }

  return openEditClassSubclassChain;
});
