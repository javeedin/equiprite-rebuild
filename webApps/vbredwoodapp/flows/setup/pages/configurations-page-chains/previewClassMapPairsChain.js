define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // Create from Fusion list for one source's saved column mapping: every
  // distinct (class value, subclass value) pair Fusion carries on the SAME item /
  // asset (EQP_CATEGORY_LOV_RP, PAIRS mode). The pair is what associates a
  // subclass with its class. What happens to each pair is decided by the
  // backend (bulkCreateClassesFromFusion, dryRun -- nothing written), the same
  // logic Create New Classes then runs for real:
  //   EXISTS    already created from this source + column + value
  //   LINK      a hand-made class / subclass of the same name or code is adopted
  //   CONFLICT  that name / code carries a DIFFERENT Fusion reference; skipped
  //   CREATE    new
  // subAction is NONE for a pair without a subclass. Results come back in
  // request order. pairStatusLabel / pairActionable read them.
  // params.source: the classification source.
  class previewClassMapPairsChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const source = params && params.source;
      // The dialog's SOURCE picker echoes ClassMapPairsSource back as a value
      // change; that load is already running.
      if ($page.variables.isClassMapPairsLoading && $page.variables.ClassMapPairsSource === source) return;
      const m = $page.functions.columnMappingFor($page.variables.ConfigSettingsMap, source);
      if (!m) return;

      $page.variables.isClassMapPairsLoading = true;
      $page.variables.ClassMapPairsSource = source;
      $page.variables.ClassMapPairsArray = [];
      try {
        const response = await Actions.callRest(context, {
          endpoint: 'bipService/runBIPReport',
          body: bipLov.buildSoapBody('/Custom/EquipRite/EQP_CATEGORY_LOV_RP.xdo', [
            { name: 'P_TRACKING_TYPE', value: source },
            { name: 'P_CATEGORY_TYPE', value: m.classColumn },
            // No subclass column: ask for the class column's own values, as
            // pairs with an empty subclass.
            { name: 'P_PARENT_TYPE',   value: m.subclassColumn || 'NONE' },
            { name: 'P_PARENT_ID',     value: m.subclassColumn ? '#PAIRS' : '' }
          ])
        });
        const rows = bipLov.decodeReportRows(
          response && response.body, 'G_1', 'LOV_ID', 'LOV_NAME', 'LOV_CODE');

        const pairs = rows.map((r, i) => ({
          key: i,
          classRef: String(r.id),
          className: r.label || String(r.id),
          classCode: r.label2 || '',
          subclassRef: r.SUB_ID || '',
          subclassName: r.SUB_NAME || r.SUB_ID || '',
          itemCount: Number(r.ITEM_COUNT || 0)
        }));
        if (!pairs.length) return;

        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/bulkCreateClassesFromFusion',
          body: $page.functions.bulkFusionRequest(source, m, pairs, true)
        });
        if (!res.ok) {
          throw new Error((res.body && res.body.detail) || ('status ' + res.statusCode));
        }
        const results = (res.body && res.body.results) || [];
        $page.variables.ClassMapPairsArray = pairs.map((p, i) => {
          const r = results[i] || {};
          return {
            ...p,
            classAction: r.classAction || '',
            subAction: r.subAction || 'NONE',
            message: r.message || ''
          };
        });
      } catch (e) {
        console.error('previewClassMapPairsChain failed', e);
        await Actions.fireNotificationEvent(context, {
          summary: 'Preview not loaded',
          message: (e && e.message) || 'The class / subclass values could not be read from Fusion.',
          displayMode: 'transient', type: 'error'
        });
      } finally {
        $page.variables.isClassMapPairsLoading = false;
      }
    }
  }

  return previewClassMapPairsChain;
});
