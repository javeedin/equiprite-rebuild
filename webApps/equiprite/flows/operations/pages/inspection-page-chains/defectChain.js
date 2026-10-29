define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Log, edit or remove a defect. "Log a defect" on a failed question links the defect to it and starts the
  // description from the question and its note. A defect already saved by an earlier attempt is not edited or
  // removed here (there is no delete endpoint for defects).
  const FIELDS = { description: true, severity: true, action: true, cost: true };

  class defectChain extends ActionChain {
    async run(context, { action, key, field, value, item }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const list = (v.defects || []).slice();
      v.blocked = [];

      if (action === 'add') {
        const it = item ? (v.checklist || []).find((x) => x.id === String(item)) : null;
        const k = 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
        list.push(fns.newDefect(k, it, it ? (v.answers || {})[it.id] : null));
        v.defects = list;
        return;
      }

      const at = list.findIndex((d) => d.key === key);
      if (at === -1 || list[at].saved) {
        return;
      }
      if (action === 'remove') {
        const d = list[at];
        if (d.photo && d.photo.url && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          try { URL.revokeObjectURL(d.photo.url); } catch (e) { /* preview only */ }
        }
        fns.holdFile(key, null);
        list.splice(at, 1);
        v.defects = list;
        return;
      }
      if (action === 'set' && FIELDS[field]) {
        list[at] = Object.assign({}, list[at], { [field]: value == null ? '' : String(value) });
        v.defects = list;
      }
    }
  }

  return defectChain;
});
