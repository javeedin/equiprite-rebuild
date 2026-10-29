define([], function() {
  'use strict';

  // Helpers for merging sidebar selections into the smart-search filterCriterion,
  // so the sidebar and the smart-search chips share one filter state (the DPV
  // applies filterCriterion server-side). Criterion shapes follow oj-smart-search:
  //   single chip  → { op:'$eq', value:{ field: v } }
  //   keyword only → { text, matchBy:'phrase' }
  //   combined     → { $tag:'_root_', op:'$and', criteria:[...] }

  // Break a criterion into a flat list of { field, node } (field null = keyword).
  function flatten(c) {
    if (!c) return [];
    if (Array.isArray(c.criteria)) {
      return c.criteria.reduce(function(acc, n) { return acc.concat(flatten(n)); }, []);
    }
    if (c.text && c.matchBy) return [{ field: null, node: c }];
    if (c.op === '$eq') {
      var f = c.attribute || (c.value && typeof c.value === 'object' ? Object.keys(c.value)[0] : null);
      return [{ field: f, node: c }];
    }
    return [{ field: null, node: c }];
  }

  function kv(field, value) { var o = {}; o[field] = value; return o; }

  // Merge field=value chips into an existing criterion, preserving keyword + any
  // unrelated chips. A null value removes that field's chip.
  //   existing — current filterCriterion (or null)
  //   updates  — { fieldName: value|null, ... }
  function merge(existing, updates) {
    var parts = flatten(existing);
    var managed = Object.keys(updates);

    parts = parts.filter(function(p) {
      return !(p.field && managed.indexOf(p.field) !== -1);
    });
    managed.forEach(function(f) {
      if (updates[f] != null) {
        parts.push({ field: f, node: { op: '$eq', value: kv(f, updates[f]) } });
      }
    });

    var nodes = parts.map(function(p) { return p.node; });
    if (nodes.length === 0) return null;
    if (nodes.length === 1) return nodes[0];
    return { $tag: '_root_', op: '$and', criteria: nodes };
  }

  // Scope a master subclass-options list (each row carrying its parent
  // classId) down to just the subclasses belonging to one Class — or the
  // full list when classId is null (no Class selected). Shared by every
  // code path that can change the selected Class (sidebar clicks AND the
  // smart-search Class/Subclass chips themselves), so the Subclass chip's
  // dropdown is always scoped the same way no matter which UI drove the
  // change.
  function scopeSubclasses(master, classId) {
    if (classId == null) return (master || []).slice();
    var cid = Number(classId);
    return (master || []).filter(function(s) { return s && Number(s.classId) === cid; });
  }

  return { merge: merge, flatten: flatten, scopeSubclasses: scopeSubclasses };
});
