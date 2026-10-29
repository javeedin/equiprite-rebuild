define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The lines page's own actions, none of which writes:
  //   search   narrow the lines (the old FilterLinesChain's rule, filterLines); the ticks stay
  //   more     show the next 200
  //   tick     one line, or 'all' the shown ones (only lines with an agreement line id can be requested)
  //   clear    untick everything
  //   edit     the editor, with the old navigateToEditChain's rule (ACTIVE, REJECTED, EXPIRED cannot be edited)
  //   back     the list
  //   answer   the question card: OK runs the chain that asked
  class linesUiChain extends ActionChain {
    async run(context, { action, value, checked }) {
      const { $page } = context;
      const v = $page.variables;
      const f = $page.functions;
      switch (action) {
        case 'search':
          v.searchText = value == null ? '' : String(value);
          v.showLimit = f.showStep();
          return;
        case 'more':
          v.showLimit = (Number(v.showLimit) || f.showStep()) + f.showStep();
          return;
        case 'tick': {
          const on = checked === true || checked === 'true';
          v.selected = value === 'all'
            ? f.toggleShown(v.selected, v.linesArray, v.searchText, on, v.agreementLineIdByCompositeKey)
            : f.toggle(v.selected, value, on, v.agreementLineIdByCompositeKey);
          return;
        }
        case 'clear':
          v.selected = {};
          return;
        case 'edit': {
          const status = String(v.agreementStatus || '');
          if (!f.canEdit(status)) {
            await Actions.fireNotificationEvent(context, {
              summary: 'Cannot Edit',
              message: 'This agreement is ' + status.charAt(0) + status.slice(1).toLowerCase() + ' and cannot be edited.',
              displayMode: 'transient',
              type: 'error'
            });
            return;
          }
          if (v.agreementHeaderId == null) return;
          await Actions.navigateToPage(context, { page: 'agreement-edit', params: { agreementId: String(v.agreementHeaderId) } });
          return;
        }
        case 'back':
          await Actions.navigateToPage(context, { page: 'agreements' });
          return;
        case 'answer':
          if (value === 'ok' && v.ask && v.ask.kind === 'reject') {
            await Actions.callChain(context, { chain: 'rejectAgreementChain', params: { confirmed: true } });
          } else {
            v.ask = null;
          }
          return;
        default:
      }
    }
  }

  return linesUiChain;
});
