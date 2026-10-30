define([
  'vb/action/actionChain',
  'resources/js/approvalQueue',
  'resources/js/mobileApprove',
  'resources/js/rules',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
  'resources/js/mobileBus',
  'resources/js/mobileRecent',
], (ActionChain, queue, ma, rules, snapshot, cu, bus, recent) => {
  'use strict';

  // The queue from the requests as last read (rebuild: Next's applyChain, approvalQueue.build with quoting and the
  // requests settled), as cards; then the period (the last few days, or every date: mobileRecent), the chip and the
  // search (which looks through every date). The chips' counts and the line under the title follow the period; under
  // the list, how many older requests it leaves out under the chip. The open request keeps its card, refreshed. A queue
  // built from what was just read is kept on the phone for when there is no connection (offlineSnapshot, every date),
  // and sets the tab's count (mobileBus.badge: what the queue opens on, the last few days).
  class applyChain extends ActionChain {
    async run(context, { chip, text, rebuild, period }) {
      const { $page, $application } = context;
      const pv = $page.variables;
      const app = $application.variables;
      const data = $page.functions.data();
      const now = Date.now();
      if (rebuild && data) {
        const items = queue.build(data.rows, data.linesByRequest, {
          now,
          quoting: (source) => rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, source),
          settled: pv.settled,
        });
        pv.all = ma.cards(items, data.linesByRequest, data.rows, now);
        const user = cu.auditActor(context) || ($application.user || {}).username || '';
        snapshot.save('approve', user, ma.keep(pv.all), now);
        bus.badge('approve', ma.badge(pv.all, now));
      }
      const all = (pv.all || []).map((c) => Object.assign({}, c));
      if (chip != null && chip !== '') pv.chip = String(chip);
      if (text != null) pv.text = String(text);
      if (period === 'recent' || period === 'all') pv.period = period;
      const view = recent.view(all, pv.period, pv.text, now);
      const list = view.list;
      // Opening, or a chip emptied by the last decision (read again), or one the period has no card for (Late): the
      // chip that holds what waits.
      const counts = ma.chips(list);
      const on = counts.filter((c) => c.key === pv.chip)[0];
      if (!pv.chip || !on || (rebuild && (chip == null || chip === '') && list.length && !on.count)) pv.chip = ma.firstChip(list);
      pv.chips = counts;
      pv.summary = ma.summary(list, view.filtered && all.length > 0);
      const shown = ma.filter(list, pv.chip, pv.text);
      const older = view.filtered ? ma.filter(all, pv.chip, '').length - shown.length : 0;
      pv.shown = shown;
      pv.dated = recent.dated(view, older, 'request');
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
