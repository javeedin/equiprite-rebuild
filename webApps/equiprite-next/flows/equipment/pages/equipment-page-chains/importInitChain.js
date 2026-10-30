define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
  'resources/js/shellBus',
], (ActionChain, Actions, paging, bus) => {
  'use strict';

  // Opens the Import from Fusion view, the first time it is shown. New EquipRite's importInitChain (the import page's
  // entry), with its calls; in Next it runs when the view opens, not on page entry, so browsing the catalog never
  // calls Fusion. FULL access to EQR_EQUIPMENT_MASTER only (the old Import From Fusion menu item was off below FULL);
  // anyone else is told so and stays on the list.
  //
  // Then what the old page loaded for its dialog, with the same calls:
  //   classes and subclasses  the old EquipmentInitChain (fetchAllPages; each subclass keeps its class), for the
  //                           class editor (read again here, so a class added since the list opened is offered)
  //   item class / item type  the old OpenImportDialogChain: Fusion itemClasses and the EGP_ITEM_TYPE lookup, each
  //                           capped at 20 s so a hung Fusion call leaves an empty filter instead of a stuck page
  //   staging + "What to map next"  LoadStagingChain and LoadUnmatchedValuesChain, in parallel with the filters,
  //                           so one slow Fusion call never blanks the grid
  const LOV_TIMEOUT_MS = 20000;
  const TRIES = 60;
  const GAP_MS = 50;

  class importInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < TRIES && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_EQUIPMENT_MASTER') !== 'FULL') {
        bus.toast('Importing from Fusion needs full access to Equipment.', 'warning');
        $page.variables.importReady = false;
        await Actions.callChain(context, { chain: 'applyChain', params: { view: 'list' } });
        return;
      }

      $page.variables.importMessage = '';
      $page.variables.importWarning = '';
      $page.variables.lovsLoading = true;

      const classes = this.loadClasses(context);
      const staging = Actions.callChain(context, { chain: 'LoadStagingChain' }).catch(() => null);
      const unmatched = Actions.callChain(context, { chain: 'LoadUnmatchedValuesChain' }).catch(() => null);
      const [itemClasses, types] = await Promise.all([
        this.withTimeout(this.loadItemClasses(context), []),
        this.withTimeout(this.loadItemTypes(context), []),
      ]);
      $page.variables.itemClassOptionsArray = itemClasses;
      $page.variables.itemTypeOptionsArray = types;
      $page.variables.lovsLoading = false;
      await Promise.all([classes, staging, unmatched]);
    }

    withTimeout(promise, fallback) {
      return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve(fallback), LOV_TIMEOUT_MS))
      ]);
    }

    // Old EquipmentInitChain: every class, every subclass with its class id (eqrEquipmentClassId on the wire).
    async loadClasses(context) {
      const { $page } = context;
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
    }

    // Old OpenImportDialogChain.loadItemClasses: the VALUE is ItemClassCode (what EGP_SYSTEM_ITEMS_B stores), the
    // label ItemClass; only enabled classes that can hold items.
    async loadItemClasses(context) {
      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ItemClasses',
          uriParams: {
            q:        'EnabledFlag=true;ItemCreationAllowedFlag=true',
            fields:   'ItemClassId,ItemClass,ItemClassCode',
            onlyData: true,
            limit:    500,
            orderBy:  'ItemClass:asc',
          },
        });
        if (!resp || !resp.ok || !resp.body || !Array.isArray(resp.body.items)) {
          return [];
        }
        return resp.body.items
          .filter((r) => r && r.ItemClassCode)
          .map((r) => ({ value: r.ItemClassCode, label: r.ItemClass || r.ItemClassCode }));
      } catch (e) {
        return [];
      }
    }

    // Old OpenImportDialogChain.loadItemTypes: lookup type EGP_ITEM_TYPE.
    async loadItemTypes(context) {
      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05StandardLookupsLOV',
          uriParams: {
            q:        "LookupType='EGP_ITEM_TYPE'",
            fields:   'LookupCode,Meaning',
            onlyData: true,
            limit:    200,
          },
        });
        if (!resp || !resp.ok || !resp.body || !Array.isArray(resp.body.items)) {
          return [];
        }
        return resp.body.items
          .filter((r) => r && r.LookupCode)
          .map((r) => ({ value: r.LookupCode, label: r.Meaning || r.LookupCode }));
      } catch (e) {
        return [];
      }
    }
  }

  return importInitChain;
});
