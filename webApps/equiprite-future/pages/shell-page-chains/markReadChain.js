define(['vb/action/actionChain', 'resources/js/future/fxStore'], (ActionChain, store) => {
  'use strict';

  // Mark all read: every notification the persona played sees is read by them (the store keeps it per persona, so
  // the next person's bell is untouched). The bell follows through fxRefresh.
  class markReadChain extends ActionChain {
    async run() {
      store.act('markRead', {});
    }
  }

  return markReadChain;
});
