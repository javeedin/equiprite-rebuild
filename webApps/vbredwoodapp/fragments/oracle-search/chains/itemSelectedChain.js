define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  class itemSelectedChain extends ActionChain {
    async run(context, params) {
      const { $fragment } = context;
      const data = params && params.selectedRow ? params.selectedRow : null;
      if (!data) return;

      const displayField1 = $fragment.variables.displayField1 || $fragment.variables.searchField;
      const displayField2 = $fragment.variables.displayField2 || '';
      const text1 = displayField1 && data[displayField1] ? String(data[displayField1]) : '';
      const text2 = displayField2 && data[displayField2] ? String(data[displayField2]) : '';
      let format = String($fragment.variables.selectedDisplayFormat || '').trim();
      if (!format) {
        format = text2 ? '%displayField1% - %displayField2%' : '%displayField1%';
      }
      let rendered = format
        .replace(/%displayField1%/g, text1)
        .replace(/%displayField2%/g, text2)
        .replace(/%searchField%/g, text1)
        .replace(/%displayField%/g, text1);
      rendered = rendered.replace(/\s+-\s+$/, '').replace(/\s+$/,'').replace(/^\s+/,'');
      $fragment.variables.searchText = rendered || text1;
      $fragment.variables.selectedItem = data;
      $fragment.variables.selectedItemName = text1;
      $fragment.variables.selectedKey = $fragment.variables.keyField ? data[$fragment.variables.keyField] : null;

      await Actions.fireCustomEvent(context, {
        event: 'itemSelectedEvent',
        payload: {
          data: data,
          key: $fragment.variables.selectedKey
        }
      });
    }
  }

  return itemSelectedChain;
});
