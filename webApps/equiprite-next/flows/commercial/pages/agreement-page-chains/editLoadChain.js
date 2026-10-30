define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/agreementRules',
], (ActionChain, Actions, A) => {
  'use strict';

  // Opens the form (Edit, or a new agreement): New EquipRite's agreementEditInitChain (the old rental-agreement-create
  // vbEnterChain), call for call: FULL access to EQR_RENTAL_AGREEMENTS first; the agreement types (GET
  // /conf-agreement-types?activeOnly=true); then, when editing, the header by id (kept whole for the PUT: its number,
  // status and objectVersionNumber), the customer's name from ShippingCustomersLOV, the raw lines (ids and values) and
  // the view lines (names), joined by line number and sorted (agreementRules.editLines).
  class editLoadChain extends ActionChain {
    async run(context, { headerId }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') !== 'FULL') {
        v.mode = 'view';
        v.note = 'Creating and editing agreements needs full access to Rental agreements.';
        v.noteTone = 'error';
        if (v.id === 'new') v.loadError = v.note;
        return;
      }

      v.mode = 'edit';
      v.editLoading = true;
      v.editError = '';
      v.missing = [];
      v.lineError = '';
      v.addLineOpen = false;
      v.dirty = false;
      v.customerQuery = '';
      v.customerResults = [];
      v.deletedLineIds = [];
      v.loadedHeader = null;
      v.form = A.emptyForm();
      v.equipmentLines = [];
      try {
        try {
          const types = await Actions.callRest(context, { endpoint: 'eqp-v1/getConfAgreementTypes', uriParams: { activeOnly: true } });
          const list = types && types.ok && Array.isArray(types.body) ? types.body
            : (types && types.ok && types.body && Array.isArray(types.body.data) ? types.body.data : []);
          v.typeOptions = list.filter((t) => t && t.typeCode)
            .map((t) => ({ value: t.typeCode, label: t.typeLabel || t.typeCode, prefix: t.typePrefix || '' }));
        } catch (e) {
          v.typeOptions = [];
        }

        const id = headerId ? Number(headerId) : null;
        if (!id) return;

        const headerResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getAgreementHeaderById',
          uriParams: { id: id }
        });
        const header = headerResp && headerResp.body;
        if (!header || !header.id) {
          v.editError = 'This agreement could not be loaded for editing.';
          return;
        }
        v.loadedHeader = header;
        v.form = A.formFromHeader(v.form, header);

        if (header.fusionCustomerId) {
          try {
            const custResp = await Actions.callRest(context, {
              endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ShippingCustomersLOV',
              uriParams: { q: 'CustomerId=' + header.fusionCustomerId, limit: 1 }
            });
            const custItem = custResp && custResp.ok && custResp.body && custResp.body.items && custResp.body.items[0];
            if (custItem) v.form = Object.assign({}, v.form, { customerName: custItem.Customer || null });
          } catch (e) {
            console.warn('[editLoadChain] could not resolve customer name', e);
          }
        }

        const linesResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getAgreementLines',
          uriParams: { agreementId: id }
        });
        const viewResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsRentalAgreementLines',
          uriParams: { agreementNumber: header.agreementNumber }
        });
        const rawLines  = (linesResp && linesResp.ok && linesResp.body && linesResp.body.data) ? linesResp.body.data : [];
        const viewLines = (viewResp  && viewResp.ok  && viewResp.body && viewResp.body.data)  ? viewResp.body.data  : [];
        v.equipmentLines = A.editLines(rawLines, viewLines);
      } finally {
        v.editLoading = false;
      }
    }
  }

  return editLoadChain;
});
