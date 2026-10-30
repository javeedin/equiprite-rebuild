define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/agreementRules',
], (ActionChain, Actions, A) => {
  'use strict';

  // The form's fields: New EquipRite's fieldChain, unchanged. The header fields (form keeps the old page's shape, so
  // saveChain builds the same bodies), the customer search (Fusion ShippingCustomersLOV, "Customer LIKE '*text*'"; the
  // id saved is its CustomerId as fusionCustomerId), and a line's own rate (above 0), unit and description.
  const PAUSE_MS = 250;
  let typing = 0;

  class fieldChain extends ActionChain {
    async run(context, { action, field, value, index }) {
      const { $page } = context;
      const v = $page.variables;
      const set = (patch) => { v.form = Object.assign({}, v.form, patch); v.dirty = true; };
      switch (action) {
        case 'field':
          if (['agreementName', 'agreementType', 'startDate', 'endDate', 'currencyCode', 'notes'].indexOf(field) !== -1) {
            set({ [field]: value == null ? '' : String(value) });
            if (v.missing && v.missing.length) v.missing = A.missingFields(v.form);
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
          if (v.missing && v.missing.length) v.missing = A.missingFields(v.form);
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
        default:
      }
    }
  }

  return fieldChain;
});
