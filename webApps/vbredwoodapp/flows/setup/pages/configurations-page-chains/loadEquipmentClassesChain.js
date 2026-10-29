define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Load equipment classes (EQR_EQUIPMENT_CLASS) into the left list of the
  // Equipment Classes tab, then auto-select the first class so its subclasses
  // (EQR_EQUIPMENT_SUBCLASS) load on first render.
  class loadEquipmentClassesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.equipClassesLoading = true;

      try {
        const result = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipmentClasses',
          // The endpoint pages at 20 by default; a short list hides classes from
          // the grid and from Create from Fusion's Exists check.
          uriParams: { size: 1000 }
        });

        const data = (result && result.body && result.body.data) || [];
        const classes = $page.functions.mapClassRows(data);
        $page.variables.EquipmentClassesArray = classes;

        // LOV shape (label/value) for the class selector on this tab.
        $page.variables.EquipmentClassConfigLovArray = classes.map(c => ({
          value: c.id,
          label: c.className
        }));

        // No class pre-selected (filters start cleared). The grid shows ALL
        // subclasses across every class; the class/subclass LOVs filter it.
        $page.variables.EquipmentClassSelectedId = null;
        $page.variables.EquipmentClassSelectedName = '';
        $page.variables.EquipmentSubclassConfigLovArray = [];
        $page.variables.EquipmentSubclassSelectedId = null;

        // Load every subclass (flat, with class names joined) into the grid.
        await Actions.callChain(context, { chain: 'loadAllSubclassesChain' });
      } catch (e) {
        console.error('loadEquipmentClassesChain failed', e);
        $page.variables.EquipmentClassesArray = [];
      } finally {
        $page.variables.equipClassesLoading = false;
      }
    }
  }

  return loadEquipmentClassesChain;
});
