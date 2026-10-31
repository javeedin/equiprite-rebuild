define(['resources/js/directCost', 'resources/js/exportKit', 'resources/js/nav', 'resources/js/fmt'], (DC, exportKit, nav, fmt) => {
  'use strict';

  // Direct cost & inventory: binding helpers. The rules are New EquipRite's (resources/js/directCost.js
  // DirectCostRules: activeRequests, issuableLines, consumedTotal, directSummary, costTotal); the rest is its
  // DirectCost layer.
  class PageModule extends DC.DirectCost {
    formats() { return exportKit.FORMATS; }

    /** New EquipRite's Direct cost & inventory, opened on this request (its ?request=), where a material issue is recorded. */
    newUrl(newBase, number) {
      const u = nav.newUrl(newBase, 'direct-costs');
      return u && number ? u + '?request=' + encodeURIComponent(number) : u;
    }

    money(n) { return n == null || n === '' ? '—' : (fmt.money(n) || '—'); }

    date(v) { return fmt.date(v) || '—'; }

    plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

    qty(n) { return n == null ? '—' : String(n); }

    itemClass(r, current) {
      return 'nx-ts-qitem' + (current && current.id === r.id ? ' nx-ts-qitem--on' : '');
    }

    leftClass(l) {
      return 'nx-num nx-u-cell-r' + (l.consumable && l.left === 0 ? ' nx-dc-none' : '');
    }
  }

  return PageModule;
});
