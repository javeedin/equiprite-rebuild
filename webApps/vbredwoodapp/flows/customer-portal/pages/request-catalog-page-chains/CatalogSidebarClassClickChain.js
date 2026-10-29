define([
  'vb/action/actionChain',
  'resources/js/catalogCriterion',
], function(ActionChain, criterion) {
  'use strict';

  // Class-row click. Toggles expand/collapse + selection (local UI state), then
  // writes the class chip into filterCriterion (DPV re-queries server-side and the
  // chip shows in smart-search). Subclass + "All" clicks route through
  // CatalogSidebarSelectChain.
  class CatalogSidebarClassClickChain extends ActionChain {
    async run(context, params) {
      var $page = context.$page;
      var className = params && params.className ? String(params.className) : '';
      var classId   = params && params.classId != null && params.classId !== '' ? Number(params.classId) : null;
      if (!className) return;

      var expanded = ($page.variables.expandedClasses || []).slice();
      var isExpanded = expanded.indexOf(className) !== -1;
      var isSelected = $page.variables.selectedSidebarClass === className
                    && !$page.variables.selectedSidebarSubclass;

      var newClassId;
      if (isSelected && isExpanded) {
        // Second click on an already-selected, expanded class → collapse + clear.
        expanded.splice(expanded.indexOf(className), 1);
        $page.variables.expandedClasses         = expanded;
        $page.variables.selectedSidebarClass    = '';
        $page.variables.selectedSidebarSubclass = '';
        newClassId = null;
      } else {
        if (!isExpanded) expanded.push(className);
        $page.variables.expandedClasses         = expanded;
        $page.variables.selectedSidebarClass    = className;
        $page.variables.selectedSidebarSubclass = '';
        newClassId = classId;
      }

      // Set class chip, clear any subclass chip. Keyword preserved.
      $page.variables.filterCriterion = criterion.merge(
        $page.variables.filterCriterion,
        { equipmentClassId: newClassId, equipmentSubclassId: null }
      );

      // Rescope the Subclass chip's own dropdown to this Class — see
      // CatalogSidebarSelectChain's identical comment for why this can't be
      // left to the smart-search's own change event.
      $page.variables.SubclassOptionsFilteredArray =
        criterion.scopeSubclasses($page.variables.SubclassOptionsArray, newClassId);
    }
  }

  return CatalogSidebarClassClickChain;
});
