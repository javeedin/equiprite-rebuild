define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
  'resources/js/equipmentMaster',
], (ActionChain, Actions, paging, em) => {
  'use strict';

  // Opens the Equipment master, and Refresh. New EquipRite's equipmentInitChain, with its calls and rules:
  //   access       waits (bounded) for page access, then FULL on EQR_EQUIPMENT_MASTER is what Sync and Import need
  //   classes      GET /equipment-classes through fetchAllPages (it pages at 20 and there are more)
  //   subclasses   GET /subclasses through fetchAllPages, keeping each subclass's class (eqrEquipmentClassId)
  //   asset groups GET /asset-groups through fetchAllPages, groups past their inactiveOnDate left out, by name
  //   locations    GET /locations, for the map and each item's location
  //   the list, the latest Fetch and Sync from the job log, and what waits for review (refreshListChain)
  // None of the side reads can stop the page. The search is asked again when there is text (Refresh).
  const TRIES = 60;
  const GAP_MS = 50;

  class loadChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < TRIES && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      $page.variables.canWrite = $application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded,
        'EQR_EQUIPMENT_MASTER') === 'FULL';

      const list = Actions.callChain(context, { chain: 'refreshListChain', params: { list: true } });
      await Promise.all([this.lovs(context), this.locations(context)]);
      await Actions.callChain(context, { chain: 'applyChain' });
      await list;
      if (params && params.refresh && em.serverQuery($page.variables.text)) {
        await Actions.callChain(context, { chain: 'searchChain', params: { again: true } });
      }
    }

    async lovs(context) {
      const { $page } = context;
      try {
        const classes = (await paging.fetchAllPages(
          o => Actions.callRest(context, o), 'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses')).filter(Boolean);
        $page.variables.classOptionsArray = classes
          .map(c => ({ label: c.className || c.name || ('Class ' + c.id), value: c.id }))
          .sort((a, b) => a.label.localeCompare(b.label));
        const classesById = {};
        for (const c of classes) classesById[c.id] = c.className || c.name || '';
        $page.variables.classesById = classesById;

        const subRows = await paging.fetchAllPages(
          o => Actions.callRest(context, o), 'eqp-v1/getAllSubclasses', {}, 'getAllSubclasses');
        const subOptions = [];
        const subclassesById = {};
        subRows.forEach(s => {
          if (!s) return;
          const name = s.subclassName || s.name || ('Subclass ' + s.id);
          subOptions.push({ label: name, value: s.id, classId: s.eqrEquipmentClassId != null ? s.eqrEquipmentClassId : s.classId });
          subclassesById[s.id] = name;
        });
        $page.variables.subclassOptionsArray = subOptions.sort((a, b) => a.label.localeCompare(b.label));
        $page.variables.subclassesById = subclassesById;

        const today = new Date().toISOString().slice(0, 10);
        const groups = await paging.fetchAllPages(
          o => Actions.callRest(context, o), 'eqp-v1/getAssetGroups', {}, 'getAssetGroups');
        $page.variables.assetGroupOptions = groups
          .filter(g => g && !(g.inactiveOnDate && String(g.inactiveOnDate).slice(0, 10) <= today))
          .map(g => ({ label: g.groupName || g.groupNumber || ('Group ' + g.id), value: g.id }))
          .sort((a, b) => a.label.localeCompare(b.label));
      } catch (e) {
        console.warn('[loadChain] filter lists could not be loaded', e);
      }
    }

    async locations(context) {
      const { $page } = context;
      try {
        const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getLocations' });
        $page.variables.locations = res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : [];
      } catch (e) {
        $page.variables.locations = [];
      }
      $page.variables.locationsById = em.locationIndex($page.variables.locations);
    }
  }

  return loadChain;
});
