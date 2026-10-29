define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The list: GET /equipment-master with the parameters the old Smart Search sent through its request transform
  // (services/eqp-v1/transforms/equipmentMaster.js): q, equipmentClassId, equipmentSubclassId, assetGroupId, each
  // only when set, plus page and size.
  //
  // Every page is read, with fetchAllPages' stop rules (the server caps a page without saying so, so a short page
  // is not the last one: stop on an empty page, hasMore false, or recordCount reached). The first page shows at
  // once and the rest are shown together when the last one is in (the band counts them as they arrive), so the
  // chips count what the server matched, not one page of it. Showing each page as it came would replace the
  // grid's rows while oj-table is still drawing the previous set, which it aborts with a console error. A newer
  // search or filter drops the answers of an older one.
  const PAGE = 200;
  const MAX_PAGES = 100;
  let seq = 0;

  class loadEquipmentChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const mine = ++seq;
      const params = {};
      const q = String(v.searchText || '').trim();
      if (q) params.q = q;
      if (v.classId !== '' && v.classId != null) params.equipmentClassId = Number(v.classId);
      if (v.subclassId !== '' && v.subclassId != null) params.equipmentSubclassId = Number(v.subclassId);
      if (v.assetGroupId !== '' && v.assetGroupId != null) params.assetGroupId = Number(v.assetGroupId);

      v.isLoading = true;
      v.fetchError = '';
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
              v.allRows = [];
              v.loadedCount = 0;
              v.total = 0;
              v.fetchError = 'The equipment list could not be loaded (HTTP ' + (res && res.status) + ').';
              return;
            }
            v.fetchError = 'Only ' + rows.length + ' items could be loaded; the rest failed (HTTP ' + (res && res.status) + ').';
            break;
          }
          const body = res.body || {};
          const batch = Array.isArray(body.data) ? body.data : (Array.isArray(body) ? body : []);
          rows = rows.concat(batch);
          const total = Number(body.recordCount);
          v.total = !isNaN(total) && total > 0 ? total : rows.length;
          v.loadedCount = rows.length;
          if (!page) v.allRows = rows;
          if (!batch.length) break;
          if (body.hasMore === false) break;
          if (!isNaN(total) && total > 0 && rows.length >= total) break;
          if (body.hasMore === undefined && isNaN(total) && batch.length < PAGE) break;
        }
      } catch (e) {
        if (mine !== seq) return;
        console.error('[loadEquipmentChain] failed', e);
        v.fetchError = 'The equipment list could not be loaded.';
      } finally {
        if (mine === seq) {
          if (rows.length && v.allRows !== rows) v.allRows = rows;
          v.isLoading = false;
          v.total = Math.max(Number(v.total) || 0, rows.length);
        }
      }
    }
  }

  return loadEquipmentChain;
});
