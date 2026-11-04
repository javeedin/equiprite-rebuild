define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rateRules',
  'resources/js/rateCompare',
], (ActionChain, Actions, R, RC) => {
  'use strict';

  // Reads the rates of each picked schedule not read yet (GET /rate-period-lines?rateScheduleId=, kept only for that
  // schedule and mapped as Rates maps them: rateRules.lineFromRecord), then compares what is picked (rateCompare.compare).
  class linesChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const have = JSON.parse(JSON.stringify(v.linesBy || {}));
      const missing = (v.picked || []).map(String).filter((id) => !have[id]);
      if (missing.length) {
        v.linesLoading = true;
        const failed = [];
        await Promise.all(missing.map(async (id) => {
          let res;
          try {
            res = await Actions.callRest(context, { endpoint: 'eqp-v1/getRatePeriodLines', uriParams: { rateScheduleId: Number(id) } });
          } catch (e) {
            res = null;
          }
          if (!res || !res.ok) { failed.push(id); return; }
          const raw = (res.body && res.body.data) || [];
          have[id] = R.sortLines(raw.filter((l) => String(l.rateScheduleId) === id).map(R.lineFromRecord));
        }));
        v.linesBy = have;
        v.linesLoading = false;
        const names = failed.map((id) => ((v.schedules || []).filter((s) => s.id === id)[0] || {}).name || id);
        v.error = names.length ? 'The rates of ' + names.join(', ') + ' could not be loaded. Refresh to try again.' : '';
      }
      const byId = {};
      (v.schedules || []).forEach((s) => { byId[s.id] = s; });
      const list = (v.picked || []).map(String).filter((id) => have[id]).map((id) => ({
        id, name: (byId[id] || {}).name || id, currency: (byId[id] || {}).currency || 'USD', lines: have[id],
      }));
      v.view = RC.compare(list, JSON.parse(JSON.stringify(v.opts || {})));
    }
  }

  return linesChain;
});
