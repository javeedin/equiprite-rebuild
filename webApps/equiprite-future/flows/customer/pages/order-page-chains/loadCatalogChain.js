define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/catalogCart',
], (ActionChain, Actions, catalogCart) => {
  'use strict';

  // The catalog for the chosen dates: New's customer loadCatalogChain, the same parameters: views/equipment-catalog
  // (page 0, size 10000) with startDate, endDate and requestedQty=1 for availability, customerRefId (the customer's own
  // rates) and the delivery point for nearest-yard rates, each only when known. Then every cart line is priced again
  // from the new rows, and the list shown is worked out (applyCatalogChain).
  let seq = 0;

  class loadCatalogChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const form = v.form || {};
      const params = { page: 0, size: 10000 };
      if (form.startDate && form.endDate && String(form.endDate) >= String(form.startDate)) {
        params.startDate = String(form.startDate).slice(0, 10);
        params.endDate = String(form.endDate).slice(0, 10);
        params.requestedQty = 1;
      }
      if (form.customerRefId != null && form.customerRefId !== '') params.customerRefId = Number(form.customerRefId);
      if (form.locationLatitude != null && form.locationLongitude != null) {
        params.latitude = Number(form.locationLatitude);
        params.longitude = Number(form.locationLongitude);
      }
      if (v.agreementId != null) params.agreementId = Number(v.agreementId);

      const mine = ++seq;
      v.catalogLoading = true;
      v.catalogError = '';
      try {
        const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsEquipmentCatalog', uriParams: params });
        if (mine !== seq) return;
        if (!res || !res.ok) {
          v.catalogError = 'The catalog could not be loaded (HTTP ' + (res && res.status) + ').';
          return;
        }
        const rows = (res.body && Array.isArray(res.body.data)) ? res.body.data : [];
        v.catalogRows = rows;
        this.reprice(context, rows, params);
      } catch (e) {
        console.error('[customer loadCatalogChain] failed', e);
        if (mine === seq) v.catalogError = 'The catalog could not be loaded.';
      } finally {
        if (mine === seq) v.catalogLoading = false;
      }
      if (mine === seq) await Actions.callChain(context, { chain: 'applyCatalogChain' });
    }

    reprice(context, rows, params) {
      const v = context.$page.variables;
      const cart = v.cart || [];
      if (!cart.length) return;
      const byId = {};
      rows.forEach((r) => { if (r && r.eqrEquipmentMasterId != null) byId[Number(r.eqrEquipmentMasterId)] = r; });
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
        if (!row) return it;
        const fresh = catalogCart.itemFromRow(row, it.quantity, agreementRateMap);
        ['startDate', 'endDate', 'notes', 'hours'].forEach((k) => { if (it[k] != null && it[k] !== '') fresh[k] = it[k]; });
        if (Number(fresh.billingRate) !== Number(it.billingRate) || fresh.billingUnit !== it.billingUnit) changed += 1;
        return fresh;
      });
      v.cart = next;
      if (changed) {
        const form = v.form || {};
        v.priceNote = changed + (changed === 1 ? ' price was' : ' prices were') + ' updated for '
          + (params.customerRefId != null && form.customerName ? form.customerName + ' and ' : '') + 'these dates.';
      }
    }
  }

  return loadCatalogChain;
});
