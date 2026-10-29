define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Class picked in the Change Class dialog: narrow the subclass list to that
   * class, and drop a subclass that belongs to another class -- saving it
   * would attach a subclass of the wrong class.
   *
   * User changes only (updatedFrom 'internal'). value-changed also fires when
   * openChangeClassChain sets the draft, before the subclass list has loaded;
   * reacting to that would clear the item's current subclass.
   */
  class classDraftChangedChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const v = $page.variables;
      const detail = params && params.event && params.event.detail;
      if (!detail || detail.updatedFrom !== 'internal') return;
      v.classChangeError = '';
      v.subclassOptions = $page.functions.subclassOptionsFor(v.allSubclassOptions, v.classDraft.classId);
      const keep = v.subclassOptions.some(o => o.value === v.classDraft.subclassId);
      if (!keep && v.classDraft.subclassId != null) {
        v.classDraft = { classId: v.classDraft.classId, subclassId: null };
      }
    }
  }

  return classDraftChangedChain;
});
