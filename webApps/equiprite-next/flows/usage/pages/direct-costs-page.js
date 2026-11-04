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

    // ── Redwood look (your menu, Look): Oracle's general overview page as the header ──

    /** The header's subtitle: the current look's line under the title. */
    rwSubtitle(requests, isLoading, current) {
      if (isLoading && !(requests || []).length) return 'Loading the active requests…';
      if (!current) return 'Fuel, parts and consumables used on approved and active requests';
      return current.requestNumber + ' · ' + (current.projectName || '—') + (current.taskName ? ' / ' + current.taskName : '');
    }

    /** The header's primary action: the current look's "Record in New EquipRite", on the request that is open. */
    rwPrimary(newBase, current) {
      return { label: 'Record in New EquipRite', display: current && this.newUrl(newBase, current.requestNumber) ? 'on' : 'off' };
    }

    rwActions(isLoading, detailLoading, closed) {
      return [{ id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: isLoading || detailLoading || closed ? 'disabled' : 'on' }];
    }

    leftClass(l) {
      return 'nx-num nx-u-cell-r' + (l.consumable && l.left === 0 ? ' nx-dc-none' : '');
    }
  }

  return PageModule;
});
