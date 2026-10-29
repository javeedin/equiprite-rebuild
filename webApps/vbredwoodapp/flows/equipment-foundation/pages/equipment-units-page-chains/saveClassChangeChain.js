define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Save the class / subclass picked in the Change Class dialog.
   *
   * PATCH /equipment-master/{id} with both ids, then READ THE RECORD BACK and
   * compare. Nothing else in the app uses this PATCH yet, and whether it
   * clears a field sent as null is unverified; a partial-update that skips
   * nulls would keep the old subclass under the new class. So:
   *   - a class with subclasses requires one (canSaveClass), so null is only
   *     ever sent for a class that has none;
   *   - the read-back catches anything the server did not apply, and says so
   *     rather than reporting success.
   *
   * Only the definition changes. Units are untouched -- they reference the
   * master, not the class. What does change: expenditure types this item
   * inherits from its class or subclass (the confirm says so).
   */
  class saveClassChangeChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      if (v.classChangeSaving) return;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded,
            'EQR_EQUIPMENT_MASTER') !== 'FULL') {
        return;
      }

      const check = $page.functions.canSaveClass(v.classDraft, v.masterRecord, v.subclassOptions);
      if (!check.ok) {
        v.classChangeError = check.message;
        return;
      }

      const ok = window.confirm(
        'Change the class of ' + (v.masterRecord.equipmentNumber || 'this item') + '?\n\n' +
        'Its units are not changed. Expenditure types it inherits from its class or ' +
        'subclass will follow the new one.');
      if (!ok) return;

      const id = Number(v.masterRecord.id || v.equipmentId);
      const want = { classId: v.classDraft.classId, subclassId: v.classDraft.subclassId };
      v.classChangeSaving = true;
      v.classChangeError = '';
      try {
        const body = { equipmentClassId: want.classId, equipmentSubclassId: want.subclassId };
        if (v.masterRecord.objectVersionNumber != null) {
          body.objectVersionNumber = v.masterRecord.objectVersionNumber;
        }
        const resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchEquipment', uriParams: { id: id }, body: body
        }).catch(() => null);
        if (!resp || !resp.ok) {
          v.classChangeError = (resp && resp.status === 409)
            ? 'Someone else changed this item. Close, reopen the page and try again.'
            : 'The class could not be saved' + (resp && resp.status ? ' (HTTP ' + resp.status + ').' : '.');
          return;
        }

        const back = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1EquipmentMasterById', uriParams: { id: id }
        }).catch(() => null);
        const rec = back && back.ok && back.body;
        const got = rec ? {
          classId:    rec.equipmentClassId != null ? Number(rec.equipmentClassId) : null,
          subclassId: rec.equipmentSubclassId != null ? Number(rec.equipmentSubclassId) : null
        } : null;
        if (!got || got.classId !== want.classId || got.subclassId !== want.subclassId) {
          v.classChangeError = got
            ? 'The server did not apply the change as sent (it kept ' +
              (got.classId !== want.classId ? 'the old class' : 'the old subclass') +
              '). Nothing else was changed.'
            : 'Saved, but the item could not be read back to confirm. Reload the page to check.';
          return;
        }

        // Names come from the options the user just picked from.
        const cls = (v.classOptions || []).find(o => o.value === got.classId);
        const sub = (v.subclassOptions || []).find(o => o.value === got.subclassId);
        v.masterRecord = Object.assign({}, v.masterRecord, rec, {
          equipmentClassName:    cls ? cls.label : '',
          equipmentSubclassName: sub ? sub.label : ''
        });

        const dlg = document.getElementById('changeClassDialog');
        if (dlg && typeof dlg.close === 'function') dlg.close();
        await Actions.fireNotificationEvent(context, {
          summary: 'Class changed',
          message: (cls ? cls.label : 'Class') + (sub ? ' / ' + sub.label : '') + ' saved.',
          type: 'confirmation', displayMode: 'transient'
        });
        // Inherited expenditure types follow the class: reload that panel.
        await Actions.callChain(context, { chain: 'loadEquipExpTypesChain' });
      } finally {
        v.classChangeSaving = false;
      }
    }
  }

  return saveClassChangeChain;
});
