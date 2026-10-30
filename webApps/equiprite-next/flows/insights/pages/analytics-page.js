define([
  'resources/js/exportKit',
  'resources/js/insightsModel',
  'resources/js/fmt',
  'resources/js/nav',
], (exportKit, model, fmt, nav) => {
  'use strict';

  // Analytics: binding helpers. The logic is resources/js/insightsModel.js. No helper uses `this`: a binding may call
  // one detached from the module.
  function tileOn(f, report, tile) {
    const x = (f || {})[report] || {};
    return !!tile && !!tile.field && String(x[tile.field]) === String(tile.key);
  }

  class PageModule {
    formats() { return exportKit.FORMATS; }

    periods() { return model.PERIODS; }

    /** The other reports and where each one opens, for this role. */
    more(canAnalytics, canReports, canIntegrations) {
      return model.MORE.filter((m) => {
        if (m.where === 'next') return canIntegrations;
        if (m.where === 'old') return canReports;
        return canAnalytics;
      });
    }

    notYet() { return model.NOT_YET; }

    /** The address of another report: New EquipRite's Analytics on that report, or Old EquipRite's Reports page. */
    moreLink(item, urls) {
      const u = urls || {};
      if (!item) return '';
      if (item.where === 'new') {
        const base = nav.newUrl(u.new, 'analytics');
        return base ? base + '?report=' + encodeURIComponent(item.report) : '';
      }
      if (item.where === 'old') {
        return u.old ? (u.old.slice(-1) === '/' ? u.old : u.old + '/') + 'vp/shell/equipment-foundation/equipment-reports' : '';
      }
      return '';
    }

    /** "Open in New EquipRite" / "Open in Old EquipRite". */
    moreWhere(item) {
      return item && item.where === 'old' ? 'Old EquipRite' : 'New EquipRite';
    }

    /** New EquipRite's Post costs, where cost goes to Fusion (not part of Next). */
    postCostsLink(urls) { return nav.newUrl((urls || {}).new, 'costs'); }

    /** Is a tile's filter the one picked? */
    tileOn(f, report, tile) { return tileOn(f, report, tile); }

    /** CSS class of a tile. */
    tileClass(f, report, tile) {
      return 'nx-kpi nx-an-kpi nx-an-tone--' + ((tile && tile.tone) || 'total') + (tileOn(f, report, tile) ? ' nx-an-kpi--on' : '');
    }

    pressed(on) { return on ? 'true' : 'false'; }

    date(v) { return fmt.date(v); }

    money(v) { return fmt.money(v) || '–'; }

    /** "Loading the fleet…" for the tab being opened. */
    loadingText(reports, key) {
      const r = (reports || []).filter((x) => x.key === key)[0];
      return 'Loading ' + (r ? r.label.toLowerCase() : 'the report') + '…';
    }

    question(reports, key) {
      const r = (reports || []).filter((x) => x.key === key)[0];
      return r ? r.question : '';
    }
  }

  return PageModule;
});
