define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // An answer (a tapped button, a typed number or text) or a note on one question. A tapped answer that is fine
  // moves on to the next question, so a clean unit is a row of taps; a failed one stays put for its note and defect.
  class answerChain extends ActionChain {
    async run(context, { id, value, note, typed }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (!id) {
        return;
      }
      const item = (v.checklist || []).find((it) => it.id === String(id));
      if (!item) {
        return;
      }
      const answers = Object.assign({}, v.answers || {});
      const a = Object.assign({}, answers[item.id] || {});
      if (value !== undefined && value !== null) {
        a.value = String(value);
      }
      if (note !== undefined && note !== null) {
        a.note = String(note);
      }
      answers[item.id] = a;
      v.answers = answers;
      v.blocked = [];

      const tapped = !typed && value !== undefined && value !== null;
      const st = fns.answerState(item, a);
      if (tapped && (st === 'ok' || st === 'marginal')) {
        const at = (v.checklist || []).indexOf(item);
        v.step = Math.min((v.checklist || []).length, at + 1);
      }
    }
  }

  return answerChain;
});
