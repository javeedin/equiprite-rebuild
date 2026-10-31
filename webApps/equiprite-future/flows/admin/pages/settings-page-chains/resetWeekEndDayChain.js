define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // New EquipRite's resetWeekEndDayChain (from Old's), run after the confirmation: the same write, PATCH
  // eqp-v1/patchConfGlobalSettingsById { settingValue: '' } on the stored WEEK_END_DAY row, then reload. The
  // week-ending day locks once saved (a one-time pick); this clears it so it can be picked again.
  class resetWeekEndDayChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const entry = ($page.variables.StoredSettingsMap || $page.variables.ConfigSettingsMap || {})['WEEK_END_DAY'];

      if (!entry || !entry.id || $page.variables.readOnly) {
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
        bus.toast('The week-ending day is cleared. Pick a new day and save to set it again.', 'info');
      } else {
        console.error('resetWeekEndDayChain: failed', result.statusCode, result.body);
        bus.toast('The week-ending day could not be reset (HTTP ' + (result.status || '?') + '). Nothing changed; try again.', 'error');
      }
    }
  }

  return resetWeekEndDayChain;
});
