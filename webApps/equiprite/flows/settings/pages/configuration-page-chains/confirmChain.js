define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // New EquipRite: the confirm card, which stands in for the old page's confirmation dialogs. The open… chains
  // (openDeleteBuOrgChain, openUnmapChain…) fill $page.variables.confirm with the old dialog's wording; OK runs the
  // chain the old dialog's button ran, with the same parameters. The week-ending-day reset is asked from here
  // because the old page opened that dialog straight from its button.
  const RUN = {
    resetWeek: (v) => ({ chain: 'resetWeekEndDayChain' }),
    deleteBuOrg: (v) => ({ chain: 'deleteBuOrgMappingRowChain', params: { rowKey: (v.DeleteBuOrgTarget || {}).rowKey } }),
    deleteSubclass: () => ({ chain: 'deleteSubclassChain' }),
    deleteClass: () => ({ chain: 'deleteClassChain' }),
    unmap: () => ({ chain: 'unmapChain' }),
    deleteExpType: (v) => ({ chain: 'deleteExpTypeMapChain', params: { id: (v.DeleteExpTypeMapTarget || {}).id } }),
    deleteAgreementType: (v) => ({ chain: 'deleteAgreementTypeChain', params: { id: (v.DeleteAgreementTypeTarget || {}).id } }),
    deleteAttCat: () => ({ chain: 'deleteAttachmentCategoryChain' }),
  };

  class confirmChain extends ActionChain {
    async run(context, { action, kind }) {
      const { $page } = context;
      if (action === 'cancel') {
        $page.variables.confirm = null;
        return;
      }
      if (action === 'ask') {
        if (kind === 'resetWeek') {
          $page.variables.confirm = {
            kind: 'resetWeek', section: 'costing', title: 'Reset the week-ending day', okLabel: 'Reset', danger: true,
            message: 'Reset the week-ending day? This clears the current value so it can be changed again; the '
              + 'week-ending day is unset until a new one is picked and saved.',
          };
        }
        return;
      }
      const c = $page.variables.confirm;
      if (action !== 'ok' || !c || c.busy || !RUN[c.kind]) return;
      $page.variables.confirm = Object.assign({}, c, { busy: true });
      try {
        await Actions.callChain(context, RUN[c.kind]($page.variables));
      } finally {
        // A chain that returned before closing it (nothing to delete) leaves the card: close it.
        const now = $page.variables.confirm;
        if (now && now.busy && now.kind === c.kind) {
          $page.variables.confirm = null;
        }
      }
    }
  }

  return confirmChain;
});
