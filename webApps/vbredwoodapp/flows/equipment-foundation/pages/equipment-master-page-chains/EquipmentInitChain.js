define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
], (ActionChain, Actions, paging) => {
  'use strict';

  // SDP+DPV init: loads ONLY the LOVs needed by the facet dropdowns, by the
  // row-level enrichment (class/subclass name lookups), and by the staging
  // review grid's cascading class -> subclass editors.
  //
  // Equipment rows are fetched by the SDP+DPV themselves once the table
  // binds to equipmentDPV.instance — no explicit row fetch here.
  class EquipmentInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // ── Classes ─────────────────────────────────────────────────────────
      // fetchAllPages, not one callRest: the endpoint pages at 20, and with 21
      // classes the 21st had no name -- its items showed a subclass under a
      // blank Class (found 2026-10-05, class 1000000135 on page 2).
      const classes = (await paging.fetchAllPages(
        o => Actions.callRest(context, o),
        'eqp-v1/getEquipmentClasses',
        {},
        'getEquipmentClasses'
      )).filter(Boolean);

      $page.variables.classOptionsArray = classes.map(c => ({
        label: c.className || c.name || ('Class ' + c.id),
        value: c.id
      }));
      const classesById = {};
      for (const c of classes) classesById[c.id] = c.className || c.name || '';
      $page.variables.classesById = classesById;

      // ── Subclasses ──────────────────────────────────────────────────────
      // One flat call instead of one call per class. getAllSubclasses
      // (GET /equiprite/v1/subclasses) has existed all along; the previous
      // fan-out issued 1 + N requests to get the same rows.
      //
      // classId is LOAD-BEARING and is why the fan-out had to go: it mapped
      // each subclass to {label, value} and threw the parent class away, so
      // the staging grid had no way to narrow subclasses to the chosen class.
      //
      // The wire field is eqrEquipmentClassId (EquipmentSubclassDto). The
      // configurations page renames it to classId locally
      // (configurations-page.js:108) — that rename is that page's, not the
      // API's, so read the wire name here and fall back to the alias only
      // in case a future DTO change flips it.
      //
      // fetchAllPages, not a bare callRest with size=1000: these endpoints
      // silently cap the page and return a valid 200 carrying a partial set.
      // 44 subclasses fit in one page today, but nothing enforces that.
      // NB: the module exports { fetchAllPages }, not the function itself —
      // call it as paging.fetchAllPages, matching every other consumer.
      const subRows = await paging.fetchAllPages(
        o => Actions.callRest(context, o),
        'eqp-v1/getAllSubclasses',
        {},
        'getAllSubclasses'
      );

      const subOptions = [];
      const subclassesById = {};
      subRows.forEach(s => {
        if (!s) return;
        const name = s.subclassName || s.name || ('Subclass ' + s.id);
        subOptions.push({
          label:   name,
          value:   s.id,
          // Kept on the option so the grid can filter per row without a
          // second lookup.
          classId: s.eqrEquipmentClassId != null ? s.eqrEquipmentClassId : s.classId
        });
        subclassesById[s.id] = name;
      });

      $page.variables.subclassOptionsArray = subOptions;
      $page.variables.subclassesById = subclassesById;

      // ── Asset groups (synced from Fusion Maintenance) ───────────────────
      // Facet only. The list filters server-side on assetGroupId: items with
      // at least one active asset in the group (EQR_ASSET_GROUP_ITEM_V).
      // Groups past their inactiveOnDate are left out of the dropdown.
      const today = new Date().toISOString().slice(0, 10);
      const groups = await paging.fetchAllPages(
        o => Actions.callRest(context, o),
        'eqp-v1/getAssetGroups',
        {},
        'getAssetGroups'
      );
      $page.variables.assetGroupOptionsArray = groups
        .filter(g => g && !(g.inactiveOnDate && String(g.inactiveOnDate).slice(0, 10) <= today))
        .map(g => ({ label: g.groupName || g.groupNumber || ('Group ' + g.id), value: g.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  return EquipmentInitChain;
});
