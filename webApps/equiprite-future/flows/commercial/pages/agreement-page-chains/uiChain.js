define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/agreementRules',
  'resources/js/shellBus',
], (ActionChain, Actions, A, bus) => {
  'use strict';

  // The tab's own actions, none of which writes (New EquipRite's linesUiChain, with Next's tab in place of pages):
  //   refresh     read the agreement again
  //   search      narrow the lines (the old FilterLinesChain's rule); the ticks stay
  //   more        show the next 200
  //   tick        one line, or 'all' the shown ones (only lines with an agreement line id can be requested)
  //   clear       untick everything
  //   exportMenu  open or close the export menu
  //   edit        the form, with the old navigateToEditChain's rule (ACTIVE, REJECTED, EXPIRED cannot be edited)
  //   cancelEdit  back to the agreement as saved (a new one's tab closes)
  //   list        the Agreements tab
  //   answer      the question card: OK runs the chain that asked
  class uiChain extends ActionChain {
    async run(context, { action, value, checked }) {
      const { $page } = context;
      const v = $page.variables;
      switch (action) {
        case 'refresh':
          v.note = '';
          await Actions.callChain(context, { chain: 'viewLoadChain' });
          return;
        case 'search':
          v.searchText = value == null ? '' : String(value);
          v.showLimit = A.SHOW_STEP;
          return;
        case 'more':
          v.showLimit = (Number(v.showLimit) || A.SHOW_STEP) + A.SHOW_STEP;
          return;
        case 'tick': {
          const on = checked === true || checked === 'true';
          v.selected = value === 'all'
            ? A.toggleShown(v.selected, v.linesArray, v.searchText, on, v.idMap)
            : A.toggle(v.selected, value, on, v.idMap);
          return;
        }
        case 'clear':
          v.selected = {};
          return;
        case 'exportMenu':
          v.exportOpen = !v.exportOpen;
          return;
        case 'edit': {
          const status = String(v.agreementStatus || '');
          if (!A.canEdit(status)) {
            v.note = 'This agreement is ' + A.statusLabel(status).toLowerCase() + ' and cannot be edited.';
            v.noteTone = 'error';
            return;
          }
          if (v.agreementHeaderId == null) return;
          v.note = '';
          await Actions.callChain(context, { chain: 'editLoadChain', params: { headerId: v.agreementHeaderId } });
          return;
        }
        case 'cancelEdit':
          if (v.saving) return;
          v.dirty = false;
          v.missing = [];
          v.lineError = '';
          v.addLineOpen = false;
          if (v.id === 'new' && !v.loadedHeader) {
            bus.close('agreement:new');
            return;
          }
          v.mode = 'view';
          await Actions.callChain(context, { chain: 'viewLoadChain' });
          return;
        case 'list':
          bus.open({ navId: 'agreements' });
          return;
        case 'answer':
          if (value === 'ok' && v.ask && v.ask.kind === 'reject') {
            await Actions.callChain(context, { chain: 'rejectChain', params: { confirmed: true } });
          } else {
            v.ask = null;
          }
          return;
        default:
      }
    }
  }

  return uiChain;
});
