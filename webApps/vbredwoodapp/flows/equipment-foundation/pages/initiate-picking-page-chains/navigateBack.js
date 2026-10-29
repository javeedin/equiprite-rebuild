/* Copyright (c) 2025, Oracle and/or its affiliates */

define([
  'vb/action/actionChain',
  'vb/action/actions',
], (
  ActionChain,
  Actions
) => {
  'use strict';

  class navigateBack extends ActionChain {

    /**
     * @param {Object} context
     */
    async run(context) {
      await Actions.navigateBack(context, {
      });
    }
  }

  return navigateBack;
});
