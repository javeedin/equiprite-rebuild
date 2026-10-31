define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Dismiss the note of the last action that did not go through.
  class dismissChain extends ActionChain {
    async run(context) {
      context.$page.variables.failure = { text: '', what: '' };
    }
  }

  return dismissChain;
});
