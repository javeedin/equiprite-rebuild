define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // A pick in the Change class panel (class and subclass chips), and closing the panel.
  //
  // A class pick runs the old classDraftChangedChain's rule (user changes only, which a chip click always is):
  // the subclass list follows the class, and a subclass that belongs to another class is dropped -- saving it
  // would attach a subclass of the wrong class.
  class classPickChain extends ActionChain {
    async run(context, { kind, value }) {
      const { $page } = context;
      const v = $page.variables;
      if (kind === 'close') {
        v.classPanelOpen = false;
        v.classChangeError = '';
        return;
      }
      if (v.classChangeSaving) return;
      const id = value === '' || value == null ? null : Number(value);
      v.classChangeError = '';
      if (kind === 'subclass') {
        v.classDraft = { classId: v.classDraft.classId, subclassId: id };
        return;
      }
      if (kind !== 'class') return;
      v.classDraft = { classId: id, subclassId: v.classDraft.subclassId };
      // ── old classDraftChangedChain ──
      v.subclassOptions = $page.functions.subclassOptionsFor(v.allSubclassOptions, v.classDraft.classId);
      const keep = v.subclassOptions.some(o => o.value === v.classDraft.subclassId);
      if (!keep && v.classDraft.subclassId != null) {
        v.classDraft = { classId: v.classDraft.classId, subclassId: null };
      }
    }
  }

  return classPickChain;
});
