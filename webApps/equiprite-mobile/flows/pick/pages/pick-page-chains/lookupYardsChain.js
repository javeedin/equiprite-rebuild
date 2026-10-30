define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/yardLoad',
  'resources/js/yardWork',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
], (ActionChain, Actions, yardLoad, yw, mp, snapshot, cu) => {
  'use strict';

  // The yard each piece still in the yard ships from (Next's lookupYardsChain, the same calls): views/line-detail-units
  // per line, a few at a time, urgent sections first (the yard rule is New's, yardWork.yardOfUnits). The list fills in
  // batch by batch. Reads only. Mobile's own: the unit numbers in those same answers are kept on the way past (a unit
  // scanned on the list finds its request), and the list is saved on the phone once the yards are in.
  class lookupYardsChain extends ActionChain {
    async run(context, { token }) {
      const { $application } = context;
      const v = context.$page.variables;
      const lookups = yw.yardLookups(v.items, v.yards);
      if (!lookups.length || v.loadToken !== token) return;
      const stale = () => v.loadToken !== token;
      const found = {};
      const seeing = {
        callRest: (ctx, o) => Actions.callRest(ctx, o).then((res) => {
          if (res && res.ok && o && o.uriParams && o.uriParams.lineId != null) found[String(o.uriParams.lineId)] = mp.unitNumbers((res.body && res.body.data) || []);
          return res;
        }),
      };
      v.yardsLoading = true;
      try {
        await yardLoad.yards(context, seeing, lookups, async (batch) => {
          if (stale()) return;
          v.units = Object.assign({}, v.units, found);
          v.yards = Object.assign({}, v.yards, batch);
          await Actions.callChain(context, { chain: 'applyChain' });
        }, stale);
      } finally {
        if (!stale()) {
          v.yardsLoading = false;
          v.units = Object.assign({}, v.units, found);
          await Actions.callChain(context, { chain: 'applyChain' });
          const user = cu.auditActor(context) || ($application.user || {}).username || '';
          mp.keep(snapshot, user, (k, at) => mp.withList(k, v.records, v.linesBy, v.yards, v.units, at));
        }
      }
    }
  }

  return lookupYardsChain;
});
