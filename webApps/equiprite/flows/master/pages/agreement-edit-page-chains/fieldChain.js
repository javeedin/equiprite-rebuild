define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The header fields (formData keeps the old page's shape, so saveAgreementChain builds the same bodies), the
  // customer search (Fusion ShippingCustomersLOV, "Customer LIKE '*text*'", as the old pickers searched; the id
  // saved is its CustomerId as fusionCustomerId), Cancel, and a line's own rate / unit / description edits.
  const PAUSE_MS = 250;
  let typing = 0;

  class fieldChain extends ActionChain {
    async run(context, { action, field, value, index, from }) {
      const { $page } = context;
      const v = $page.variables;
      const set = (patch) => { v.formData = Object.assign({}, v.formData, patch); v.dirty = true; };
      switch (action) {
        case 'field':
          // The notes box reports the value the page gave it too (updatedFrom 'external'): only typing counts.
          if (from === 'external') return;
          if (['agreementName', 'agreementType', 'startDate', 'endDate', 'currencyCode', 'notes'].indexOf(field) !== -1) {
            set({ [field]: value == null ? '' : String(value) });
            if (v.missing && v.missing.length) v.missing = $page.functions.missingFields(v.formData);
          }
          return;
        case 'customerSearch': {
          v.customerQuery = String(value || '');
          const q = String(value || '').trim().replace(/'/g, "''");
          const mine = ++typing;
          if (q.length < 2) { v.customerResults = []; return; }
          await new Promise((r) => setTimeout(r, PAUSE_MS));
          if (mine !== typing) return;
          try {
            const res = await Actions.callRest(context, {
              endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ShippingCustomersLOV',
              uriParams: { q: "Customer LIKE '*" + q + "*'", limit: 25 },
            });
            if (mine !== typing) return;
            const items = res && res.ok && res.body && Array.isArray(res.body.items) ? res.body.items : [];
            v.customerResults = items.filter((r) => r && r.CustomerId != null)
              .map((r) => ({ id: r.CustomerId, label: r.Customer, sub: r.CustomerNumber || '' }));
          } catch (e) {
            v.customerResults = [];
          }
          return;
        }
        case 'customerPick': {
          const c = (v.customerResults || [])[Number(index)];
          if (c) set({ customerId: Number(c.id), customerName: c.label });
          v.customerResults = [];
          v.customerQuery = '';
          if (v.missing && v.missing.length) v.missing = $page.functions.missingFields(v.formData);
          return;
        }
        case 'customerClear':
          set({ customerId: null, customerName: '' });
          return;
        case 'lineField': {
          const lines = (v.equipmentLines || []).slice();
          const i = lines.findIndex((l) => String(l.lineNumber) === String(index));
          if (i < 0) return;
          const patch = {};
          if (field === 'unitPrice') {
            const n = Number(value);
            if (value === '' || isNaN(n) || n <= 0) { v.lineError = 'Rate must be greater than 0.'; v.equipmentLines = lines; return; }
            patch.unitPrice = n;
          } else if (field === 'priceUom' || field === 'description') {
            patch[field] = String(value || '');
          } else {
            return;
          }
          v.lineError = '';
          lines[i] = Object.assign({}, lines[i], patch);
          v.equipmentLines = lines;
          v.dirty = true;
          return;
        }
        case 'cancel': {
          const loaded = v.loadedHeader;
          v.dirty = false;
          if (loaded && loaded.agreementNumber) {
            await Actions.navigateToPage(context, { page: 'agreement-lines', params: { agreementNumber: loaded.agreementNumber } });
          } else {
            await Actions.navigateToPage(context, { page: 'agreements' });
          }
          return;
        }
        default:
      }
    }
  }

  return fieldChain;
});
