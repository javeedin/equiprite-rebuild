define(['resources/js/exportKit'], (exportKit) => {
  'use strict';

  // EquipRite FDD: binding helpers. The content is resources/js/fddCatalog.js, the logic resources/js/fddModel.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }

    /** What Export takes from the open tab, in words. */
    exportNote(tab, reqCount, flowSteps, mapCount) {
      if (tab === 'flows') return (flowSteps || 0) + ' steps of this flow';
      if (tab === 'mapping') return (mapCount || 0) + ' rows, as shown';
      return (reqCount || 0) + ' requirements, as shown';
    }

    /** The steps of the open flow, for the export note. */
    flowSteps(flows, id) {
      const f = (flows || []).filter((x) => x.id === id)[0];
      return f ? f.steps : 0;
    }
  }

  return PageModule;
});
