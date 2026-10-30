define([
  'vb/action/actionChain',
  'resources/js/yardWork',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
  'resources/js/mobileRecent',
], (ActionChain, yw, mp, snapshot, cu, recent) => {
  'use strict';

  // What the list shows (Next's applyChain): each request with its pieces (yardWork.items), the stage chips, the yards,
  // then the requests the chip, the yard and the search keep, in sections by the day they are needed (late first), a
  // card each (mobilePick.card: how many are picked, counting what is ticked on this phone). Worked out first, set last.
  // Mobile's own: the period (the last few days, or every date: mobileRecent, over the dates a work item carries). The
  // chips, the yards and the line under the title follow it; a search looks through every date; under the list, how
  // many older requests it leaves out under the chip and the yard.
  class applyChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const v = context.$page.variables;
      const now = Date.now();
      const kept = mp.read(snapshot, cu.auditActor(context) || ($application.user || {}).username || '');
      const items = yw.items('picking', v.records, v.linesBy, v.yards, now, { finding: v.yardsLoading });
      const view = mp.period(items, v.period, v.text, now);
      const shown = yw.filter(view.list, { stage: v.stage, yard: v.yard, text: v.text });
      const older = view.filtered ? yw.filter(items, { stage: v.stage, yard: v.yard, text: '' }).length - shown.length : 0;
      const sections = mp.sections(yw.sections('picking', shown, v.collapsed), kept, now);
      v.items = items;
      v.chips = mp.chips(yw.tiles('picking', view.list), view.list);
      v.yardChips = yw.yardOptions(view.list);
      v.summary = mp.summary(view.list, view.filtered && items.length > 0);
      v.pending = mp.pending(kept, now);
      v.shown = shown;
      v.sections = sections;
      v.dated = recent.dated(view, older, 'request');
    }
  }

  return applyChain;
});
