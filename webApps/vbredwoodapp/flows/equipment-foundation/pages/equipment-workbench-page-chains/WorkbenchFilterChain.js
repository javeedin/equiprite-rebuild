define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions) => {
  'use strict';

  class WorkbenchFilterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const fc = $page.variables.filterCriterion;
      const allItems = $page.variables.WorkbenchAllArray;

      // No filter active — show everything
      if (!fc || (Array.isArray(fc.criteria) && fc.criteria.length === 0)) {
        $page.variables.WorkbenchFilteredArray = [...allItems];
        return;
      }

      const processCriterion = (criterion, data) => {
        if (!criterion) return data;

        // KEYWORD TEXT SEARCH: { text: "word", matchBy: "phrase" }
        if (criterion.text && criterion.matchBy === 'phrase') {
          const words = criterion.text.toLowerCase().split(/\s+/).filter(w => w);
          return data.filter(item =>
            words.some(word =>
              // `project_customer` was split into project / customer when the
              // merged column became three. Both are searched so typing a
              // customer name still finds external requests — dropping the new
              // `customer` field here would have silently made them
              // unsearchable by name.
              (item.request_number && String(item.request_number).toLowerCase().includes(word)) ||
              (item.project && String(item.project).toLowerCase().includes(word)) ||
              (item.customer && String(item.customer).toLowerCase().includes(word)) ||
              (item.requestor && String(item.requestor).toLowerCase().includes(word)) ||
              (item.task && String(item.task).toLowerCase().includes(word))
            )
          );
        }

        // SELECT SINGLE — flat format: { op: '$eq', attribute: 'field', value: 'VALUE' }
        if (criterion.op === '$eq' && criterion.attribute) {
          // SourceFilter "ALL" → skip filtering
          if (criterion.attribute === 'source' && String(criterion.value).toUpperCase() === 'ALL') {
            return data;
          }
          return data.filter(item =>
            String(item[criterion.attribute] || '').toLowerCase() === String(criterion.value || '').toLowerCase()
          );
        }

        // SELECT SINGLE — nested/chip format: { op: '$eq', value: { fieldName: 'VALUE' } }
        if (criterion.op === '$eq' && !criterion.attribute &&
            criterion.value && typeof criterion.value === 'object' && !Array.isArray(criterion.value)) {
          const keys = Object.keys(criterion.value);
          if (keys.length === 1) {
            const attr = keys[0];
            const val = criterion.value[attr];
            // SourceFilter "ALL" → skip filtering
            if (attr === 'source' && String(val).toUpperCase() === 'ALL') {
              return data;
            }
            return data.filter(item =>
              String(item[attr] || '').toLowerCase() === String(val || '').toLowerCase()
            );
          }
        }

        // SELECT MULTIPLE — flat format: { op: '$in', attribute: 'field', value: ['A','B'] }
        if (criterion.op === '$in' && criterion.attribute && Array.isArray(criterion.value)) {
          return data.filter(item =>
            criterion.value.map(v => String(v).toLowerCase())
              .includes(String(item[criterion.attribute] || '').toLowerCase())
          );
        }

        // SELECT MULTIPLE — nested/chip format: { op: '$in', value: { fieldName: ['A','B'] } }
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

        // CONTAINS: { op: '$co', attribute: 'field', value: 'word' }
        if (criterion.op === '$co' && criterion.attribute) {
          return data.filter(item =>
            String(item[criterion.attribute] || '').toLowerCase()
              .includes(String(criterion.value || '').toLowerCase())
          );
        }

        // AND COMPOUND: { op: '$and', criteria: [...] }
        if (criterion.op === '$and' && Array.isArray(criterion.criteria)) {
          let filtered = data;
          criterion.criteria.forEach(sub => { filtered = processCriterion(sub, filtered); });
          return filtered;
        }

        // OR COMPOUND: { op: '$or', criteria: [...] }
        if (criterion.op === '$or' && Array.isArray(criterion.criteria)) {
          const merged = new Map();
          criterion.criteria.forEach(sub => {
            processCriterion(sub, data).forEach(item => merged.set(item.request_id, item));
          });
          return Array.from(merged.values());
        }

        return data;
      };

      let results = [...allItems];

      // Root compound criterion (keyword + chips combined):
      // { $tag: '_root_', criteria: [...] }
      if (fc.$tag === '_root_' && Array.isArray(fc.criteria)) {
        fc.criteria.forEach(criterion => { results = processCriterion(criterion, results); });
      } else {
        results = processCriterion(fc, results);
      }

      $page.variables.WorkbenchFilteredArray = results;
    }
  }

  return WorkbenchFilterChain;
});
