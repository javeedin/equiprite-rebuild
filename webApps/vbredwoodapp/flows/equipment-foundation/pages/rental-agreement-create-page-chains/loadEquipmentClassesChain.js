define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
], (ActionChain, Actions, paging) => {
  'use strict';

  class loadEquipmentClassesChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // Every class, not the first page: getEquipmentClasses pages at 20 and
      // there are 21, so a single call dropped the 21st (2026-10-06).
      const result = { ok: true, body: { data: await paging.fetchAllPages(
        o => Actions.callRest(context, o), 'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses') } };

      console.log('[load-classes] result:', JSON.stringify({ ok: result && result.ok, status: result && result.status, len: result && result.body && result.body.data && result.body.data.length }));

      if (!result || !result.body || !result.body.data) {
        console.warn('[load-classes] no data returned');
        return;
      }

      $page.variables.equipmentClassesArray = result.body.data
        .filter(c => c != null)
        .map(c => ({
          value: c.id,
          label: c.className || c.classCode || String(c.id)
        }));
    }
  }

  return loadEquipmentClassesChain;
});
