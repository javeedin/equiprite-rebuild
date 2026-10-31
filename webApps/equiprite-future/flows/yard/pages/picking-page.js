define([
  'resources/js/exportKit',
  'resources/js/nav',
  'resources/js/rules',
  'resources/js/requestProgress',
  'resources/js/yardWork',
  'resources/js/shellBus',
], (exportKit, nav, rules, Progress, yw, bus) => {
  'use strict';

  // Picking & shipping: binding helpers. The list's logic is resources/js/yardWork.js; the workspace's rules (ticks,
  // transfer orders, what Pick and ship moves) are New's, in yardWork too.
  class PageModule {
    constructor(context) {
      // Another screen may hand over a request to open (shellBus.focus): focusChain takes it.
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('picking', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
    }

    formats() { return exportKit.FORMATS; }

    /** The yard's steps are for those with full access to Initiate picking; read-only sees them, cannot act. */
    canAct(map, loaded) { return rules.pageAccess(map, loaded, 'EQR_INITIATE_PICKING') === 'FULL'; }

    newUrl(base) { return nav.newUrl(base, 'picking'); }

    flag(flags, loaded, key) { return rules.isFeatureEnabled(flags, loaded, key); }

    plural(n, one, many) { const v = Number(n) || 0; return v + ' ' + (v === 1 ? one : (many || one + 's')); }

    // ── List ─────────────────────────────────────────────────────────────────────────────────────────────────
    isOn(a, b) { return String(a) === String(b); }

    tileClass(tile, stage) {
      return 'nx-yd-tile nx-yd-tone--' + tile.tone + (String(stage) === tile.key ? ' nx-yd-tile--on' : '') + (tile.count ? '' : ' nx-yd-tile--zero');
    }

    tileNote(tile) {
      if (!tile.count) return tile.hint;
      return 'on ' + this.plural(tile.requests, 'request');
    }

    rowClass(it, openId) { return 'nx-yd-row' + (String(openId) === String(it.id) ? ' nx-yd-row--open' : ''); }

    whenClass(it) { return 'nx-yd-when' + (it.late > 0 ? ' nx-late' : (it.section === 'today' ? ' nx-yd-when--today' : '')); }

    nextClass(next) { return 'nx-yd-next nx-yd-next--' + ((next && next.where) || 'none'); }

    nextWhere(next) {
      if (!next) return '';
      if (next.where === 'new') return 'In New EquipRite';
      if (next.where === 'fusion') return 'In Fusion';
      if (next.where === 'here') return 'Here';
      return '';
    }

    /** "From Houston Yard" under the pieces when the list is beside a request (narrow columns). */
    compactLine(it) {
      return [it.yardText && it.yardText !== '—' ? 'From ' + it.yardText : '', it.next ? it.next.text : ''].filter((x) => !!x).join(' · ');
    }

    // ── Workspace ────────────────────────────────────────────────────────────────────────────────────────────
    /** "Project · Task" (or the customer) under the request number. */
    subline(req) { return [req && req.party, req && req.task].filter((x) => !!x).join(' · '); }

    ticked(ticks, lineId) { return (ticks || []).map(String).indexOf(String(lineId)) !== -1; }

    allTicked(lines, ticks) { return yw.allTicked(lines, ticks); }

    tickedCount(lines, ticks) { return yw.selectedLines(lines, ticks).length; }

    /** { awaiting, stock, fm, picking, shipped, total } for the steps. */
    steps(lines) {
      const list = Array.isArray(lines) ? lines : [];
      const stock = yw.stockToRelease(list).length;
      const fm = yw.fmAwaiting(list).length;
      return {
        awaiting: stock + fm,
        stock,
        fm,
        picking: list.filter((l) => l.lineStatus === 'PICK_INITIATED').length,
        shipped: list.filter((l) => l.lineStatus === 'SHIP_TO_SITE').length,
        total: list.length,
      };
    }

    /** The step the request is on: release while anything waits for it, then picking, then shipped. */
    current(lines) {
      const s = this.steps(lines);
      if (s.awaiting) return 'release';
      if (s.picking) return 'ship';
      return s.shipped ? 'shipped' : '';
    }

    stepClass(key, lines) { return 'nx-yd-step' + (this.current(lines) === key ? ' nx-yd-step--current' : ''); }

    /** Transfer orders still awaiting release, by number: "TO-778402, TO-778399". */
    awaitingTOs(tos) { return yw.unreleasedTOs(tos).map((t) => t.orderNumber || 'a transfer order still being created in Fusion').join(', '); }

    /** "3 pieces on transfer order TO-778402, TO-778399 wait for release." */
    stockReleaseText(lines, tos) {
      const n = this.steps(lines).stock;
      const list = this.awaitingTOs(tos);
      return this.plural(n, 'piece') + (list ? ' on transfer order ' + list : ' on a transfer order still being created in Fusion') + (n === 1 ? ' waits' : ' wait') + ' for release.';
    }

    /** The fixed-asset pieces waiting for release, and what releasing them here does. */
    fmReleaseText(lines) {
      const n = this.steps(lines).fm;
      return this.plural(n, 'fixed-asset piece') + ' with no transfer order ' + (n === 1 ? 'waits' : 'wait') + ' for release. Tick '
        + (n === 1 ? 'it' : 'them') + ', then release ' + (n === 1 ? 'it' : 'them') + ' here: EquipRite marks '
        + (n === 1 ? 'it' : 'them') + ' being picked (Pick initiated). Nothing is sent to Fusion.';
    }

    /** "TO-778402, TO-778399 · 2 awaiting release" / "TO-778402 · released". */
    toList(tos) {
      const list = Array.isArray(tos) ? tos : [];
      if (!list.length) return '';
      const waiting = list.filter((t) => !t.released).length;
      return list.map((t) => t.orderNumber || 'one being created').join(', ')
        + ' · ' + (waiting === 0 ? (list.length === 1 ? 'released' : 'all released') : (waiting === list.length && list.length > 1 ? 'all awaiting release' : waiting + ' awaiting release'));
    }

    fmToRelease(lines, ticks) { return yw.fmToRelease(lines, ticks).length; }

    canShip(tos, selectedTOId, lines, ticks) { return yw.canShip(tos, selectedTOId, lines, ticks); }

    shipCount(tos, selectedTOId, lines, ticks) { return yw.shipLines(tos, selectedTOId, lines, ticks).length; }

    /** Pieces in the ship set whose maintenance asset Fusion would move (the asset-sync flag is on): New's step. */
    relocates(syncOn, tos, selectedTOId, lines, ticks) {
      if (!syncOn) return 0;
      const set = yw.shipLines(tos, selectedTOId, lines, ticks).map((l) => ({ isMaintenanceTracked: l.maintenanceTracked, isTransactable: l.transactable }));
      return yw.fusionRelocations(true, set).length;
    }

    /** Where to pick it: "Houston Yard · Available · A-12-04". */
    where(line) { return [line && line.yard, line && line.subinventory, line && line.locator].filter((v) => !!v).join(' · ') || 'Yard not recorded'; }

    lineLabel(status, external) { return Progress.line(status, !!external).label || '—'; }

    lineTone(status, external) { return Progress.line(status, !!external).stage || 'ready'; }

    lineFacts(line) {
      return [line.equipmentClass, line.isFAndM ? 'Fixed asset, no transfer order' : (line.toNumber ? 'Transfer order ' + line.toNumber : 'Stock, no transfer order yet')]
        .filter((x) => !!x).join(' · ');
    }

    /** The open request's other pieces (not at a picking step handled here), from the list's lines. */
    otherLines(linesBy, openId, workLines, external) {
      const raw = (linesBy || {})[openId];
      if (!Array.isArray(raw)) return [];
      const here = {};
      (workLines || []).forEach((l) => { here[String(l.lineId)] = true; });
      return raw.filter((r) => !here[String(r.lineId)]).map((r) => {
        const info = Progress.line(r.lineStatus, !!external);
        return { lineId: String(r.lineId), name: r.equipmentName || 'Equipment', cls: r.className || '', qty: r.quantity || 1, status: r.lineStatus || '',
          label: info.label, tone: info.stage || 'ready', next: info.who ? info.who + ' to ' + info.what : '' };
      });
    }

    /** The line in Old EquipRite (line detail), where a unit is re-allocated. */
    oldLineLink(oldAppUrl, req, lineId, lines) {
      if (!oldAppUrl || !req || !lineId) return '';
      const numericId = req.eqrEquipmentRequestId || req.id;
      if (!numericId) return '';
      const line = (Array.isArray(lines) ? lines : []).filter((l) => String(l.lineId) === String(lineId))[0] || {};
      const base = oldAppUrl.slice(-1) === '/' ? oldAppUrl : oldAppUrl + '/';
      return base + 'vp/shell/equipment-foundation/line-detail?requestId=' + encodeURIComponent(numericId)
        + '&requestNumber=' + encodeURIComponent(req.requestNumber || '') + '&lineId=' + encodeURIComponent(lineId)
        + '&equipmentMasterId=' + encodeURIComponent(line.equipmentMasterId != null ? line.equipmentMasterId : '');
    }

    bannerClass(b) { return 'nx-yd-banner nx-yd-banner--' + ((b && b.type) || 'info'); }

    hasReleased(lines) { return (Array.isArray(lines) ? lines : []).some((l) => ['PICK_INITIATED', 'SHIP_TO_SITE', 'DELIVERED', 'DEPLOYED'].indexOf(String(l.lineStatus)) !== -1); }

    // ── Pick slip preview (DOM only, as New's page) ──────────────────────────────────────────────────────────
    printSlip() {
      const frame = document.querySelector('#ydSlip iframe');
      if (!frame || !frame.contentWindow) return false;
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        return true;
      } catch (e) {
        console.warn('[pickSlip] print failed:', e);
        return false;
      }
    }

    downloadSlip(url, fileName) {
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'pick-slip.pdf';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  return PageModule;
});
