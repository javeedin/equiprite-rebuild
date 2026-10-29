define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class TabFilterPickingChain extends ActionChain {
    async run(context, { tab }) {
      const { $page } = context;

      $page.variables.activeStatusTab = tab;

      const allItems = $page.variables.PickingQueueAllArray;
      const fc       = $page.variables.filterCriterion;

      let results = [...allItems];

      // Re-apply smart search criterion
      if (fc && !(Array.isArray(fc.criteria) && fc.criteria.length === 0)) {
        if (fc.$tag === '_root_' && Array.isArray(fc.criteria)) {
          fc.criteria.forEach(c => { results = this._applyCriterion(c, results); });
        } else {
          results = this._applyCriterion(fc, results);
        }
      }

      // Apply tab filter
      if (tab && tab !== 'All') {
        results = results.filter(r => r.pickingStatus === tab);
      }

      $page.variables.PickingQueueFilteredArray = results;
    }

    _applyCriterion(criterion, data) {
      if (!criterion) return data;
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
      if (criterion.op === '$eq' && criterion.attribute) {
        return data.filter(item =>
          String(item[criterion.attribute] || '').toLowerCase() === String(criterion.value || '').toLowerCase()
        );
      }
      if (criterion.op === '$eq' && !criterion.attribute && criterion.value && typeof criterion.value === 'object') {
        const keys = Object.keys(criterion.value);
        if (keys.length === 1) {
          const attr = keys[0];
          return data.filter(item =>
            String(item[attr] || '').toLowerCase() === String(criterion.value[attr] || '').toLowerCase()
          );
        }
      }
      if (criterion.op === '$and' && Array.isArray(criterion.criteria)) {
        let f = data;
        criterion.criteria.forEach(sub => { f = this._applyCriterion(sub, f); });
        return f;
      }
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

  return TabFilterPickingChain;
});
