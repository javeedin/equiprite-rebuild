define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // An answer (a tapped button, a typed number or text) or a note on one question, as New EquipRite's answerChain
  // keeps it. The whole checklist is on screen here, so there is no "next question" to move to: a failed or low
  // answer opens its note and "Log a defect" under the question itself.
  class answerChain extends ActionChain {
    async run(context, { id, value, note }) {
      const { $page } = context;
      const v = $page.variables;
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
    }
  }

  return answerChain;
});
