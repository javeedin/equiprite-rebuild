define([
  'resources/js/equipmentImport',
  'resources/js/equipmentMaster',
  'resources/js/exportKit',
], (EquipmentImport, em, exportKit) => {
  'use strict';

  // Equipment master: binding helpers. The list's logic is resources/js/equipmentMaster.js; the functions the Sync and
  // Import chains call (New EquipRite's, unchanged) come from resources/js/equipmentImport.js, which this extends.
  class PageModule extends EquipmentImport {
    /** The export menu's formats. */
    formats() { return exportKit.FORMATS; }

    /** Sort arrow for a column header. */
    sortMark(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''; }

    /** aria-sort for a column header. */
    ariaSort(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'; }

    /** "Fetched from Fusion 28 Oct 2026 22:00 · synced …". */
    fusionLine(lastRuns) { return em.fusionLine(lastRuns); }

    dotStyle(p) { return em.dotStyle(p); }

    /** The map's note: what is placed, what has no location, what a bubble does. */
    mapNote(map) {
      const m = map || {};
      return [m.placed + (m.placed === 1 ? ' item' : ' items') + ' placed by their location',
        m.unplaced ? m.unplaced + ' with no location on record' : '', 'pick a location to list its items'].filter(Boolean).join(' · ');
    }

    /** The name of the map's picked location, for its chip. */
    locationName(id, locationsById) {
      if (!id) return '';
      return id === 'none' ? 'No location on record' : ((locationsById || {})[id] || 'Location ' + id);
    }

    /** Under an item's name: "EQ-2201 · Caterpillar 320 GC". */
    itemSub(it) { return [it && it.num, it && it.maker].filter((x) => !!x).join(' · '); }

    /** "From Fusion" / "Added in EquipRite". */
    sourceWords(source) { return em.sourceWords(source); }

    /** What the search is doing besides the list's own matches. */
    searchNote(text, server, searching) {
      const q = em.serverQuery(text);
      if (!q) return '';
      if (searching) return 'Looking through serial numbers and unit locations too…';
      if (server && server.q === q && server.failed) {
        return 'Serial numbers could not be searched just now; these match the number, name, class or location.';
      }
      return '';
    }

    /** Under an item only the server found. */
    whyText(text) { return 'A serial number or unit location matches "' + String(text || '').trim() + '"'; }

    /** How many filters the Filters button counts (status, tracking, source, asset group). */
    moreOn(v) { return ['status', 'tracking', 'source', 'assetGroupId'].filter((k) => !!(v && v[k])).length; }

    /** Is anything narrowing the list (for Clear filters)? */
    anyFilter(v) { return !!(v && (v.text || v.location || em.filtersOn(v, v.assetGroupId))); }

    /** "4 items, as shown" or "2 fetched items on this page", under the export formats. */
    exportNote(v) {
      if (v.view === 'import') {
        const n = (v.stagingArray || []).length;
        return n + (n === 1 ? ' fetched item' : ' fetched items') + ' on this page';
      }
      const n = (v.shown || []).length;
      return n + (n === 1 ? ' item' : ' items') + ', as shown';
    }

    /** The Sync result's tone class. */
    resultTone(result) {
      const t = result && result.type;
      return 'nx-eqm-result nx-eqm-result--' + (t === 'error' ? 'bad' : (t === 'warning' ? 'warn' : 'ok'));
    }

    /** The Fetch button's words. */
    fetchLabel(isImporting, itemClass) {
      if (isImporting) return 'Fetching…';
      return itemClass ? 'Fetch item class ' + itemClass : 'Fetch all items';
    }

    /** The Import button's words. */
    importLabel(saving, ticked) {
      if (saving) return 'Importing…';
      return ticked > 0 ? 'Import ' + ticked + (ticked === 1 ? ' item' : ' items') : 'Import';
    }

    /** "Give the 3 ticked rows one class". */
    bulkLabel(ticked) { return 'Give the ' + ticked + ' ticked row' + (ticked === 1 ? '' : 's') + ' one class'; }

    /** The Fetch card's line: Fetch's own (Sync's stock step writes the same line while it runs). */
    fetchLine(message, phase) { return phase === 'SYNC' ? '' : (message || ''); }
  }

  return PageModule;
});
