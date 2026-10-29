define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/resetWeekEndDayChain.js. Runs after the
  // confirmation (confirmChain, kind resetWeek). Same write: PATCH eqp-v1/patchConfGlobalSettingsById
  // { settingValue: '' } on the stored WEEK_END_DAY row, then reload. The old confirm dialog is the page's confirm
  // card here, closed where the old chain closed the dialog.
  //
  // Admin escape hatch: WEEK_END_DAY locks once it has a saved value — it's meant to be a one-time pick. This
  // clears the stored value back to empty so it can be picked again, without anyone editing the DB by hand.
  class resetWeekEndDayChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const entry = ($page.variables.StoredSettingsMap || $page.variables.ConfigSettingsMap || {})['WEEK_END_DAY'];

      if (!entry || !entry.id) {
        $page.variables.confirm = null;
        return;
      }

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchConfGlobalSettingsById',
        uriParams: { id: entry.id },
        body: { settingValue: '' }
      });

      $page.variables.confirm = null;

      if (result.ok) {
        $page.variables.WeekEndDaySel = '';
        await Actions.callChain(context, { chain: 'loadConfigSettingsChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Week End Day reset',
          message: 'The week-ending day has been cleared. Pick a new day to reconfigure it.',
          displayMode: 'transient',
          type: 'confirmation'
        });
      } else {
        console.error('resetWeekEndDayChain: failed', result.statusCode, result.body);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not reset',
          message: 'Failed to reset the week-ending day. Please try again.',
          displayMode: 'transient',
          type: 'error'
        });
      }
    }
  }

  return resetWeekEndDayChain;
});
