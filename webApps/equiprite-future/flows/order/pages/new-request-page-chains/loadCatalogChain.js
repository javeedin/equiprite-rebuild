define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/catalogCart',
], (ActionChain, Actions, catalogCart) => {
  'use strict';

  // The catalog for the chosen dates: New EquipRite's loadCatalogChain, which is the old catalog's endpoint and
  // parameters (views/equipment-catalog with startDate, endDate and requestedQty=1 for availability; projectRefId
  // for the project's rate schedule; the delivery point for nearest-yard rates; agreementId for the agreement's
  // rates). Each parameter is sent only when known, as the old CatalogInitChain does, because an undefined value
  // goes out as the text "undefined". An answer for older choices than the latest is dropped.
  //
  // Then every cart line is priced again from the new rows with catalogCart.itemFromRow, keeping its quantity and
  // its own dates and notes, so the cart never shows a price the dates or project no longer give.
  let seq = 0;

  class loadCatalogChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const form = $page.variables.form || {};
      const params = { page: 0, size: 10000 };
      if (form.startDate && form.endDate && String(form.endDate) >= String(form.startDate)) {
        params.startDate = String(form.startDate).slice(0, 10);
        params.endDate = String(form.endDate).slice(0, 10);
        params.requestedQty = 1;
      }
      if (form.projectId != null && form.projectId !== '') {
        params.projectRefId = Number(form.projectId);
      }
      if (form.locationLatitude != null && form.locationLongitude != null) {
        params.latitude = Number(form.locationLatitude);
        params.longitude = Number(form.locationLongitude);
      }
      if ($page.variables.agreementId != null) {
        params.agreementId = Number($page.variables.agreementId);
      }

      const mine = ++seq;
      $page.variables.catalogLoading = true;
      $page.variables.catalogError = '';
      try {
        const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsEquipmentCatalog', uriParams: params });
        if (mine !== seq) {
          return;
        }
        if (!res || !res.ok) {
          $page.variables.catalogError = `The catalog could not be loaded (HTTP ${res && res.status}). Try the dates again in a moment.`;
          return;
        }
        const rows = (res.body && Array.isArray(res.body.data)) ? res.body.data : [];
        $page.variables.catalogRows = rows;
        this.reprice(context, rows, params);
      } catch (e) {
        console.error('[loadCatalogChain] failed', e);
        if (mine === seq) {
          $page.variables.catalogError = 'The catalog could not be loaded.';
        }
      } finally {
        if (mine === seq) {
          $page.variables.catalogLoading = false;
        }
      }
      if (mine === seq) {
        await Actions.callChain(context, { chain: 'applyCatalogChain' });
      }
    }

    reprice(context, rows, params) {
      const { $page } = context;
      const cart = $page.variables.cart || [];
      if (!cart.length) {
        return;
      }
      const byId = {};
      rows.forEach((r) => { if (r && r.eqrEquipmentMasterId != null) byId[Number(r.eqrEquipmentMasterId)] = r; });
      // Agreement requests: the catalog sends the negotiated rate as billRate when agreementId is passed.
      let agreementRateMap = null;
      if (params.agreementId != null) {
        agreementRateMap = {};
        Object.keys(byId).forEach((id) => {
          if (byId[id].billRate != null) agreementRateMap[id] = { billingRate: byId[id].billRate, billingUnit: byId[id].rateUom || 'DAY' };
        });
      }
      let changed = 0;
      const next = cart.map((it) => {
        const row = byId[Number(it.id)];
        if (!row) {
          return it;
        }
        const fresh = catalogCart.itemFromRow(row, it.quantity, agreementRateMap);
        ['startDate', 'endDate', 'notes', 'hours'].forEach((k) => { if (it[k] != null && it[k] !== '') fresh[k] = it[k]; });
        if (Number(fresh.billingRate) !== Number(it.billingRate) || fresh.billingUnit !== it.billingUnit) {
          changed += 1;
        }
        return fresh;
      });
      $page.variables.cart = next;
      if (changed) {
        const form = $page.variables.form || {};
        $page.variables.priceNote = changed + (changed === 1 ? ' price was' : ' prices were') + ' updated for '
          + (params.projectRefId != null && form.projectNumber ? 'project ' + form.projectNumber + ' and ' : '')
          + 'these dates.';
      }
    }
  }

  return loadCatalogChain;
});
