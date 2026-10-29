define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Giving rows a class. Every change goes through the old page module's applyEdit and applyEditToRows, keyed on
  // fusionInventoryItemId, so the rules are the old grid's: a MERGED row cannot be edited, a class change clears
  // a subclass that no longer belongs to it, and the order of the two picks does not matter.
  //   open / close            the editor for one row (its Class cell)
  //   class / subclass        set them on that row
  //   bulkClass / bulkSubclass / applyBulk   one class (and subclass) for every ticked row on this page
  // Nothing is saved here: Import sends the ticked rows with these classes.
  const COL_CLASS = 6;
  const COL_SUBCLASS = 7;
  const id = (value) => (value === '' || value == null ? null : Number(value));

  class classEditChain extends ActionChain {
    async run(context, { action, index, value }) {
      const { $page } = context;
      const v = $page.variables;
      const f = $page.functions;
      if (f.isBusy(v)) return;

      const edit = (i, col, val) => {
        if (!f.canEdit(i, col, v)) return;
        const changed = f.applyEdit(i, col, val, v);
        v.stagingChangedRows = changed;
        const key = f.rowKeyAt(i);
        if (key != null) {
          v.stagingArray = f.applyEditToRows(i, changed[key], v.stagingArray);
        }
      };

      switch (action) {
        case 'open': {
          // Kept as the row's merge key, not its index, so a reload (paging, a filter) closes the editor
          // instead of pointing it at whichever row now sits at that index.
          const key = f.rowKeyAt(Number(index));
          v.editKey = key == null || String(v.editKey) === String(key) ? '' : String(key);
          return;
        }
        case 'close':
          v.editKey = '';
          return;
        case 'class':
        case 'subclass': {
          const i = f.editIndex(v.editKey, v.stagingArray);
          if (i >= 0) edit(i, action === 'class' ? COL_CLASS : COL_SUBCLASS, id(value));
          return;
        }
        case 'bulkClass':
          v.bulk = { classId: id(value) === (v.bulk && v.bulk.classId) ? null : id(value), subclassId: null };
          return;
        case 'bulkSubclass':
          v.bulk = Object.assign({}, v.bulk, { subclassId: id(value) === (v.bulk && v.bulk.subclassId) ? null : id(value) });
          return;
        case 'applyBulk': {
          const b = v.bulk || {};
          if (b.classId == null) return;
          const rows = v.stagingArray || [];
          let n = 0;
          for (let i = 0; i < rows.length; i++) {
            if (!f.isRowSelected(i, v) || !f.canEdit(i, COL_CLASS, v)) continue;
            edit(i, COL_CLASS, b.classId);
            if (b.subclassId != null) edit(i, COL_SUBCLASS, b.subclassId);
            n++;
          }
          v.bulk = { classId: null, subclassId: null };
          v.stagingSaveMessage = n + ' ticked row' + (n === 1 ? '' : 's') + ' given ' +
            (f.classNameFor(b.classId, v.classesById) || 'the class') +
            (b.subclassId != null ? ' · ' + f.subclassNameFor(b.subclassId, v.subclassesById) : '') +
            '. Import to merge them.';
          return;
        }
        default:
      }
    }
  }

  return classEditChain;
});
