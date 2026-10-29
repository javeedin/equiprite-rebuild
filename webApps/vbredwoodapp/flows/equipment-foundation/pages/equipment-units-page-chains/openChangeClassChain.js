define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
], (ActionChain, Actions, paging) => {
  'use strict';

  /**
   * Open the Change Class dialog for this equipment definition.
   *
   * The only way to re-classify an item that is already in the master
   * (decision 2026-10-05, option A): imported rows leave staging, so the
   * Class Mapping rules have nothing left to match on. A person picks the
   * class here instead.
   *
   * Loads every class and subclass each time it opens -- a class added on the
   * configurations page since this page loaded must be offered. FULL access
   * only; the button is hidden below FULL, this is the backstop.
   */
  class openChangeClassChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded,
            'EQR_EQUIPMENT_MASTER') !== 'FULL') {
        return;
      }

      v.classChangeError = '';
      v.classDraft = {
        classId:    v.masterRecord.equipmentClassId != null ? Number(v.masterRecord.equipmentClassId) : null,
        subclassId: v.masterRecord.equipmentSubclassId != null ? Number(v.masterRecord.equipmentSubclassId) : null
      };

      const dlg = document.getElementById('changeClassDialog');
      if (dlg && typeof dlg.open === 'function') dlg.open();

      v.classChangeLoading = true;
      try {
        const [classes, subs] = await Promise.all([
          paging.fetchAllPages(o => Actions.callRest(context, o),
            'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses'),
          paging.fetchAllPages(o => Actions.callRest(context, o),
            'eqp-v1/getAllSubclasses', {}, 'getAllSubclasses')
        ]);
        // End-dated classes cannot take new items -- except the one this
        // item already has, which must stay selectable to keep it.
        const current = v.classDraft.classId;
        v.classOptions = (classes || [])
          .filter(c => c && (c.id === current || !$page.functions.isEndDated(c.effectiveEndDate)))
          .map(c => ({ value: c.id, label: c.className || c.name || ('Class ' + c.id) }));
        if (!v.classOptions.length) {
          // fetchAllPages returns [] on failure rather than throwing.
          v.classChangeError = 'Could not load the classes. Close and try again.';
        }
        // eqrEquipmentClassId is the wire name (see EquipmentInitChain).
        v.allSubclassOptions = (subs || []).filter(Boolean).map(s => ({
          value: s.id,
          label: s.subclassName || s.name || ('Subclass ' + s.id),
          classId: s.eqrEquipmentClassId != null ? s.eqrEquipmentClassId : s.classId
        }));
        v.subclassOptions = $page.functions.subclassOptionsFor(v.allSubclassOptions, v.classDraft.classId);
      } catch (e) {
        v.classChangeError = 'Could not load the classes. Close and try again.';
      } finally {
        v.classChangeLoading = false;
      }
    }
  }

  return openChangeClassChain;
});
