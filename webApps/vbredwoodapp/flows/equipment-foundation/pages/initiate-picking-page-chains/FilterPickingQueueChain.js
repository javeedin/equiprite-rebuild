define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class FilterPickingQueueChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const allItems = $page.variables.PickingQueueAllArray;
      const fc       = $page.variables.filterCriterion;

      if (!fc || (Array.isArray(fc.criteria) && fc.criteria.length === 0)) {
        $page.variables.PickingQueueFilteredArray = [...allItems];
        return;
      }

      let results = [...allItems];

      if (fc.$tag === '_root_' && Array.isArray(fc.criteria)) {
        fc.criteria.forEach(c => { results = this._applyCriterion(c, results); });
      } else {
        results = this._applyCriterion(fc, results);
      }

      $page.variables.PickingQueueFilteredArray = results;
    }

    _applyCriterion(criterion, data) {
      if (!criterion) return data;

      // KEYWORD: { text: 'word', matchBy: 'phrase' }
      if (criterion.text) {
        const words = criterion.text.toLowerCase().split(/\s+/).filter(w => w);
        return data.filter(item =>
          words.some(word =>
            (item.requestNumber  && String(item.requestNumber).toLowerCase().includes(word))  ||
            (item.project        && String(item.project).toLowerCase().includes(word))        ||
            (item.requestor      && String(item.requestor).toLowerCase().includes(word))      ||
            (item.equipmentClass && String(item.equipmentClass).toLowerCase().includes(word))
          )
        );
      }

      // $eq — flat: { op:'$eq', attribute:'status', value:'APPROVED' }
      if (criterion.op === '$eq' && criterion.attribute) {
        return data.filter(item =>
          String(item[criterion.attribute] || '').toLowerCase() === String(criterion.value || '').toLowerCase()
        );
      }

      // $eq — chip: { op:'$eq', value:{ status:'APPROVED' } }
      if (criterion.op === '$eq' && !criterion.attribute &&
          criterion.value && typeof criterion.value === 'object' && !Array.isArray(criterion.value)) {
        const keys = Object.keys(criterion.value);
        if (keys.length === 1) {
          const attr = keys[0];
          const val  = criterion.value[attr];
          return data.filter(item =>
            String(item[attr] || '').toLowerCase() === String(val || '').toLowerCase()
          );
        }
      }

      // $and compound
      if (criterion.op === '$and' && Array.isArray(criterion.criteria)) {
        let filtered = data;
        criterion.criteria.forEach(sub => { filtered = this._applyCriterion(sub, filtered); });
        return filtered;
      }

      // $or compound
      if (criterion.op === '$or' && Array.isArray(criterion.criteria)) {
        const merged = new Map();
        criterion.criteria.forEach(sub => {
          this._applyCriterion(sub, data).forEach(item => merged.set(item.id, item));
        });
        return Array.from(merged.values());
      }

      return data;
    }
  }

  return FilterPickingQueueChain;
});
