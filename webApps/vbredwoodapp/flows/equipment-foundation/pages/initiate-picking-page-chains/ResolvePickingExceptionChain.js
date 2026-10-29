define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class ResolvePickingExceptionChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      const buttonEl  = event.currentTarget;
      const lineId    = buttonEl.id.replace('resolve-btn-', '');
      const requestId = $page.variables.selectedRequest.id;

      if (!requestId || !lineId) return;

      // Read alternate serial from exceptionAltSerials map (keyed by lineId)
      const altSerials = $page.variables.exceptionAltSerials || {};
      const altSerial  = altSerials[lineId] || '';

      $page.variables.resolvingLineId = lineId;

      // Simulate API call
      await new Promise(r => setTimeout(r, 700));

      // Update the specific line — mark ALLOCATED, apply alt serial if provided
      const allArray = $page.variables.PickingQueueAllArray.map(r => {
        if (r.id !== requestId) return r;
        const updatedLines = (r.lines || []).map(l => {
          if (l.lineId !== lineId) return l;
          return {
            ...l,
            pickingStatus:   'ALLOCATED',
            altSerialNumber: altSerial || l.altSerialNumber,
            condition:       'GOOD',
            notes:           ''
          };
        });
        const remainingExceptions = (r.pickingExceptions || []).filter(e => e.lineId !== lineId);
        return {
          ...r,
          lines:             updatedLines,
          pickingExceptions: remainingExceptions
        };
      });

      $page.variables.PickingQueueAllArray = allArray;

      // Clear the alt serial input for this line
      const updatedAltSerials = Object.assign({}, altSerials);
      delete updatedAltSerials[lineId];
      $page.variables.exceptionAltSerials = updatedAltSerials;

      $page.variables.resolvingLineId = '';

      // Refresh drawer if open on this record
      if ($page.variables.isDrawerOpen && $page.variables.selectedRequest.id === requestId) {
        const updated = allArray.find(r => r.id === requestId);
        if (updated) $page.variables.selectedRequest = updated;
      }

      this._rebuildFilteredArray($page);
    }

    _rebuildFilteredArray($page) {
      $page.variables.PickingQueueFilteredArray = [...$page.variables.PickingQueueAllArray];
    }
  }

  return ResolvePickingExceptionChain;
});
