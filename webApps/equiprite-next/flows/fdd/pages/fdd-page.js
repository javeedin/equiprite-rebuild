define(['resources/js/exportKit'], (exportKit) => {
  'use strict';

  // EquipRite FDD: binding helpers. The content is resources/js/fddCatalog.js, the logic resources/js/fddModel.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }

    /** What Export takes from the open tab, in words (on Mapping, the drill when one is open). */
    exportNote(tab, reqCount, flowSteps, mapCount, drill) {
      if (tab === 'flows') return (flowSteps || 0) + ' steps of this flow';
      if (tab === 'mapping' && drill && drill.open) return this.drillNote(drill);
      if (tab === 'mapping') return (mapCount || 0) + ' rows, as shown';
      return (reqCount || 0) + ' requirements, as shown';
    }

    /** What the drill's Export takes: exactly the rows it shows. */
    drillNote(drill) {
      const d = drill || {};
      const n = ((d.rows && d.rows.length) || 0) + ((d.extra && d.extra.length) || 0);
      return n + (n === 1 ? ' row' : ' rows') + ' of ' + (d.title || 'this drill') + ', as shown';
    }

    /** The steps of the open flow, for the export note. */
    flowSteps(flows, id) {
      const f = (flows || []).filter((x) => x.id === id)[0];
      return f ? f.steps : 0;
    }
  }

  return PageModule;
});
