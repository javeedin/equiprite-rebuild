define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // UNREFERENCED — kept for reference only, NOT reachable.
  //
  // This was the bridge from the Transfer Order LOV's on-value-changed to the
  // page module's onTOSelectionChanged. The LOV was removed once the lines grid
  // began showing each line's TRANSFER ORDER NO. column, so nothing fires this
  // any more: its `onTOSelected` listener is gone from initiate-picking-page.json,
  // and an unregistered chain id 404s if called.
  //
  // The one caller that still needed the behaviour — openPickingDrawerChain,
  // ticking the opening order's lines — now calls
  // $page.functions.onTOSelectionChanged directly, which is what this only ever
  // did. Delete this file once that has shipped and proven out.
  //
  // Thin bridge only. The work is done by the page module
  // (onTOSelectionChanged), because the tick state lives there — in a plain Set
  // keyed by row index, not in page variables — and a chain cannot reach it
  // except through $page.functions.
  class SelectTOLinesChain extends ActionChain {
    async run(context, { toId }) {
      const { $page } = context;
      if (!$page.functions || typeof $page.functions.onTOSelectionChanged !== 'function') {
        return;
      }
      // Shaped like the component event the page function expects, so the same
      // function can be called from a listener or directly.
      $page.functions.onTOSelectionChanged({ detail: { value: toId } }, $page);
    }
  }

  return SelectTOLinesChain;
});
