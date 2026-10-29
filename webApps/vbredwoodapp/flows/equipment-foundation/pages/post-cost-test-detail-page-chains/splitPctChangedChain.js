define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /*
   * Write one slice's edited percentage back into splitSlices.
   *
   * WHY THIS EXISTS rather than value="{{ slice.data.pct }}": two-way binding
   * into an element of an array rendered by oj-bind-for-each does not reliably
   * write back in VBCS. The id-carrying-listener idiom is the one this page has
   * already proven repeatedly (wk-, grpsel-, rev-, misc-, exptype-, splitrm-),
   * so the percentage field carries its index in id="splitpct-<i>" and this
   * chain does the write.
   *
   * The event is on-value-changed from oj-input-number, so the new value is on
   * event.detail.value and the element is the input itself.
   */
  class splitPctChangedChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('splitpct-') === 0)) { el = el.parentElement; }
      if (!el) return;

      const idx = parseInt(el.id.replace('splitpct-', ''), 10);
      if (isNaN(idx)) return;

      const slices = Array.isArray($page.variables.splitSlices)
        ? $page.variables.splitSlices
        : [];
      if (idx < 0 || idx >= slices.length) return;

      const raw = event && event.detail ? event.detail.value : null;
      const pct = (raw == null || raw === '') ? null : Number(raw);

      // Fires on every keystroke-committed change, including ones that do not
      // move the value (JET re-raises on blur). Skip those so the array is not
      // needlessly reassigned, which would re-render the whole list mid-typing.
      const current = slices[idx] ? slices[idx].pct : undefined;
      if (current === pct) return;

      // REASSIGN, with a fresh object for the touched row so nothing holds a
      // reference to the old one.
      $page.variables.splitSlices = slices.map(function (s, i) {
        return i === idx ? Object.assign({}, s, { pct: pct }) : s;
      });
      $page.variables.splitFormError = '';
    }
  }

  return splitPctChangedChain;
});
