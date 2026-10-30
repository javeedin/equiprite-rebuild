define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/equipmentMaster',
  'resources/js/shellBus',
], (ActionChain, exportKit, em, bus) => {
  'use strict';

  // Exports what the view shows, as Excel, CSV, PDF or rows to paste: the list or the map's items (their search,
  // filters, location and order), or the Import view's fetched items on this page (with their class and whether
  // they are ticked).
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const { $page } = context;
      const v = $page.variables;
      v.exportOpen = false;
      let res;
      if (v.view === 'import') {
        res = await exportKit.run(format, {
          name: 'equipment-from-fusion',
          title: 'Fetched from Fusion',
          subtitle: v.stagingSummary,
          rows: v.stagingArray,
          columns: em.importColumns($page.functions, v),
        });
      } else {
        res = await exportKit.run(format, {
          name: 'equipment-master',
          title: 'Equipment master',
          subtitle: this.filters(v),
          rows: v.shown,
          columns: em.exportColumns(),
        });
      }
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }

    /** "Excavators · Active · at Houston Yard · "cat"", or "All equipment". */
    filters(v) {
      const label = (list, key) => {
        const c = (list || []).filter((x) => key && x.key === String(key))[0];
        return c ? c.label : '';
      };
      const ch = v.chips || {};
      const group = (v.assetGroupOptions || []).filter((g) => v.assetGroupId && String(g.value) === String(v.assetGroupId))[0];
      const parts = [label(ch.classes, v.classId), label(ch.subclasses, v.subclassId), label(ch.statuses, v.status),
        label(ch.tracking, v.tracking), label(ch.sources, v.source), group ? 'asset group ' + group.label : '',
        v.location ? 'at ' + ((v.locationsById || {})[v.location] || 'no location on record') : '',
        v.text ? '"' + v.text + '"' : ''].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'All equipment';
    }
  }

  return exportChain;
});
