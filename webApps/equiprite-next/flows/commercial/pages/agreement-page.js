define(['resources/js/agreementRules', 'resources/js/exportKit', 'resources/js/fmt', 'resources/js/commercialRedwood'], (A, exportKit, fmt, RW) => {
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

    // ── the Redwood look (your menu, Look): Oracle's general overview header (as Old's rental-agreement-lines and
    //    rental-agreement-create pages) over this tab's own body; its actions are Current's head's (rwChain) ──
    /** The header shows where Current's head shows: the agreement once read, or its form. */
    rwHidden(look, mode, headerId, loadError, unavailable) {
      return look !== 'redwood' || !!unavailable || (mode !== 'edit' && (!headerId || !!loadError));
    }
    rwTitle(mode, name, number, form, loaded) {
      if (mode === 'edit') return (form && form.agreementName) || (loaded ? loaded.agreementNumber : 'New agreement');
      return name || number || 'Agreement';
    }
    /** The kicker (Rental agreement, its type) and the line under the title (number, customer, dates, when it ends). */
    rwSubtitle(mode, type, number, customer, from, to, status, loaded) {
      if (mode === 'edit') {
        return loaded ? 'Edit agreement · ' + loaded.agreementNumber + ' · Changes are kept here until you save.'
          : 'New agreement · Saved as a draft; it is used once approved.';
      }
      return ['Rental agreement' + (type ? ' · ' + type : ''), number, customer, fmt.range(from, to),
        A.expiryText({ statusCode: String(status || '').toUpperCase(), endDate: to })].filter((x) => !!x).join(' · ');
    }
    /** Its status as the header's badge (none on the form). */
    rwBadge(mode, status) { return mode === 'edit' ? { text: '' } : RW.agreementBadge(status); }
    /** The white button on the band: Approve (until it is decided; it needs a line), or Save on the form. */
    rwPrimary(mode, canWrite, status, busy, lineCount, saving, loaded) {
      if (mode === 'edit') {
        return { label: saving ? 'Saving…' : (loaded ? 'Save agreement' : 'Create agreement'), icon: 'oj-ux-ico-save', display: saving ? 'disabled' : 'on' };
      }
      if (!canWrite || !A.canDecide(status)) return { label: 'Approve', display: 'off' };
      return { label: 'Approve', icon: 'oj-ux-ico-check', display: busy || !lineCount ? 'disabled' : 'on' };
    }
    /** The header's other actions: Current's head's buttons (Reject, Edit, Export, Refresh), or the form's Cancel. */
    rwActions(mode, canWrite, status, busy, loaded) {
      if (mode === 'edit') return [{ id: 'cancel', label: loaded ? 'Cancel' : 'Close', icon: 'oj-ux-ico-close', display: 'on' }];
      const out = [];
      if (canWrite && A.canDecide(status) && !busy) out.push({ id: 'reject', label: 'Reject', icon: 'oj-ux-ico-close', display: 'on' });
      if (canWrite && A.canEdit(status)) out.push({ id: 'edit', label: 'Edit', icon: 'oj-ux-ico-edit', display: 'on' });
      out.push({ id: 'export', label: 'Export the lines', icon: 'oj-ux-ico-download', display: 'on' });
      if (!busy) out.push({ id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: 'on' });
      return out;
    }
  }

  return PageModule;
});
