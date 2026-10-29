define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/saveEditClassSubclassChain.js. Unchanged except the
  // dialog: the old dialog is an inline editor in its section (shown while its is…Open flag is true).

  // Save the Edit Subclass dialog. Persists the Consumable / Auto-Consume flags
  // and the Buffer Period via PATCH to EQR_EQUIPMENT_SUBCLASS (backend V149 added
  // CONSUMABLE_FLAG / AUTO_CONSUME_FLAG / BUFFER_PERIOD_DAYS). The PATCH is
  // partial — it sends only these three keys, so the backend leaves
  // subclassName / subclassCode / FK / effective dates untouched. The grid row in
  // AllSubclassesArray is reconciled from the PATCH response (the full DTO), not
  // from the dialog's optimistic values.
  //
  // Endpoint path is nested under the parent class:
  //   PATCH /equiprite/v1/equipment-classes/{classId}/subclasses/{id}
  // so BOTH classId and id must be supplied as uriParams.
  class saveEditClassSubclassChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const edit = $page.variables.EditClassSubclass || {};
      if (edit.id == null) return;

      // classId is required for the nested path. Fall back to the grid row if the
      // dialog object somehow lost it.
      let classId = edit.classId;
      if (classId == null) {
        const src = ($page.variables.AllSubclassesArray || [])
          .find(r => Number(r.id) === Number(edit.id));
        classId = src ? src.classId : null;
      }
      if (classId == null) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not save',
          message: 'Missing parent class for this subclass.',
          displayMode: 'transient', type: 'error'
        });
        return;
      }

      const consumableFlag = edit.consumableFlag === 'Y' ? 'Y' : 'N';
      const autoConsumeFlag = edit.autoConsumeFlag === 'Y' ? 'Y' : 'N';
      const bufferPeriodDays = edit.bufferPeriodDays != null ? Number(edit.bufferPeriodDays) : 0;
      // Two-level control §0 Level 2. PERSISTS CORRECTLY via PATCH — the column, the
      // entity field, the DTO property and the mapper have all been present the whole
      // time (confirmed by the backend 2026-09-24 against the running service).
      //
      // An earlier comment here claimed the DTO dropped this key. That was wrong, and
      // the way it was wrong is worth keeping: it was inferred from a stale local
      // openapi3.json plus the column reading 'N' on every row, never from testing the
      // live API. The real fault was on PUT/updateSubclass, where MapStruct had no null
      // strategy and copied nulls from omitted properties onto NOT NULL columns — the
      // write was REJECTED with a 400, not silently swallowed. Fixed backend-side with
      // nullValuePropertyMappingStrategy = IGNORE. This chain never called PUT, so it
      // was never the affected path.
      const timesheetEntryEnabled = edit.timesheetEntryEnabled === 'Y' ? 'Y' : 'N';

      // TYPE (TRACKING_TYPE) — the subclass's default tracking intent for NEW items.
      // Live since Flyway V362: column added (DEFAULT 'INVENTORY' NOT NULL, CHECK on the
      // four codes), bound through the entity/DTO/mapper, verified end to end.
      //
      // Backend validation contract: null/blank is coerced to INVENTORY (the column
      // default); an unrecognised value is REJECTED with a 400 naming the field rather
      // than being silently rewritten. So the '|| INVENTORY' below is a convenience for
      // an unset dialog value, not a sanitiser — never send a value the LOV cannot
      // produce and expect it to be quietly corrected.
      const trackingType = edit.trackingType || 'INVENTORY';

      // procurementMarkupPct is deliberately NOT in the body, and as of 2026-09-03 the
      // dialog no longer offers the field either — the pairing was the problem. It had
      // become a control that looked like it worked: type 10, Save, success toast,
      // nothing changed. EQR_EQUIPMENT_SUBCLASS has no markup column (verified live:
      // 15 columns, none of them markup/margin/procurement), while BOTH post-cost views
      // price markup from EQR_CONF_EQUIPMENT_SETTING.MARGIN_PERCENTAGE — the only markup
      // column that exists in the schema. So authoring has gone back to BU Settings,
      // where the storage and the engine already agree.
      //
      // Per-subclass markup is still the right eventual grain: markup is a property of
      // what you are procuring, not of who is procuring it. This mapping is left in
      // place on purpose so reviving it is a UI change plus a backend column rather
      // than a rebuild. To turn it on: add the column, add `procurementMarkupPct` here
      // and to the reconcile block below, restore the dialog field, and repoint the two
      // views' markup join at the subclass. PatchUtils.applyPatch ignores unknown keys
      // BY DESIGN (confirmed by the backend 2026-09-24 — it is shared by every PATCH
      // endpoint and making it strict is a service-wide contract change), so sending
      // this before the column exists would silently do nothing.
      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchSubclass',
        uriParams: { classId: Number(classId), id: Number(edit.id) },
        body: { consumableFlag, autoConsumeFlag, bufferPeriodDays, timesheetEntryEnabled, trackingType }
      });

      if (!result.ok) {
        const detail = (result.body && JSON.stringify(result.body)) || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not save',
          message: 'Failed to update "' + (edit.subclassName || 'subclass') + '". ' + detail,
          displayMode: 'transient', type: 'error'
        });
        return;
      }

      // Reconcile the grid row from the returned DTO so the table reflects the
      // persisted DB state (incl. any backend normalisation / bumped version).
      const dto = (result.body) || {};
      const yn = v => (v === 'Y' || v === true ? 'Y' : 'N');
      const patched = {
        consumableFlag: yn(dto.consumableFlag != null ? dto.consumableFlag : consumableFlag),
        autoConsumeFlag: yn(dto.autoConsumeFlag != null ? dto.autoConsumeFlag : autoConsumeFlag),
        bufferPeriodDays: dto.bufferPeriodDays != null ? Number(dto.bufferPeriodDays) : bufferPeriodDays,
        // The DTO returns both of these (confirmed by the backend 2026-09-24;
        // trackingType landed in V362). The dialog value is kept only as a
        // fallback for a response that omits them -- the DTO always wins when
        // present, so backend normalisation is what reaches the grid.
        timesheetEntryEnabled: yn(dto.timesheetEntryEnabled != null ? dto.timesheetEntryEnabled : timesheetEntryEnabled),
        trackingType: dto.trackingType != null ? dto.trackingType : trackingType
      };

      $page.variables.AllSubclassesArray = ($page.variables.AllSubclassesArray || [])
        .map(r => Number(r.id) === Number(edit.id) ? { ...r, ...patched } : r);

      $page.variables.isSubclassEditOpen = false;

      await Actions.fireNotificationEvent(context, {
        summary: 'Subclass updated',
        message: 'Saved "' + (edit.subclassName || 'subclass') + '".',
        displayMode: 'transient',
        type: 'confirmation'
      });
    }
  }

  return saveEditClassSubclassChain;
});
