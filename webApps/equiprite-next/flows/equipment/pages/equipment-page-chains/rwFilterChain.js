define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/equipmentRedwood',
], (ActionChain, Actions, rw) => {
  'use strict';

  // The Redwood view's Smart Search: what was typed and a filter per column. Class, Subclass, Tracked by, Location,
  // Status, Source and Asset group are the page's own filters, so both looks filter alike; Equipment and Units narrow the
  // Redwood table only (rwCols). The text and the asset group go through setChain, as the current look's search box and
  // chip do: the text asks the server too after a pause, a new asset group reads the list again. Smart Search applies a
  // picked filter when its list closes.
  const PAGE = 100;

  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const f = rw.masterCriterion(v.rwCriterion);
      const textChanged = f.text !== String(v.text || '');
      const groupChanged = f.assetGroupId !== String(v.assetGroupId || '');
      v.rwCols = f.cols;
      v.classId = f.classId;
      v.subclassId = f.subclassId;
      v.tracking = f.tracking;
      v.location = f.location;
      v.status = f.status;
      v.source = f.source;
      v.limit = PAGE;
      if (groupChanged) await Actions.callChain(context, { chain: 'setChain', params: { field: 'group', value: f.assetGroupId } });
      if (textChanged) await Actions.callChain(context, { chain: 'setChain', params: { field: 'text', value: f.text } });
      if (!groupChanged && !textChanged) await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return rwFilterChain;
});
