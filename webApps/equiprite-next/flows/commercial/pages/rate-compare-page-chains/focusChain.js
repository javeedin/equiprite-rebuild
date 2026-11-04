define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rateCompare',
  'resources/js/shellBus',
], (ActionChain, Actions, RC, bus) => {
  'use strict';

  // Rates handed over a schedule while this tab was open (shellBus.focus('rate-compare', { base })): it becomes the base,
  // with at least one other schedule beside it.
  class focusChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const handed = bus.takeFocus('rate-compare');
      if (!handed || !handed.base) return;
      const known = (v.schedules || []).map((s) => s.id);
      if (known.indexOf(String(handed.base)) === -1) {
        await Actions.callChain(context, { chain: 'loadChain', params: { refresh: false } });
        return;
      }
      let picked = RC.makeBase(JSON.parse(JSON.stringify(v.picked || [])).map(String), handed.base);
      if (picked.length < 2) {
        RC.defaultPick(JSON.parse(JSON.stringify(v.scheduleRows || [])), 3).forEach((id) => { if (picked.length < 3 && picked.indexOf(id) === -1) picked.push(id); });
      }
      v.picked = picked;
      await Actions.callChain(context, { chain: 'linesChain' });
    }
  }

  return focusChain;
});
