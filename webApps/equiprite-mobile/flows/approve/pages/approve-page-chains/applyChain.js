define([
  'vb/action/actionChain',
  'resources/js/approvalQueue',
  'resources/js/mobileApprove',
  'resources/js/rules',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
  'resources/js/mobileBus',
], (ActionChain, queue, ma, rules, snapshot, cu, bus) => {
  'use strict';

  // The queue from the requests as last read (rebuild: Next's applyChain, approvalQueue.build with quoting and the
  // requests settled), as cards; then the chip and the search. The open request keeps its card, refreshed. A queue
  // built from what was just read is kept on the phone for when there is no connection (offlineSnapshot), and sets
  // the tab's count (mobileBus.badge).
  class applyChain extends ActionChain {
    async run(context, { chip, text, rebuild }) {
      const { $page, $application } = context;
      const pv = $page.variables;
      const app = $application.variables;
      const data = $page.functions.data();
      if (rebuild && data) {
        const now = Date.now();
        const items = queue.build(data.rows, data.linesByRequest, {
          now,
          quoting: (source) => rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, source),
          settled: pv.settled,
        });
        pv.all = ma.cards(items, data.linesByRequest, data.rows, now);
        const user = cu.auditActor(context) || ($application.user || {}).username || '';
        snapshot.save('approve', user, ma.keep(pv.all), now);
        bus.badge('approve', ma.badge(pv.all));
      }
      const all = (pv.all || []).map((c) => Object.assign({}, c));
      if (chip != null && chip !== '') pv.chip = String(chip);
      if (text != null) pv.text = String(text);
      // Opening, or a chip emptied by the last decision (read again): the chip that holds what waits.
      const counts = ma.chips(all);
      const on = counts.filter((c) => c.key === pv.chip)[0];
      if (!pv.chip || (rebuild && (chip == null || chip === '') && all.length && (!on || !on.count))) pv.chip = ma.firstChip(all);
      pv.chips = counts;
      pv.summary = ma.summary(all);
      pv.shown = ma.filter(all, pv.chip, pv.text);
      if (pv.current && pv.current.key && pv.view === 'detail') {
        const key = pv.current.key;
        const again = all.filter((c) => c.key === key)[0];
        if (again) pv.current = again;
        pv.position = ma.position(pv.shown, key);
      }
    }
  }

  return applyChain;
});
