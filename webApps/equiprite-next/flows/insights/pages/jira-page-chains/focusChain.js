define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/shellBus'], (ActionChain, Actions, bus) => {
  'use strict';

  // A story handed to this screen (Build.Rite's Jira updates bell: bus.focus('jira', { key })): its drawer opens once the
  // list is in. Not in the list shown (another search): shown alone (key = …), then opened.
  class focusChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const f = bus.takeFocus('jira');
      const key = f && f.key ? String(f.key) : '';
      if (!key) return;
      for (let i = 0; i < 100 && v.isLoading; i++) await new Promise((r) => setTimeout(r, 100));
      if (!(v.rows || []).some((r) => r.key === key)) {
        await Actions.callChain(context, { chain: 'loadChain', params: { jql: 'key = ' + key } });
      }
      if ((v.rows || []).some((r) => r.key === key)) await Actions.callChain(context, { chain: 'selectChain', params: { key: key } });
      else bus.toast(key + ' could not be read from Jira.', 'warning');
    }
  }
  return focusChain;
});
