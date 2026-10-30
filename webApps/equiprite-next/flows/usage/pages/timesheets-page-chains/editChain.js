define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // New EquipRite's Time entry editChain, unchanged but for the two Next additions marked below (the request list's
  // chip and the export menu).
  //
  // One edit in the grid: an hours box, a row's rate type or expenditure type, a Submit tick, or Undo. The typed
  // value goes into `edits` (a new object each time, so totals rebind); the rows themselves are never replaced
  // here, so the box being typed in keeps its focus. Expenditure type is per request LINE, so it is written for
  // every row of that line (old handleEditEnd).
  class editChain extends ActionChain {
    async run(context, { action, key, day, value }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'queueText') {
        v.queueText = value == null ? '' : String(value);
        return;
      }
      // Next: the request list's chip, and the export menu.
      if (action === 'queueKind') {
        v.queueKind = value ? String(value) : 'all';
        return;
      }
      if (action === 'exportOpen') {
        v.exportOpen = !v.exportOpen;
        return;
      }
      // Undo and Tick-all change boxes the user may have touched. A typed box no longer follows its value binding
      // (JET binds a native input's value as the attribute), so these two hand the grid fresh row objects, which
      // redraws the rows from the new state. Ordinary typing never does this, so it never loses focus.
      if (action === 'undo') {
        v.edits = {};
        v.saveError = '';
        v.rows = $page.functions.freshRows(v.rows);
        return;
      }
      if (action === 'pickAll') {
        const on = value === true || value === 'true';
        const picked = {};
        (v.rows || []).forEach((r) => { if (on && $page.functions.isEditable(r, false)) picked[r.key] = true; });
        v.picked = picked;
        v.rows = $page.functions.freshRows(v.rows);
        return;
      }
      const row = (v.rows || []).find((r) => r.key === key);
      if (!row) return;
      if (action === 'pick') {
        const picked = Object.assign({}, v.picked || {});
        if (value === true || value === 'true') picked[key] = true; else delete picked[key];
        v.picked = picked;
        return;
      }
      if (!$page.functions.isEditable(row, v.readOnly)) return;
      const edits = Object.assign({}, v.edits || {});
      const text = value == null ? '' : String(value).trim();
      if (action === 'hours') {
        const i = Number(day);
        if (!(i >= 0 && i <= 6)) return;
        edits[key + '|d' + i] = text;
      } else if (action === 'type') {
        edits[key + '|type'] = text;
      } else if (action === 'exp') {
        (v.rows || []).forEach((r) => {
          if (r.key === key || (row.lineId && Number(r.lineId) === Number(row.lineId))) edits[r.key + '|exp'] = text;
        });
      } else {
        return;
      }
      v.edits = edits;
      if (v.saveError) v.saveError = '';
    }
  }

  return editChain;
});
