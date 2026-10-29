/* Copyright (c) 2025, Oracle and/or its affiliates */

define([
  'vb/action/actionChain',
  'vb/action/actions',
], (
  ActionChain,
  Actions
) => {
  'use strict';

  class goToParent extends ActionChain {

    /**
     * go to parent
     * @param {Object} context
     */
    async run(context) {
      await Actions.navigateToPage(context, {
        page: '/',
      });
    }
  }

  return goToParent;
});
