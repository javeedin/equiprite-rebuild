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
