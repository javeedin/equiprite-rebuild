define([
  'resources/js/exportKit',
  'resources/js/nav',
  'resources/js/rules',
  'resources/js/requestProgress',
  'resources/js/yardWork',
  'resources/js/directReturn',
  'resources/js/fmt',
], (exportKit, nav, rules, Progress, yw, dr, fmt) => {
  'use strict';

  // Receiving & returns: binding helpers. The list's logic is resources/js/yardWork.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }

    canAct(map, loaded) { return rules.pageAccess(map, loaded, 'EQR_EQUIPMENT_RETURNS') === 'FULL'; }

    newUrl(base) { return nav.newUrl(base, 'returns'); }

    plural(n, one, many) { const v = Number(n) || 0; return v + ' ' + (v === 1 ? one : (many || one + 's')); }

    /** "1 stock piece needs …", "2 stock pieces need …". */
    needsText(n, what, rest) { return this.plural(n, what) + (Number(n) === 1 ? ' needs ' : ' need ') + rest; }

    // ── List (same shapes as Picking & shipping) ──────────────────────────────────────────────────────────────
    tileClass(tile, stage) {
      return 'nx-yd-tile nx-yd-tone--' + tile.tone + (String(stage) === tile.key ? ' nx-yd-tile--on' : '') + (tile.count ? '' : ' nx-yd-tile--zero');
    }

    tileNote(tile) { return tile.count ? 'on ' + this.plural(tile.requests, 'request') : tile.hint; }

    rowClass(it, openId) { return 'nx-yd-row' + (String(openId) === String(it.id) ? ' nx-yd-row--open' : ''); }

    whenClass(it) { return 'nx-yd-when' + (it.late > 0 ? ' nx-late' : ''); }

    nextClass(next) { return 'nx-yd-next nx-yd-next--' + ((next && next.where) || 'none'); }

    compactLine(it) {
      return [it.yardText && it.yardText !== '—' ? 'To ' + it.yardText : '', it.next ? it.next.text : ''].filter((x) => !!x).join(' · ');
    }

    // ── The open request ─────────────────────────────────────────────────────────────────────────────────────
    subline(req) { return [req && req.party, req && req.task].filter((x) => !!x).join(' · '); }

    ticked(ticks, lineId) { return (ticks || []).map(String).indexOf(String(lineId)) !== -1; }

    receivable(line) { return yw.isReceivable(line); }

    allTicked(lines, ticks) { return yw.allTicked(lines, ticks, yw.isReceivable); }

    toReceive(lines, ticks) { return yw.toReceive(lines, ticks).length; }

    /** Pieces by where they are on the way back: { site, overdue, requested, requestedStock, requestedFm, transit, receive, done }. */
    counts(lines, end) {
      const list = Array.isArray(lines) ? lines : [];
      const t = fmt.today();
      const at = (s) => list.filter((l) => yw.IN[String(l.lineStatus || '').toUpperCase()] === s);
      const site = at('site');
      const requested = at('requested');
      return {
        site: site.length,
        overdue: site.filter((l) => { const e = fmt.dayMs(l.end || end); return e != null && t > e; }).length,
        requested: requested.length,
        requestedStock: requested.filter((l) => !l.isFAndM).length,
        requestedFm: requested.filter((l) => l.isFAndM).length,
        transit: at('transit').length,
        receive: at('receive').length,
        done: at('done').length,
      };
    }

    current(lines, end) {
      const c = this.counts(lines, end);
      if (c.receive) return 'receive';
      if (c.requested) return 'requested';
      if (c.transit) return 'transit';
      return c.site ? 'site' : '';
    }

    stepClass(key, lines, end) { return 'nx-yd-step' + (this.current(lines, end) === key ? ' nx-yd-step--current' : ''); }

    /** "Due back 15 Sep (45 days overdue)" for the pieces still on site. */
    dueText(req, lines) {
      const c = this.counts(lines, req && req.end);
      const d = fmt.date(req && req.end);
      if (!d) return '';
      return 'Due back ' + d + (c.overdue ? ' (' + this.plural(Math.round((fmt.today() - fmt.dayMs(req.end)) / 86400000), 'day') + ' overdue)' : '');
    }

    inboundTOs(lines) {
      const seen = [];
      (Array.isArray(lines) ? lines : []).forEach((l) => {
        if (yw.IN[String(l.lineStatus || '').toUpperCase()] === 'transit' && l.toNumber && seen.indexOf(l.toNumber) === -1) seen.push(l.toNumber);
      });
      return seen.join(', ');
    }

    /** The lines to show: shipped back to the yard first, then on the way, still on site, closed last (New's order). */
    lineRows(lines) {
      const ORDER = { receive: 0, transit: 1, requested: 1, site: 2, done: 4 };
      const rank = (l) => { const s = yw.IN[String(l.lineStatus || '').toUpperCase()]; return ORDER[s] != null ? ORDER[s] : 3; };
      return (Array.isArray(lines) ? lines : []).map((l, i) => ({ l, i, s: rank(l) })).sort((a, b) => (a.s - b.s) || (a.i - b.i)).map((x) => x.l);
    }

    lineLabel(status, external) { return Progress.line(status, !!external).label || '—'; }

    lineTone(status, external) { return Progress.line(status, !!external).stage || 'ready'; }

    lineFacts(line) {
      return [line.equipmentClass, line.isFAndM ? 'Fixed asset' : '', line.toNumber ? 'Transfer order ' + line.toNumber : ''].filter((x) => !!x).join(' · ');
    }

    conditionNote(line) {
      return line && line.condition && line.condition !== 'GOOD' ? 'Unit flagged ' + String(line.condition).toLowerCase() + ': check it before it goes back to stock.' : '';
    }

    bannerClass(b) { return 'nx-yd-banner nx-yd-banner--' + ((b && b.type) || 'info'); }

    todayIso() { return new Date().toISOString().slice(0, 10); }

    // ── A unit back without notice ───────────────────────────────────────────────────────────────────────────
    foundTicked(ticks, key) { return (ticks || []).indexOf(key) !== -1; }

    foundSelected(found, ticks) { return (found || []).filter((r) => (ticks || []).indexOf(r.rowKey) !== -1); }

    allFixedAssets(found, ticks) { return yw.allFixedAssets(this.foundSelected(found, ticks)); }

    stockTicked(found, ticks) { return this.foundSelected(found, ticks).filter((r) => String(r.fulfilmentClass || '').toUpperCase() !== 'F_AND_M').length; }

    unitLabel(row) { return dr.unitLabel(row) || '—'; }

    foundFacts(row) {
      return [row.requestNumber, row.partyName, row.endDate ? 'due back ' + fmt.date(String(row.endDate).slice(0, 10)) : '', row.yardOrgName]
        .filter((x) => !!x).join(' · ');
    }

    /** "2 matches", "Showing 50 of 164 matches…", "Type at least 2 characters." */
    foundSummary(meta, found) {
      const m = meta || {};
      if (!m.searched) return '';
      if (m.tooShort) return 'Type at least 2 characters.';
      if (m.error) return 'The search failed. Try again.';
      const shown = (found || []).length;
      if (!shown) return 'No equipment out in the field matches that.';
      return shown < m.recordCount ? 'Showing ' + shown + ' of ' + m.recordCount + ' matches: narrow the search to see the rest.'
        : this.plural(shown, 'match', 'matches');
    }
  }

  return PageModule;
});
