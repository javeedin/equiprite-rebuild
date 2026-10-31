define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A click anywhere outside the search box and its list closes the list (the words stay; focusing the box shows
  // their matches again).
  class searchCloseChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      if (pv.showResults) pv.showResults = false;
    }
  }

  return searchCloseChain;
});
