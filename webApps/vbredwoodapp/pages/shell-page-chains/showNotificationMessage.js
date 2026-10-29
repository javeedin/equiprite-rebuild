/* Copyright (c) 2025, Oracle and/or its affiliates */

define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (
  ActionChain,
  Actions,
) => {
  'use strict';

  class showNotificationMessage extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {{summary:string,message:string,displayMode:string,type:string,key:string,target:string}} params.event
     */
    async run(context, { event }) {
      const { $page } = context;

      const severityMap = { info: 'info', warning: 'warning', error: 'error', confirmation: 'confirmation' };

      const msgId = $page.variables.messageId;
      $page.variables.messageId = msgId + 1;

      const msg = {
        _msgId:   msgId,
        severity: severityMap[event.type] || 'info',
        summary:  event.summary  || '',
        detail:   event.message  || ''
      };

      $page.variables.messagesArray = [...($page.variables.messagesArray || []), msg];

      // Auto-dismiss after 4 seconds
      setTimeout(() => {
        $page.variables.messagesArray = ($page.variables.messagesArray || [])
          .filter(m => m._msgId !== msgId);
      }, 4000);
    }
  }

  return showNotificationMessage;
});
