define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The material-issue form. Picking a line loads its physical units (views/line-detail-units, the old
  // loadMaterialIssueLineChain), so the item number, unit of measure and organization are chosen, not typed: one unit
  // fills them in, several are offered as choices. Also the request search text and the tab.
  class issueChain extends ActionChain {
    async run(context, { action, field, value }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'requestText') {
        v.requestText = value == null ? '' : String(value);
        return;
      }
      if (action === 'tab') {
        v.tab = value === 'direct' ? 'direct' : 'inventory';
        return;
      }
      if (action === 'field') {
        if (!field) return;
        const issue = Object.assign({}, v.issue || {});
        issue[field] = field === 'quantity' ? (value === '' || value == null ? null : Number(value)) : (value == null ? '' : String(value));
        v.issue = issue;
        v.formError = '';
        return;
      }
      if (action === 'unit') {
        const u = (v.units || []).find((x) => x.value === value);
        if (!u) return;
        v.issue = Object.assign({}, v.issue, { itemNumber: u.value, uom: u.uomCode || v.issue.uom || 'EA' });
        return;
      }
      if (action !== 'line') return;
      const line = (v.lines || []).find((l) => String(l.lineId) === String(value));
      if (!line || !v.current) return;
      v.issue = { lineId: line.lineId, itemNumber: '', quantity: null, uom: 'EA', subinventory: '' };
      v.formError = '';
      v.units = [];
      v.unitsLoading = true;
      let rows = [];
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
          uriParams: { requestId: Number(v.current.id), lineId: Number(line.lineId), size: 10000 },
        });
        rows = res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : [];
      } catch (e) {
        console.warn('[issueChain] line-detail-units failed (the item can still be typed):', e && e.message);
      }
      if (!v.issue || v.issue.lineId !== line.lineId) return;
      const units = $page.functions.unitOptions(rows);
      v.units = units;
      v.unitsLoading = false;
      const first = units[0];
      if (first) {
        v.issue = Object.assign({}, v.issue, { itemNumber: first.value, uom: first.uomCode || 'EA' });
      }
    }
  }

  return issueChain;
});
