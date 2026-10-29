define([], () => {
  'use strict';

  // New / edit rental agreement (FDD 7.3A.1–7.3A.3; replaces rental-agreement-create). Header and lines on one
  // page; Save writes them as the old page's saveAgreementChain did. The old page also asked for business unit,
  // customer type, account, contact, billing frequency and payment terms, but saved none of them, so they are left
  // out here rather than collected and dropped.

  const UOMS = [{ value: 'HOUR', label: 'Hour' }, { value: 'DAY', label: 'Day' }, { value: 'WEEK', label: 'Week' }, { value: 'MONTH', label: 'Month' }];
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD'];
  const txt = (v) => (v == null ? '' : String(v));

  function money(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    const v = Number(n);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  class PageModule {
    /**
     * The old saveAgreementChain's collectMissingFields: every missing required field at once (name, type,
     * customer, start, end), so one Save attempt reports all of them.
     */
    missingFields(formData) {
      const f = formData || {};
      const missing = [];
      if (!f.agreementName || !String(f.agreementName).trim()) missing.push('Agreement Name');
      if (!f.agreementType) missing.push('Agreement Type');
      if (!f.customerId)    missing.push('Customer');
      if (!f.startDate)     missing.push('Start Date');
      if (!f.endDate)       missing.push('End Date');
      return missing;
    }

    /** End before start is not caught by the old page; it is shown here but does not block Save (same calls). */
    datesBackwards(formData) {
      const f = formData || {};
      return !!(f.startDate && f.endDate && String(f.endDate).slice(0, 10) < String(f.startDate).slice(0, 10));
    }

    /**
     * The old addAgreementLineChain's checks for a draft line: a class, a rate above 0, and not the same equipment
     * twice. Returns '' or the message the old chain showed.
     */
    lineProblem(draft, lines) {
      const d = draft || {};
      if (!d.classId) return 'Please select an Equipment Class before adding a line.';
      if (d.unitPrice == null || d.unitPrice === '' || Number(d.unitPrice) <= 0) return 'Rate must be greater than 0.';
      if (d.equipmentMasterId != null && (lines || []).some((l) => Number(l.equipmentMasterId) === Number(d.equipmentMasterId))) {
        return 'This equipment is already on the agreement. The same equipment cannot be added twice.';
      }
      return '';
    }

    /** max(existing line numbers) + 1 (UK_EQR_AGR_LINE_NUM; numbers can have gaps), as the old chain did. */
    nextLineNumber(lines) {
      const nums = (lines || []).map((l) => Number(l.lineNumber) || 0);
      return (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    }

    uoms() { return UOMS; }
    currencies() { return CURRENCIES; }
    money(n) { return money(n); }

    uomLabel(v) {
      const o = UOMS.find((u) => u.value === v);
      return o ? o.label.toLowerCase() : txt(v).toLowerCase();
    }

    /** What Save will write, before the click. */
    saveText(isEdit, lines, deletedIds) {
      const n = (lines || []).length;
      const fresh = (lines || []).filter((l) => !l.lineId).length;
      const del = (deletedIds || []).length;
      if (!isEdit) return 'Creates the agreement as a draft with ' + n + (n === 1 ? ' line' : ' lines') + '; it is used once approved.';
      const parts = ['updates the header'];
      if (del) parts.push('removes ' + del + (del === 1 ? ' line' : ' lines'));
      if (n - fresh) parts.push('updates ' + (n - fresh) + (n - fresh === 1 ? ' line' : ' lines'));
      if (fresh) parts.push('adds ' + fresh + (fresh === 1 ? ' line' : ' lines'));
      return 'Save ' + parts.join(', ') + '.';
    }
  }

  return PageModule;
});
