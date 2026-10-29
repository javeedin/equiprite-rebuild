
define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class RateScheduleFilterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const fc = $page.variables.filterCriterion;
      const allItems = $page.variables.RequestAllArray;

      if (!fc || (Array.isArray(fc.criteria) && fc.criteria.length === 0)) {
        $page.variables.RequestFilteredArray = [...allItems];
        return;
      }

      const processCriterion = (criterion, data) => {
        if (!criterion) return data;

        // KEYWORD: { text: 'word', matchBy: 'phrase' }
        if (criterion.text && criterion.matchBy === 'phrase') {
          const words = criterion.text.toLowerCase().split(/\s+/).filter(w => w);
          return data.filter(item =>
            words.some(word =>
              (item.scheduleName   && String(item.scheduleName).toLowerCase().includes(word))   ||
              (item.description    && String(item.description).toLowerCase().includes(word))    ||
              (item.equipmentClass && String(item.equipmentClass).toLowerCase().includes(word)) ||
              (item.yard           && String(item.yard).toLowerCase().includes(word))
            )
          );
        }

        // SELECT SINGLE — flat: { op: '$eq', attribute: 'status', value: 'APPROVED' }
        if (criterion.op === '$eq' && criterion.attribute) {
          return data.filter(item =>
            String(item[criterion.attribute] || '').toLowerCase() === String(criterion.value || '').toLowerCase()
          );
        }

        // SELECT SINGLE — chip: { op: '$eq', value: { status: 'APPROVED' } }
        if (criterion.op === '$eq' && !criterion.attribute &&
            criterion.value && typeof criterion.value === 'object' && !Array.isArray(criterion.value)) {
          const keys = Object.keys(criterion.value);
          if (keys.length === 1) {
            const attr = keys[0];
            const val = criterion.value[attr];
            return data.filter(item =>
              String(item[attr] || '').toLowerCase() === String(val || '').toLowerCase()
            );
          }
        }

        // SELECT MULTIPLE — flat: { op: '$in', attribute: 'status', value: ['A','B'] }
        if (criterion.op === '$in' && criterion.attribute && Array.isArray(criterion.value)) {
          return data.filter(item =>
            criterion.value.map(v => String(v).toLowerCase())
              .includes(String(item[criterion.attribute] || '').toLowerCase())
          );
        }

        // SELECT MULTIPLE — chip: { op: '$in', value: { status: ['A','B'] } }
        if (criterion.op === '$in' && !criterion.attribute &&
            criterion.value && typeof criterion.value === 'object' && !Array.isArray(criterion.value)) {
          const keys = Object.keys(criterion.value);
          if (keys.length === 1) {
            const attr = keys[0];
            const vals = criterion.value[attr];
            if (Array.isArray(vals)) {
              return data.filter(item =>
                vals.map(v => String(v).toLowerCase()).includes(String(item[attr] || '').toLowerCase())
              );
            }
          }
        }

        // AND COMPOUND
        if (criterion.op === '$and' && Array.isArray(criterion.criteria)) {
          let filtered = data;
          criterion.criteria.forEach(sub => { filtered = processCriterion(sub, filtered); });
          return filtered;
        }

        // OR COMPOUND
        if (criterion.op === '$or' && Array.isArray(criterion.criteria)) {
          const merged = new Map();
          criterion.criteria.forEach(sub => {
            processCriterion(sub, data).forEach(item => merged.set(item.id, item));
          });
          return Array.from(merged.values());
        }

        return data;
      };

      let results = [...allItems];

      // Root compound: { $tag: '_root_', criteria: [...] }
      if (fc.$tag === '_root_' && Array.isArray(fc.criteria)) {
        fc.criteria.forEach(criterion => { results = processCriterion(criterion, results); });
      } else {
        results = processCriterion(fc, results);
      }

      $page.variables.RequestFilteredArray = [...results];
    }
  }

  return RateScheduleFilterChain;
});
