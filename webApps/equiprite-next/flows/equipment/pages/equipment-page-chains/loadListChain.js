define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The list: GET /equipment-master, every page, as New EquipRite's loadEquipmentChain reads it (page and size, the
  // server facet only when set, the same stop rules). The server caps a page without saying so, so a short page is not
  // the last one: stop on an empty page, hasMore false, or recordCount reached. The first page shows at once and the
  // rest together when the last is in (the summary counts them as they arrive). A newer read drops an older one.
  //
  // Next asks the server for the asset group only (items with an active asset in the group, which the rows do not
  // carry). Class, subclass, status, tracking and source are worked out on the rows, so their chips count; the words
  // typed are matched on the rows at once and sent as q by searchChain.
  const PAGE = 200;
  const MAX_PAGES = 100;
  let seq = 0;

  class loadListChain extends ActionChain {
    async run(context) {
      const mine = ++seq;
      await this.read(context, mine);
      if (mine === seq) await Actions.callChain(context, { chain: 'applyChain' });
    }

    async read(context, mine) {
      const v = context.$page.variables;
      const params = {};
      if (v.assetGroupId !== '' && v.assetGroupId != null) params.assetGroupId = Number(v.assetGroupId);

      v.isLoading = true;
      v.error = '';
      let rows = [];
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster',
            uriParams: Object.assign({ page: page, size: PAGE }, params),
          });
          if (mine !== seq) return;
          if (!res || !res.ok) {
            if (!page) {
              v.rows = [];
              v.loadedCount = 0;
              v.total = 0;
              v.error = 'The equipment list could not be loaded (HTTP ' + (res && res.status) + ').';
              return;
            }
            v.error = 'Only ' + rows.length + ' items could be loaded; the rest failed (HTTP ' + (res && res.status) + ').';
            break;
          }
          const body = res.body || {};
          const batch = Array.isArray(body.data) ? body.data : (Array.isArray(body) ? body : []);
          rows = rows.concat(batch);
          const total = Number(body.recordCount);
          v.total = !isNaN(total) && total > 0 ? total : rows.length;
          v.loadedCount = rows.length;
          if (!page) {
            v.rows = rows;
            await Actions.callChain(context, { chain: 'applyChain' });
          }
          if (!batch.length) break;
          if (body.hasMore === false) break;
          if (!isNaN(total) && total > 0 && rows.length >= total) break;
          if (body.hasMore === undefined && isNaN(total) && batch.length < PAGE) break;
        }
      } catch (e) {
        if (mine !== seq) return;
        console.error('[loadListChain] failed', e);
        v.error = 'The equipment list could not be loaded.';
      } finally {
        if (mine === seq) {
          if (rows.length && v.rows !== rows) v.rows = rows;
          v.isLoading = false;
          v.total = Math.max(Number(v.total) || 0, rows.length);
        }
      }
    }
  }

  return loadListChain;
});
