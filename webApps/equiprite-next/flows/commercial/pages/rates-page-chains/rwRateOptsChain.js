define([
  'vb/action/actionChain',
  'resources/js/commercialRedwood',
], (ActionChain, RW) => {
  'use strict';

  // The schedule's rates changed (read, edited, a row added or removed): the Smart Search filters over them (Redwood,
  // the schedule's record) offer what the rows now hold, with how many hold it. Lists that read the same are kept.
  const LISTS = { equipment: 'rwRtEquipment', cls: 'rwRtClasses', location: 'rwRtLocations', period: 'rwRtPeriods', subclass: 'rwRtSubclasses',
    rateType: 'rwRtTypes', method: 'rwRtMethods' };

  class rwRateOptsChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const opts = RW.rateLineOptions(JSON.parse(JSON.stringify(v.lines || [])));
      Object.keys(LISTS).forEach((f) => {
        if (JSON.stringify(v[LISTS[f]]) !== JSON.stringify(opts[f])) v[LISTS[f]] = opts[f];
      });
    }
  }

  return rwRateOptsChain;
});
