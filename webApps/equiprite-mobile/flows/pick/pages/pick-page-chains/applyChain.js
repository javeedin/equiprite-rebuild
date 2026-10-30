define([
  'vb/action/actionChain',
  'resources/js/yardWork',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
], (ActionChain, yw, mp, snapshot, cu) => {
  'use strict';

  // What the list shows (Next's applyChain): each request with its pieces (yardWork.items), the stage chips, the yards,
  // then the requests the chip, the yard and the search keep, in sections by the day they are needed (late first), a
  // card each (mobilePick.card: how many are picked, counting what is ticked on this phone). Worked out first, set last.
  class applyChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const v = context.$page.variables;
      const now = Date.now();
      const kept = mp.read(snapshot, cu.auditActor(context) || ($application.user || {}).username || '');
      const items = yw.items('picking', v.records, v.linesBy, v.yards, now, { finding: v.yardsLoading });
      const shown = yw.filter(items, { stage: v.stage, yard: v.yard, text: v.text });
      const sections = mp.sections(yw.sections('picking', shown, v.collapsed), kept, now);
      v.items = items;
      v.chips = mp.chips(yw.tiles('picking', items), items);
      v.yardChips = yw.yardOptions(items);
      v.summary = yw.summary('picking', items);
      v.pending = mp.pending(kept, now);
      v.shown = shown;
      v.sections = sections;
    }
  }

  return applyChain;
});
