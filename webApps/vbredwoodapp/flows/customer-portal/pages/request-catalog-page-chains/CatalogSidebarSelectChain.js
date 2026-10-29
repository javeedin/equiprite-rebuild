define([
  'vb/action/actionChain',
  'resources/js/catalogCriterion',
], function(ActionChain, criterion) {
  'use strict';

  // Sidebar "All Equipment" (empty params → clear class/subclass) and subclass
  // clicks (set class + subclass). Writes the selection INTO filterCriterion as
  // chips so (a) the DPV re-queries the server and (b) the smart-search shows the
  // matching chips — sidebar and chips are one filter state.
  class CatalogSidebarSelectChain extends ActionChain {
    async run(context, params) {
      var $page = context.$page;
      var className    = params && params.className    ? String(params.className)    : '';
      var subClassName = params && params.subClassName ? String(params.subClassName) : '';
      var classId    = params && params.classId    != null && params.classId    !== '' ? Number(params.classId)    : null;
      var subclassId = params && params.subclassId != null && params.subclassId !== '' ? Number(params.subclassId) : null;

      $page.variables.selectedSidebarClass    = className;
      $page.variables.selectedSidebarSubclass = subClassName;

      if (!className) {
        // "All Equipment" clicked → collapse every expanded category.
        $page.variables.expandedClasses = [];
      } else if (($page.variables.expandedClasses || []).indexOf(className) === -1) {
        // Subclass clicked → ensure its parent class stays expanded.
        $page.variables.expandedClasses = ($page.variables.expandedClasses || []).concat([className]);
      }

      // Keep keyword; replace class/subclass chips. null clears (e.g. "All").
      var nextCriterion = criterion.merge(
        $page.variables.filterCriterion,
        { equipmentClassId: classId, equipmentSubclassId: subclassId }
      );

      // Rescope the Subclass chip's own dropdown to this Class — done here
      // (not left to CatalogFilterCriterionChangedChain) because a
      // programmatic write to filterCriterion from a chain doesn't reliably
      // fire the smart-search's own on-filter-criterion-changed event (same
      // quirk as the "All Equipment" remount above).
      $page.variables.SubclassOptionsFilteredArray =
        criterion.scopeSubclasses($page.variables.SubclassOptionsArray, classId);

      if (!className) {
        // "All Equipment" — nextCriterion is already correctly stripped of
        // the Class/Subclass nodes, but oj-sp-smart-search does not re-render
        // its OWN internal chip list just because filter-criterion was
        // reassigned programmatically (same quirk handled on
        // equipment-analytics-page's TabChangedChain for a tab's full config
        // swap). Unmount/remount so the widget actually drops the visible
        // Class/Subclass chips instead of leaving stale ones on screen while
        // the underlying criterion has already cleared.
        $page.variables.catalogSmartSearchVisible = false;
        $page.variables.filterCriterion = nextCriterion;
        await new Promise(function(resolve) { setTimeout(resolve, 0); });
        $page.variables.catalogSmartSearchVisible = true;
      } else {
        $page.variables.filterCriterion = nextCriterion;
      }
    }
  }

  return CatalogSidebarSelectChain;
});
