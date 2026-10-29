define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
], (ActionChain, Actions, paging) => {
  'use strict';

  // Opens Equipment. The filter lists are the old EquipmentInitChain's, with its calls and rules:
  //   classes      GET /equipment-classes through fetchAllPages (it pages at 20 and there are more)
  //   subclasses   GET /subclasses through fetchAllPages, keeping each subclass's class (eqrEquipmentClassId)
  //   asset groups GET /asset-groups through fetchAllPages, groups past their inactiveOnDate left out, by name
  // Then the list itself (loadEquipmentChain), and three reads the old page did not make, none of which can
  // stop the page: GET /locations for the map, the latest Fetch and Sync from the job log, and how many fetched
  // items wait for review (FULL access only, as Import From Fusion is).
  const TRIES = 60;
  const GAP_MS = 50;

  class equipmentInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < TRIES && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      $page.variables.canWrite = $application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded,
        'EQR_EQUIPMENT_MASTER') === 'FULL';

      const list = Actions.callChain(context, { chain: 'loadEquipmentChain' });
      await Promise.all([this.lovs(context), this.locations(context), this.lastRuns(context), this.waiting(context)]);
      await list;
    }

    async lovs(context) {
      const { $page } = context;
      try {
        const classes = (await paging.fetchAllPages(
          o => Actions.callRest(context, o), 'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses')).filter(Boolean);
        $page.variables.classOptions = classes
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
        $page.variables.subclassOptions = subOptions.sort((a, b) => a.label.localeCompare(b.label));
        $page.variables.subclassesById = subclassesById;

        const today = new Date().toISOString().slice(0, 10);
        const groups = await paging.fetchAllPages(
          o => Actions.callRest(context, o), 'eqp-v1/getAssetGroups', {}, 'getAssetGroups');
        $page.variables.assetGroupOptions = groups
          .filter(g => g && !(g.inactiveOnDate && String(g.inactiveOnDate).slice(0, 10) <= today))
          .map(g => ({ label: g.groupName || g.groupNumber || ('Group ' + g.id), value: g.id }))
          .sort((a, b) => a.label.localeCompare(b.label));
      } catch (e) {
        console.warn('[equipmentInitChain] filter lists could not be loaded', e);
      }
    }

    async locations(context) {
      try {
        const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getLocations' });
        context.$page.variables.locations = res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : [];
      } catch (e) {
        context.$page.variables.locations = [];
      }
    }

    // The newest EQR_JOB_RUN_LOG row of the Fetch (EQUIP_ITEM_DEF_SYNC, as ImportFromFusionChain reads it) and of
    // the Sync (EQUIP_ITEM_REFRESH_SYNC). Shown only when a row comes back.
    async lastRuns(context) {
      const one = async (jobName) => {
        try {
          const r = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getJobRunLogs',
            uriParams: { jobName: jobName, size: 1, orderBy: 'startedAt:desc' },
          });
          const row = r && r.ok && r.body && Array.isArray(r.body.data) ? r.body.data[0] : null;
          return row ? (row.startedAt || row.endedAt || row.createdDate || '') : '';
        } catch (e) {
          return '';
        }
      };
      const [fetchAt, syncAt] = await Promise.all([one('EQUIP_ITEM_DEF_SYNC'), one('EQUIP_ITEM_REFRESH_SYNC')]);
      context.$page.variables.lastRuns = { fetch: fetchAt, sync: syncAt };
    }

    // Fetched items still in staging (GET /equipment-import/staging, one row asked for: totalElements is honest).
    async waiting(context) {
      const { $page } = context;
      if (!$page.variables.canWrite) return;
      try {
        const r = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipmentImportStaging',
          uriParams: { page: 0, size: 1 },
        });
        const b = r && r.ok && r.body;
        $page.variables.stagingWaiting = b && typeof b.totalElements === 'number' ? b.totalElements : 0;
      } catch (e) {
        $page.variables.stagingWaiting = 0;
      }
    }
  }

  return equipmentInitChain;
});
