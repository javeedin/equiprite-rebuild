define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Opening and ticking rows of the preview tree. The old drill-down's toggleGroupChain, toggleWeekDaysChain,
  // toggleMiscGroupChain (open / close), toggleWeekChain, toggleGroupSelectChain, toggleMiscChain and
  // selectAllPastChain (ticks). Only a postable week can be ticked; only an unposted charge. Each tick re-stamps
  // every equipment's "all weeks selected" state, so the per-equipment box always tells the truth.
  class treeChain extends ActionChain {
    async run(context, { action, key, checked }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (action === 'listText') {
        v.listText = key == null ? '' : String(key);
        return;
      }
      if (v.isPosting) return;
      const on = checked === true || checked === 'true';
      let all = (v.rowsAll || []).slice();
      if (action === 'toggleGroup') {
        all = all.map((r) => (r.kind === 'group' && r.groupKey === key ? Object.assign({}, r, { expanded: !r.expanded }) : r));
      } else if (action === 'toggleDays') {
        all = all.map((r) => (r.kind === 'week' && r.rowKey === key ? Object.assign({}, r, { weekExpanded: !r.weekExpanded }) : r));
      } else if (action === 'toggleMiscGroup') {
        all = all.map((r) => (r.kind === 'miscGroup' && r.rowKey === key ? Object.assign({}, r, { miscExpanded: !r.miscExpanded }) : r));
      } else if (action === 'week') {
        const target = all.find((r) => r.kind === 'week' && r.rowKey === key);
        if (!target || !target.postable || target.posted) return;
        all = fns.restampSelection(all.map((r) => (r === target ? Object.assign({}, r, { selected: on }) : r)));
      } else if (action === 'group') {
        const mine = all.filter((r) => r.kind === 'week' && r.groupKey === key && r.postable && !r.posted);
        if (!mine.length) return;
        const next = !mine.every((r) => r.selected);
        all = fns.restampSelection(all.map((r) => (mine.indexOf(r) >= 0 ? Object.assign({}, r, { selected: next }) : r)));
      } else if (action === 'misc') {
        all = all.map((r) => (r.kind === 'misc' && r.rowKey === key && r.status !== 'POSTED' ? Object.assign({}, r, { selected: !r.selected }) : r));
      } else if (action === 'selectAllPast') {
        const postable = all.filter((r) => r.kind === 'week' && r.postable && !r.posted);
        const next = !(postable.length > 0 && postable.every((r) => r.selected));
        all = fns.restampSelection(all.map((r) => (r.kind === 'week' && r.postable && !r.posted ? Object.assign({}, r, { selected: next }) : r)));
      } else {
        return;
      }
      v.rowsAll = all;
      if (v.panel === 'review' && !fns.selection(all).items) v.panel = '';
    }
  }

  return treeChain;
});
