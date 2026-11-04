define(['resources/js/exportKit', 'resources/js/equipment360', 'resources/js/equipmentRedwood'], (exportKit, e3, rw) => {
  'use strict';

  // Everything about a piece of equipment: binding helpers. The logic is resources/js/equipment360.js.
  class PageModule {
    /** The export menu's formats. */
    formats() { return exportKit.FORMATS; }

    /** What the timeline's colours mean (Availability's legend). */
    legend() { return e3.legend(); }

    /** The quick windows. */
    presets() { return e3.PRESETS; }

    /** An array, or an empty one (no array literals in bindings). */
    arr(a) { return Array.isArray(a) ? a : []; }

    /** The master's picture: a full URL as it is, a path inside the app after the app's own path. */
    imageSrc(raw, appPath) {
      if (!raw) return '';
      return /^(https?:|data:)/.test(raw) ? raw : (appPath || '') + raw;
    }

    /** "Units (3)", "The unit". */
    unitsTitle(mode, n) { return mode === 'unit' ? 'The unit' : 'Units (' + (n || 0) + ')'; }

    /** A unit's state in the window, as a pill (Availability's colours). */
    stateClass(state) { return 'nx-av-state nx-av-state--' + (state || 'free'); }

    /** The history's heading count. */
    histTitle(hist, hv) {
      const all = hist && Array.isArray(hist.events) ? hist.events.length : 0;
      const shown = hv && Array.isArray(hv.rows) ? hv.rows.length : 0;
      return 'History (' + (shown === all ? all : shown + ' of ' + all) + ')';
    }

    /** Planned maintenance from Fusion, in words, under the window. */
    maintNote(maint) {
      if (maint === 'loading') return ' Planned maintenance from Fusion is still loading: free counts may still drop.';
      if (maint === 'partial') return ' Planned maintenance could not be read for every unit.';
      return '';
    }

    /**
     * Keeps the date boxes showing the window after a quick window: once a person has typed in a native input, its
     * value attribute no longer drives what it shows. A box already showing the value is left alone.
     */
    syncDates(uid, from, to) {
      [['e3From-' + uid, from], ['e3To-' + uid, to]].forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el && el.value !== (value || '')) el.value = value || '';
      });
    }

    // ── Redwood (your menu): Oracle's general overview page as the header ─────────────────────────────────────
    /**
     * Its subtitle: what the current look's head says under the name, in one line (a unit: its equipment and class,
     * its yard; an item: its class, its units and where, what they are doing), then its facts. Oracle's header keeps
     * it to one line, so a unit's "now" is left to its badge and the units below.
     */
    rwSub(head, isLoading) {
      const h = head || {};
      if (!h.title) return isLoading ? 'Reading the equipment, its units and its bookings…' : '';
      const lead = h.mode === 'unit' ? ['Unit', h.sub, h.where] : [h.kicker, h.sub, h.where];
      return lead.concat(this.arr(h.facts)).filter((x) => !!x).join(' · ');
    }

    /** Its badge: what a unit is doing today (the pill beside the current look's title). */
    rwBadge(now) { return rw.nowBadge(now); }

    /** Its primary action: Open in Availability, once the equipment is read (the same object while it reads the same). */
    rwPrimary(title) { return rw.kept({ label: 'Open in Availability', icon: 'oj-ux-ico-calendar', display: title ? 'on' : 'disabled' }); }

    /** Its other actions (rwActionChain): Refresh, and the history or the units as Excel (as the Export menu). */
    rwActions() {
      return rw.kept([
        { id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: 'on' },
        { id: 'history', label: 'Export the history', icon: 'oj-ux-ico-download', display: 'on' },
        { id: 'units', label: 'Export the units', icon: 'oj-ux-ico-download', display: 'on' }
      ]);
    }

    /** In-flow back: from a unit to every unit of its equipment (the current look's "All units of this equipment"). */
    rwBack(head) { return !!(head && head.mode === 'unit' && head.equipmentId); }
  }

  return PageModule;
});
