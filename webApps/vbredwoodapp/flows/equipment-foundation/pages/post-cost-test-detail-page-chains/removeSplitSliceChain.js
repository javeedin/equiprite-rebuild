define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /*
   * Remove one slice from the in-progress split.
   *
   * The control carries its index in id="splitrm-<i>". Walk up from event.target
   * because the click can land on the icon glyph rather than the span owning the
   * id -- the same reason openSplitDrawerChain walks up.
   *
   * Index, not a slice id: a slice has no id until the server assigns one, and
   * the whole point of the PUT being a whole-set replace is that the client never
   * has to reconcile ids.
   */
  class removeSplitSliceChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('splitrm-') === 0)) { el = el.parentElement; }
      if (!el) return;

      const idx = parseInt(el.id.replace('splitrm-', ''), 10);
      if (isNaN(idx)) return;

      const slices = Array.isArray($page.variables.splitSlices)
        ? $page.variables.splitSlices
        : [];
      if (idx < 0 || idx >= slices.length) return;

      // REASSIGN -- filter returns a new array, which is what VBCS needs to see.
      $page.variables.splitSlices = slices.filter(function (s, i) { return i !== idx; });
      // The banner is recomputed from the new list by splitFormError on render;
      // clearing it here stops a stale "must add up to 100%" sitting above a list
      // the user is still editing.
      $page.variables.splitFormError = '';
    }
  }

  return removeSplitSliceChain;
});
