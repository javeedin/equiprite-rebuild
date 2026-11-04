define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/nav', 'resources/js/transferList'], (exportKit, fmt, nav, list) => {
  'use strict';

  // A transfer's tab: binding helpers. The logic is resources/js/transferList.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }

    date(v) { return fmt.date(v) || '—'; }

    /** The same work in New EquipRite (release, ship, receive, the inter-org transfer: steps that write to Fusion). */
    newUrl(base, head) { return head && head.newNav ? nav.newUrl(base, head.newNav) : ''; }

    newLabel(head) {
      return { out: 'Release, ship or receive it in New', back: 'Ship or receive the return in New', between: 'Inter-project transfers in New' }[head && head.kind] || 'Open it in New';
    }

    newTitle(head) {
      return 'These steps write to Oracle Fusion (transfer orders, shipping, receiving' + (head && head.kind === 'between' ? ', the inter-org transfer' : '')
        + ') and are not in EquipRite Next yet; New EquipRite does them with the same data.';
    }

    // ── Redwood (your menu, Look): Oracle's general overview page as this tab's head ───────────────────────────
    /** The header's subtitle: the kind (the current look's kicker), then the request and its project. */
    rwSubtitle(head) {
      const h = head || {};
      return [h.kindLabel, [h.requestNumber, h.party].filter((x) => !!x).join(' · ')].filter((x) => !!x).join(' · ');
    }

    /** The header's badge: where the transfer is, in Oracle's badge colours. */
    rwBadge(head) { return list.headerBadge(head); }

    /** The header's actions (rwActionChain): Refresh, Export to Excel, and the work in New EquipRite when New is known. */
    rwActions(base, head) {
      const out = [{ id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: 'on' },
        { id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: 'on' }];
      if (this.newUrl(base, head)) out.push({ id: 'new', label: this.newLabel(head), icon: 'oj-ux-ico-external-link', display: 'on' });
      return out;
    }

    /** What the kind of transfer means, in a line. */
    kindHint(kind) {
      return {
        out: 'From the yard to the site, on a transfer order made at picking.',
        back: 'From the site back to the yard, on the return transfer order.',
        between: 'From one project\'s site straight to another project, without going back to the yard.'
      }[kind] || '';
    }

    /** A unit's colour ('' for a unit of an inter-project transfer: it takes the transfer's). */
    unitStage(u) { return (u && u.state && u.state.stage) || ''; }

    statusText(s) { return list.historyStatusText(s); }

    statusStage(s) {
      return { COMPLETED: 'onsite', POSTED: 'onsite', FAILED: 'stopped', CANCELLED: 'done' }[String(s || '').toUpperCase()] || 'ready';
    }
  }

  return PageModule;
});
