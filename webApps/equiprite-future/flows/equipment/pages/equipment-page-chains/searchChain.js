define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
  'resources/js/equipmentMaster',
], (ActionChain, Actions, paging, em) => {
  'use strict';

  // The server's half of the search: GET /equipment-master?q=<text> (the old Smart Search's keyword; it also matches
  // serial numbers and unit locations, which the list rows do not carry), every page through fetchAllPages, with the
  // asset group when one is picked. What it finds joins what the rows matched (applyChain). Two characters or more;
  // the newest text wins; a failed read says so and the rows' own matches still show.
  let seq = 0;

  class searchChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      const q = em.serverQuery(v.text);
      const mine = ++seq;
      if (!q) {
        v.searching = false;
        if (v.server && v.server.q) v.server = { q: '', ids: {}, rows: [], failed: false };
        return;
      }
      if (v.server && v.server.q === q && !(params && params.again)) return;
      const extra = { q: q };
      if (v.assetGroupId !== '' && v.assetGroupId != null) extra.assetGroupId = Number(v.assetGroupId);

      v.searching = true;
      let failed = false;
      const call = async (o) => {
        try {
          const r = await Actions.callRest(context, o);
          if (!r || !r.ok) failed = true;
          return r;
        } catch (e) {
          failed = true;
          throw e;
        }
      };
      let rows = [];
      try {
        rows = await paging.fetchAllPages(call, 'eqp-v1/getEquipriteV1EquipmentMaster', extra, 'equipment search');
      } catch (e) {
        failed = true;
      }
      if (mine !== seq) return;
      const ids = {};
      rows.forEach((r) => { if (r && r.id != null) ids[String(r.id)] = true; });
      v.server = { q: q, ids: ids, rows: rows, failed: failed };
      v.searching = false;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return searchChain;
});
