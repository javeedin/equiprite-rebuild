define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/equipmentAttachments',
], (ActionChain, Actions, ea) => {
  'use strict';

  // Loads, for this page's Attachments dialog:
  //   * the categories allowed at this level (HEADER or LINE, plus BOTH)
  //   * the ACTIVE attachments of this master / serial
  //   * on a serial page, the master's attachments too (shown read-only)
  //
  // Runs on page entry (the button shows a count) and after every upload or
  // removal. Same file on equipment-units-page and equipment-unit-detail-page;
  // the page's attLevel variable decides which record (equipmentAttachments.target).
  //
  // No id, no call: eqpt answers 400 on a half filter (verified 2026-10-01), so
  // a missing URL param would only produce an error banner.
  class loadAttachmentsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const t = ea.target($page);

      $page.variables.attLoading = true;
      $page.variables.attLoadError = '';
      try {
        const catResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/listAttachmentCategories',
          // Query params MUST be uriParams - `parameters` is silently dropped.
          uriParams: { activeOnly: true, level: t.level }
        });
        const cats = catResp.ok ? ea.listBody(catResp).map(ea.toCategoryOption) : [];
        $page.variables.attCategoryOptions = cats;
        $page.variables.attCategoryFilterOptions = [{ value: 'ALL', label: 'All categories' }]
          .concat(cats.map(c => ({ value: String(c.value), label: c.label })));

        if (!t.entityId) {
          $page.variables.attRows = [];
          $page.variables.attInheritedRows = [];
          return;
        }

        const calls = [Actions.callRest(context, {
          endpoint: 'eqp-v1/listEquipmentAttachments',
          uriParams: { entityName: t.entityName, entityId: t.entityId }
        })];
        if (t.inheritMasterId) {
          calls.push(Actions.callRest(context, {
            endpoint: 'eqp-v1/listEquipmentAttachments',
            uriParams: { entityName: ea.ENTITY.HEADER, entityId: t.inheritMasterId }
          }));
        }
        const [own, inherited] = await Promise.all(calls);

        if (!own.ok) throw new Error(ea.errorText(own, 'Could not load attachments'));
        $page.variables.attRows = ea.listBody(own).map(ea.toRow);
        // The master's list failing must not hide the unit's own documents.
        $page.variables.attInheritedRows = (inherited && inherited.ok) ? ea.listBody(inherited).map(ea.toRow) : [];
        if (inherited && !inherited.ok) console.warn('[loadAttachmentsChain] master attachments', inherited.status);
      } catch (e) {
        console.error('[loadAttachmentsChain]', e);
        $page.variables.attLoadError = (e && e.message) ? e.message : 'Could not load attachments.';
      } finally {
        $page.variables.attLoading = false;
      }
    }
  }

  return loadAttachmentsChain;
});
