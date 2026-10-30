define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The confirmation before the week-ending day is reset (New EquipRite's confirmChain, its resetWeek case): ask says
  // what will happen; OK runs resetWeekEndDayChain once; Cancel closes it.
  class confirmChain extends ActionChain {
    async run(context, { action, kind }) {
      const { $page } = context;
      if (action === 'cancel') {
        $page.variables.confirm = null;
        return;
      }
      if (action === 'ask') {
        if (kind === 'resetWeek' && !$page.variables.readOnly) {
          $page.variables.confirm = {
            kind: 'resetWeek', title: 'Reset the week-ending day', okLabel: 'Reset',
            message: 'Reset the week-ending day? This clears the saved day so it can be changed; until a new one is picked and saved, '
              + 'timesheet weeks have no fixed end.',
          };
        }
        return;
      }
      const c = $page.variables.confirm;
      if (action !== 'ok' || !c || c.busy || c.kind !== 'resetWeek') return;
      $page.variables.confirm = Object.assign({}, c, { busy: true });
      try {
        await Actions.callChain(context, { chain: 'resetWeekEndDayChain' });
      } finally {
        // resetWeekEndDayChain closes the card on every path; this only makes sure. (A value read from the variable
        // before the chain follows it to null, so nothing of it is read here.)
        $page.variables.confirm = null;
      }
    }
  }

  return confirmChain;
});
