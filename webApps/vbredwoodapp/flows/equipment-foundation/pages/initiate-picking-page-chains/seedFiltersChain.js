/* Copyright (c) 2025, Oracle and/or its affiliates */

define([
  'vb/action/actionChain',
  'vb/action/actions',
], (
  ActionChain,
  Actions
) => {
  'use strict';

  class seedFiltersChain extends ActionChain {

    /**
     * @param {Object} context
     */
    async run(context) {
      const { $page} = context;

      await Actions.callComponentMethod(context, {
        selector: '#oj_sp_smart_search1',
        method: 'seedFiltersFromBookmarkableToken',
        params: [$page.variables.appliedFiltersStr],
      });
    }
  }

  return seedFiltersChain;
});