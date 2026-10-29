define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Admin escape hatch: WEEK_END_DAY locks once it has a saved value (see the
  // select's disabled expression on the Feature Flags tab) — it's meant to be a
  // one-time pick, not something that flips around every session. This clears
  // the stored value back to empty so the select re-enables when business
  // genuinely needs to change it, without anyone having to edit the DB by hand.
  class resetWeekEndDayChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const entry = ($page.variables.ConfigSettingsMap || {})['WEEK_END_DAY'];
      const dlg = document.getElementById('weekEndDayResetDialog');

      if (!entry || !entry.id) {
        if (dlg) dlg.close();
        return;
      }

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchConfGlobalSettingsById',
        uriParams: { id: entry.id },
        body: { settingValue: '' }
      });

      if (dlg) dlg.close();

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
