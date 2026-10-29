define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Class LOV is now a FILTER over the full subclass list (not a fetch trigger).
  // Selecting a class: records the class id/name, resets the subclass filter, and
  // rebuilds the dependent subclass LOV from the already-loaded AllSubclassesArray.
  class applyClassFilterChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { classId } = params || {};

      const id = classId != null && classId !== '' ? Number(classId) : null;
      $page.variables.EquipmentClassSelectedId = id;

      // Reset the dependent subclass filter when the class changes.
      $page.variables.EquipmentSubclassSelectedId = null;

      // Resolve class name + build the subclass LOV for this class.
      let name = '';
      let subLov = [];
      if (id != null) {
        const match = ($page.variables.EquipmentClassesArray || [])
          .find(c => Number(c.id) === id);
        if (match) name = match.className || '';

        subLov = ($page.variables.AllSubclassesArray || [])
          .filter(r => Number(r.classId) === id)
          .map(r => ({ value: r.id, label: r.subclassName }));
      }

      $page.variables.EquipmentClassSelectedName = name;
      $page.variables.EquipmentSubclassConfigLovArray = subLov;
    }
  }

  return applyClassFilterChain;
});
