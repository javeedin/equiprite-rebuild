define(['resources/js/agreementRules', 'resources/js/exportKit', 'resources/js/fmt'], (A, exportKit, fmt) => {
  'use strict';

  // An agreement's tab: binding helpers. The rules are resources/js/agreementRules.js (New EquipRite's, unchanged).
  class PageModule {
    formats() { return exportKit.FORMATS; }
    statusLabel(code) { return A.statusLabel(code); }
    tone(code) { return 'nx-cm-st--' + A.tone(code); }
    range(a, b) { return fmt.range(a, b) || '—'; }
    money(n, currency) { return n == null || n === '' || isNaN(Number(n)) ? '—' : fmt.money(n, currency || 'USD'); }
    canEdit(status) { return A.canEdit(status); }
    canDecide(status) { return A.canDecide(status); }
    canRequest(status) { return A.canRequest(status); }
    expiryText(status, end) { return A.expiryText({ statusCode: String(status || '').toUpperCase(), endDate: end }); }
    nextStep(status, end, lines) { return A.nextStep(status, end, lines); }

    /** "Agreement RNT-0002 · Lone Star Paving · 1 Jan – 15 Dec 2026". */
    subline(number, customer, from, to) { return [number, customer, fmt.range(from, to)].filter((x) => !!x).join(' · '); }

    // ── lines ──
    visibleLines(lines, text, limit) { return A.filterLines(lines, text).slice(0, Number(limit) || A.SHOW_STEP); }
    shownCount(lines, text) { return A.filterLines(lines, text).length; }
    rateText(line) { return A.rateText(line); }
    fromSchedule(line) { return !(line && Number(line.bill_rate) > 0); }
    lineSub(line) { return [line && line.class_name, line && line.subClassName].filter((x) => x && x !== '—').join(' · '); }
    canTick(idMap, key) { return !!(idMap || {})[key]; }
    isSelected(selected, key) { return !!(selected || {})[key]; }
    selectedCount(selected) { return A.selectedCount(selected); }
    allShownSelected(selected, lines, text, idMap) { return A.allShownSelected(selected, lines, text, idMap); }
    requestPreview(selected, lines, idMap) { return A.requestPreview(selected, lines, idMap); }
    createLabel(selected) {
      const n = A.selectedCount(selected);
      return n > 0 ? 'Create request from ' + n + (n === 1 ? ' line' : ' lines') : 'Create request';
    }

    // ── edit ──
    uoms() { return A.UOMS; }
    currencies() { return A.CURRENCIES; }
    uomLabel(v) { return A.uomLabel(v); }
    datesBackwards(form) { return A.datesBackwards(form); }
    saveText(isEdit, lines, deleted) { return A.saveText(isEdit, lines, deleted); }
    missingText(missing) { return (missing || []).length ? 'Fill in: ' + missing.join(', ') + '.' : ''; }
    editLineTitle(l) { return l ? (l.equipmentName && l.equipmentName !== '—' ? l.equipmentName : (l.description || 'Any equipment in the class')) : ''; }
    editLineSub(l) { return [l && l.equipmentClassName, l && l.equipmentSubclassName].filter((x) => x && x !== '—').join(' · '); }
  }

  return PageModule;
});
