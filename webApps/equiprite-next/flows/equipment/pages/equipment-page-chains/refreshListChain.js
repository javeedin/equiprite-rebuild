define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Reads again what a Fetch, an Import, a Clear or a Sync changes (reads only): the list (loadListChain, unless
  // list is false), the latest Fetch and Sync from the job log, and how many fetched items wait for review. The two
  // side reads are New EquipRite's equipmentInitChain's (lastRuns, waiting), unchanged; neither can stop the page.
  class refreshListChain extends ActionChain {
    async run(context, params) {
      const list = !(params && params.list === false);
      await Promise.all([
        list ? Actions.callChain(context, { chain: 'loadListChain' }) : null,
        this.lastRuns(context),
        this.waiting(context),
      ]);
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

  return refreshListChain;
});
