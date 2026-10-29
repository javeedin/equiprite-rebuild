define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class valueChangedChain extends ActionChain {

    async run(context, { key, itemData }) {
      const { $fragment } = context;

      $fragment.variables.selectedKey = key !== undefined ? key : null;

      // Prefer the itemContext.data passed by oj-select-single; fall back to ADP lookup.
      let fullItem = null;
      if (key != null && itemData) {
        fullItem = itemData;
      } else if (key != null) {
        const data = ($fragment.variables.itemsAdp && $fragment.variables.itemsAdp.data) || [];
        fullItem = data.find((item) => String(item.id) === String(key)) || null;
      }
      $fragment.variables.selectedItem = fullItem;

      // Notify the host page of the selection via the declared valueChanged event.
      // Best-effort ONLY — wrapped so a fireEvent failure can never abort the chain
      // before the cascade toggle below (which is what makes a dependent LOV appear).
      // Fired before the cascade so a listener (e.g. clearing a dependent field) runs
      // before any child LOV remounts. Instances with no listener ignore it.
      try {
        await Actions.fireEvent(context, {
          event: 'valueChanged',
          payload: { key: (key !== undefined ? key : null), item: fullItem },
        });
      } catch (e) {
        console.warn('bipReportLov: valueChanged fireEvent failed (non-fatal):', e);
      }

      // Cascade: toggle a page variable to unmount/remount a dependent LOV fragment.
      // The parent page passes cascadeTargetVariable = 'showChildLov' (or similar).
      const targetVar = $fragment.variables.cascadeTargetVariable;
      if (targetVar) {
        const $page = context.$page;
        if ($page && $page.variables && targetVar in $page.variables) {
          $page.variables[targetVar] = false;
          if (key != null) {
            await new Promise(resolve => setTimeout(resolve, 0));
            $page.variables[targetVar] = true;
          }
        }
      }
    }
  }

  return valueChangedChain;
});
