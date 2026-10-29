/* Copyright (c) 2025, Oracle and/or its affiliates */

define([
  'vb/action/actionChain',
  'vb/action/actions',
], (
  ActionChain,
  Actions
) => {
  'use strict';

  class updateBookmarkableTokenChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.token 
     */
    async run(context, { token }) {
      const { $application} = context;

      await Actions.navigateToPage(context, {
        page: $application.currentPage.id,
        history: 'push',
        params: {
          appliedFiltersStr: token
        },
      });
    }
  }

  return updateBookmarkableTokenChain;
});
