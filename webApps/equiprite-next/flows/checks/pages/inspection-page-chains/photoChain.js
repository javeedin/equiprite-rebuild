define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The photo of one defect, taken with the tablet camera (input capture) or picked from the library: New EquipRite's
  // photoChain. The File is held by the page module until the save uploads it; the page keeps its name, size and a
  // preview URL. Type and size are checked on pick, not after.
  class photoChain extends ActionChain {
    async run(context, { key, file, clear }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const list = (v.defects || []).slice();
      const at = list.findIndex((d) => d.key === key);
      if (at === -1 || list[at].saved) {
        return;
      }
      const old = list[at].photo;
      if (old && old.url && typeof URL !== 'undefined' && URL.revokeObjectURL) {
        try { URL.revokeObjectURL(old.url); } catch (e) { /* preview only */ }
      }
      v.photoError = '';
      if (clear) {
        fns.holdFile(key, null);
        list[at] = Object.assign({}, list[at], { photo: null });
        v.defects = list;
        return;
      }
      const problem = fns.photoProblem(file);
      if (problem) {
        v.photoError = problem;
        return;
      }
      fns.holdFile(key, file);
      let url = '';
      try {
        url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : '';
      } catch (e) {
        url = '';
      }
      list[at] = Object.assign({}, list[at], { photo: { name: file.name || 'photo', size: file.size || 0, url } });
      v.defects = list;
      v.blocked = [];
    }
  }

  return photoChain;
});
