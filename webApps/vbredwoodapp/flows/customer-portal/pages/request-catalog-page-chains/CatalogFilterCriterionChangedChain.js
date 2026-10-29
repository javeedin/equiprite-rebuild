define([
  'vb/action/actionChain',
  'resources/js/catalogCriterion',
], function(ActionChain, criterion) {
  'use strict';

  // Fires on oj-sp-smart-search's own on-filter-criterion-changed — i.e. when
  // the user picks/clears a chip DIRECTLY (not via the sidebar, which has its
  // own chains and already handles all of this). Fixes "Subclass filter not
  // working as expected with the parent class":
  //   1. The Subclass chip's dropdown was NEVER scoped to the selected Class
  //      — SubclassOptionsArray (the master list) was bound straight to the
  //      chip, unfiltered, so any subclass of any class could be picked
  //      regardless of the current Class chip.
  //   2. Nothing reconciled the two chips against each other, so picking a
  //      Class after a Subclass (or a Subclass that belongs to a different
  //      Class) ANDed two mutually-exclusive ids together server-side —
  //      always zero results.
  //   3. Picking chips directly never updated the sidebar's highlighted
  //      row (only sidebar clicks did), so the sidebar tree could show a
  //      stale class/subclass relative to what was actually filtering.
  // A flattened node's raw value lives in one of two shapes depending on how
  // it was built — catalogCriterion's OWN merge()/kv() always produce the
  // chip shape, but flatten() also recognizes the flat shape (same dual
  // handling EquipmentRequestFilterChain uses), so this stays correct
  // regardless of which one the live widget actually emits:
  //   flat shape: { op:'$eq', attribute: f, value: v }       → value IS v
  //   chip shape: { op:'$eq', value: { f: v } }               → value[f] is v
  function valueOf(part) {
    if (!part || !part.node) return null;
    var node = part.node;
    if (node.attribute) return node.value;
    if (node.value && typeof node.value === 'object') return node.value[part.field];
    return null;
  }

  class CatalogFilterCriterionChangedChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var fc = $page.variables.filterCriterion;

      var parts = criterion.flatten(fc);
      var classPart = parts.filter(function(p) { return p.field === 'equipmentClassId'; })[0];
      var subPart   = parts.filter(function(p) { return p.field === 'equipmentSubclassId'; })[0];
      var classRaw = valueOf(classPart);
      var subRaw   = valueOf(subPart);
      var classId = classRaw != null ? Number(classRaw) : null;
      var subId   = subRaw   != null ? Number(subRaw)   : null;

      // 1. Rescope the Subclass dropdown to whatever Class is now selected
      // (or the full list if none is).
      var master = $page.variables.SubclassOptionsArray || [];
      var scoped = criterion.scopeSubclasses(master, classId);
      $page.variables.SubclassOptionsFilteredArray = scoped;

      // 2. If the currently-picked Subclass doesn't belong to the newly
      // picked Class, clear it rather than let a contradictory AND reach
      // the server and silently return nothing.
      if (classId != null && subId != null) {
        var stillValid = scoped.some(function(s) { return Number(s.value) === subId; });
        if (!stillValid) {
          $page.variables.filterCriterion = criterion.merge($page.variables.filterCriterion, { equipmentSubclassId: null });
          subId = null;
        }
      }

      // 3. Keep the sidebar tree's highlighted row in sync with whatever the
      // chips now say, by reverse-looking the id back to its name (the
      // sidebar highlights by className/subClassName, not id).
      var classRow = classId != null
        ? (($page.variables.ClassOptionsArray || []).filter(function(c) { return Number(c.value) === classId; })[0])
        : null;
      var subRow = subId != null
        ? scoped.filter(function(s) { return Number(s.value) === subId; })[0]
        : null;

      $page.variables.selectedSidebarClass    = classRow ? classRow.label : '';
      $page.variables.selectedSidebarSubclass = subRow   ? subRow.label   : '';

      if (classRow) {
        if (($page.variables.expandedClasses || []).indexOf(classRow.label) === -1) {
          $page.variables.expandedClasses = ($page.variables.expandedClasses || []).concat([classRow.label]);
        }
      } else {
        $page.variables.expandedClasses = [];
      }
    }
  }

  return CatalogFilterCriterionChangedChain;
});
