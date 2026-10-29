define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
], (ActionChain, Actions, paging) => {
  'use strict';

  class openAddLineDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.isAddLineDrawerOpen = true;

      // Allow deferred drawer content to render before setting data
      await new Promise(resolve => setTimeout(resolve, 50));

      // Every class, not the first page: getEquipmentClasses pages at 20 and
      // there are 21, so a single call dropped the 21st (2026-10-06).
      const classesResp = { ok: true, body: { data: await paging.fetchAllPages(
        o => Actions.callRest(context, o), 'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses') } };

      if (classesResp.ok) {
        $page.variables.equipmentClassesArray = [];
        await new Promise(resolve => setTimeout(resolve, 0));
        $page.variables.equipmentClassesArray = (classesResp.body.data || []).map(item => ({
          value: item.id,
          label: item.className,
        }));
      } else {
        $page.variables.equipmentClassesArray = [];
      }

      $page.variables.equipmentSubclassesArray = [];
      $page.variables.equipmentNamesArray = [];
    }
  }

  return openAddLineDrawerChain;
});
