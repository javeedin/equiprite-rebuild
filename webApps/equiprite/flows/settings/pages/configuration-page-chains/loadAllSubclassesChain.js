define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/loadAllSubclassesChain.js, unchanged.

  // Load EVERY subclass across all classes (flat) into the grid. Each row is
  // joined with its class name (from EquipmentClassesArray) so the grid can show
  // a CLASS column. The class/subclass LOVs filter this list client-side.
  class loadAllSubclassesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.equipSubclassesLoading = true;

      try {
        const result = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getAllSubclasses',
          queryParams: { size: 1000 }
        });

        const data = (result && result.body && result.body.data) || [];
        const rows = $page.functions.mapSubclassRows(data);

        // Join the class name onto each row by class id.
        const classes = $page.variables.EquipmentClassesArray || [];
        const nameById = {};
        classes.forEach(c => { nameById[Number(c.id)] = c.className; });

        $page.variables.AllSubclassesArray = rows
          .map(r => ({ ...r, className: nameById[Number(r.classId)] || '' }))
          .sort((a, b) => {
            const byClass = String(a.className).localeCompare(String(b.className));
            return byClass !== 0 ? byClass : String(a.subclassName).localeCompare(String(b.subclassName));
          });
      } catch (e) {
        console.error('loadAllSubclassesChain failed', e);
        $page.variables.AllSubclassesArray = [];
      } finally {
        $page.variables.equipSubclassesLoading = false;
      }
    }
  }

  return loadAllSubclassesChain;
});
