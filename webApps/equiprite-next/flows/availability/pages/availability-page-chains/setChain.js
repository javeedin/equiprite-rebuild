define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/availability',
], (ActionChain, Actions, av) => {
  'use strict';

  // A choice changed: the window (dates or a quick one), the search, a class, yard or chip, grouping, zoom, moving
  // the timeline, folding a group, more rows in a group, showing a clash on the timeline, or a menu. Nothing here
  // reads or writes data; the page is worked out again (applyChain). A new filter starts the groups' rows afresh.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const { $page } = context;
      const v = $page.variables;
      const val = value == null ? '' : String(value);
      const today = (v.model && v.model.today) || av.todayKey();
      if (field === 'exportOpen') { v.exportOpen = !v.exportOpen; v.yardOpen = false; return; }
      if (field === 'yardOpen') { v.yardOpen = !v.yardOpen; v.exportOpen = false; return; }
      let scroll = false;
      if (field === 'more') {
        v.more = Object.assign({}, v.more || {}, { [val]: ((v.more || {})[val] || 0) + av.MORE_ROWS });
      } else if (field === 'from' || field === 'to' || field === 'preset') {
        let from = v.from;
        let to = v.to;
        if (field === 'preset') {
          from = today;
          to = av.addDays(today, Math.max(1, Number(val) || 14) - 1);
        } else {
          // A cleared date box changes nothing.
          if (!av.d10(val)) return;
          if (field === 'from') from = val; else to = val;
        }
        const win = av.windowOf(from, to, today);
        v.from = win.from;
        v.to = win.to;
        const fit = av.fitView(win, v.zoom);
        v.zoom = fit.zoom;
        v.viewStart = fit.viewStart;
      } else if (field === 'move') {
        const z = av.ZOOMS[v.zoom] || av.ZOOMS.week;
        if (val === 'prev') v.viewStart = av.addDays(av.mondayOf(v.viewStart || today), -z.step);
        else if (val === 'next') v.viewStart = av.addDays(av.mondayOf(v.viewStart || today), z.step);
        else if (val === 'today') v.viewStart = av.fitView({ from: today, days: 1 }, v.zoom).viewStart;
        else v.viewStart = av.fitView(av.windowOf(v.from, v.to, today), v.zoom).viewStart;
      } else if (field === 'zoom') {
        v.zoom = val === 'month' ? 'month' : 'week';
      } else if (field === 'groupBy') {
        v.groupBy = val === 'yard' ? 'yard' : 'class';
        v.collapsed = {};
        v.more = {};
      } else if (field === 'collapse') {
        const next = Object.assign({}, v.collapsed || {});
        if (next[val]) delete next[val]; else next[val] = true;
        v.collapsed = next;
      } else if (field === 'text') {
        v.text = val;
        v.more = {};
      } else if (field === 'cls') {
        v.cls = v.cls === val ? '' : val;
        v.more = {};
      } else if (field === 'yard') {
        v.yard = val;
        v.yardOpen = false;
        v.more = {};
      } else if (field === 'chip') {
        v.chip = val || 'all';
        v.more = {};
      } else if (field === 'clear') {
        v.text = '';
        v.cls = '';
        v.yard = '';
        v.chip = 'all';
        v.more = {};
      } else if (field === 'focus') {
        // "Show on the timeline": that unit alone, its clash or turnaround in view.
        const at = val.lastIndexOf('|');
        const unit = at === -1 ? val : val.slice(0, at);
        const from = at === -1 ? '' : val.slice(at + 1);
        v.text = unit;
        v.cls = '';
        v.yard = '';
        v.chip = 'all';
        v.collapsed = {};
        v.more = {};
        if (av.d10(from)) v.viewStart = av.fitView({ from, days: 1 }, v.zoom).viewStart;
        scroll = true;
      } else {
        return;
      }
      v.exportOpen = false;
      await Actions.callChain(context, { chain: 'applyChain' });
      if (scroll) $page.functions.scrollToTimeline();
    }
  }

  return setChain;
});
