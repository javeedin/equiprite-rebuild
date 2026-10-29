define(['resources/js/requestLineBody'], (lineBody) => {
  'use strict';

  // New request (wireframes: New request: equipment selection / project and review). Three steps on one page:
  //   1 Equipment  dates first, because availability and the estimate on every card use them
  //   2 Project    project, task, customer, contract and delivery address
  //   3 Review     lines, per-line dates and notes, total, Save draft / Submit for approval
  // The values posted are the old create page's (NavigateToCatalogChain → SubmitRequestChain, INTERNAL path);
  // buildDetail below is that chain's ActiveRequestDetail snapshot.

  const STEPS = [
    { n: 1, label: 'Equipment' },
    { n: 2, label: 'Project' },
    { n: 3, label: 'Review & submit' },
  ];

  const d10 = (v) => (v ? String(v).slice(0, 10) : '');
  const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
  const isConsumable = (it) => !!it && (it.isConsumable === true || it.isRentable === false
    || String(it.billingUnit || '').toUpperCase() === 'EACH');
  const NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };
  const noun = (t) => { const u = String(t || '').trim().toUpperCase(); return NOUNS[u] || u; };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function money(n) {
    if (n == null || isNaN(Number(n))) {
      return '—';
    }
    const v = Number(n);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  function day(v) {
    const s = d10(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return '';
    }
    return Number(s.slice(8, 10)) + ' ' + MONTHS[Number(s.slice(5, 7)) - 1];
  }

  class PageModule {
    /** A blank form in the shape of the old flow's $flow.variables.request (requestModel), INTERNAL. */
    emptyForm(requestorName, requestorUsername) {
      return {
        requestType: 'INTERNAL',
        requestorId: null, requestorName: requestorName || '', requestorUsername: requestorUsername || '',
        projectId: null, projectNumber: '', projectName: '', projectBuId: null, projectBuName: '',
        taskId: null, taskNumber: '', taskName: '',
        customerId: null, customerName: '',
        contractId: null, contractNumber: '',
        locationType: 'DELIVERY_LOCATION', location: '', deliveryInvOrgId: null, deliveryLocationId: null,
        locationLatitude: null, locationLongitude: null,
        startDate: '', endDate: '', hours: null, notes: '', isSoftReservation: false,
      };
    }

    /** The step tracker: [{ n, label, state: done | current | todo }]. */
    steps(step) {
      const cur = Number(step) || 1;
      return STEPS.map((s) => ({ n: s.n, label: s.label, state: s.n < cur ? 'done' : (s.n === cur ? 'current' : 'todo') }));
    }

    /** Rental days, both ends counted (the line builder's rule). */
    days(start, end) {
      return lineBody.rentalDays(d10(start), d10(end));
    }

    /**
     * Estimated cost of one cart line over its own window, exactly as requestLineBody.build stores estimatedCost:
     * qty × daily rate × days for a rentable, qty × unit price for a consumable, null while a quote is pending.
     */
    lineCost(item, start, end, hideRates) {
      if (!item || hideRates) {
        return null;
      }
      const qty = Number(item.quantity) || 1;
      const rate = Number(item.billingRate) || 0;
      if (isConsumable(item)) {
        return lineBody.round2(qty * rate);
      }
      const n = this.days(item.startDate || start, item.endDate || end);
      return n > 0 ? lineBody.round2(qty * rate * n) : null;
    }

    /** The rail and review totals: { lines, units, total, priced }. Unpriced lines (no rate, no days) are left out. */
    cartSummary(cart, start, end, hideRates) {
      const list = Array.isArray(cart) ? cart : [];
      let total = 0;
      let priced = 0;
      let units = 0;
      list.forEach((it) => {
        units += Number(it.quantity) || 0;
        const c = this.lineCost(it, start, end, hideRates);
        if (c != null && Number(it.billingRate) > 0) {
          total += c;
          priced += 1;
        }
      });
      return { lines: list.length, units, total: lineBody.round2(total), priced };
    }

    /** The price as the business quotes it ($3,200 / WEEK, $25 / unit) for a catalog row or a cart item. */
    rateText(x, hideRates) {
      if (!x) {
        return '';
      }
      if (hideRates) {
        return 'Rate on request';
      }
      if (x.billingRate !== undefined) {
        if (isConsumable(x)) {
          return money(x.billingRate) + ' / unit';
        }
        if (x.periodAmount != null && x.periodUom) {
          return money(x.periodAmount) + ' / ' + noun(x.periodUom);
        }
        return Number(x.billingRate) > 0 ? money(x.billingRate) + ' / ' + noun(x.billingUnit || 'DAY') : 'No rate';
      }
      if (x.isRentable === false) {
        return x.unitPrice != null ? money(x.unitPrice) + ' / unit' : 'Unit price not set';
      }
      if (x.rate == null) {
        return 'Rate on request';
      }
      if (x.periodAmount == null) {
        return money(x.rate) + (x.rateUom ? ' / ' + noun(x.rateUom) : '');
      }
      return money(x.periodAmount) + (x.periodType ? ' / ' + noun(x.periodType) : '');
    }

    /** "Est. $38,400 for 26 days" on a card, for one unit; empty without dates, a price or when unavailable. */
    cardEstimate(row, start, end, hideRates) {
      if (!row || hideRates || this.availability(row).key === 'none') {
        return '';
      }
      if (row.isRentable === false) {
        return row.unitPrice != null ? 'Est. ' + money(row.unitPrice) + ' each' : '';
      }
      const n = this.days(start, end);
      if (row.rate == null || n <= 0) {
        return '';
      }
      return 'Est. ' + money(lineBody.round2(Number(row.rate) * n)) + ' for ' + n + (n === 1 ? ' day' : ' days');
    }

    /** The availability badge: { key: ok | part | none | unknown, label }. No dates → unknown (browse mode). */
    availability(row) {
      const s = String((row && row.availabilityStatus) || '').toUpperCase();
      const qty = row && row.availableQty != null ? Number(row.availableQty) : null;
      if (!s) {
        return { key: 'unknown', label: 'Pick dates to check' };
      }
      if (s === 'AVAILABLE') {
        return { key: 'ok', label: qty != null ? 'Available · ' + qty : 'Available' };
      }
      if (s === 'NOT AVAILABLE') {
        return { key: 'none', label: 'Not available' };
      }
      if (s === 'PARTIAL QUANTITY') {
        return { key: 'part', label: 'Partial: ' + (qty != null ? qty + ' free' : 'some free') };
      }
      if (s === 'PARTIAL DURATION') {
        return { key: 'part', label: 'Partial: part of the dates' };
      }
      return { key: 'part', label: s.charAt(0) + s.slice(1).toLowerCase() };
    }

    /** Class chips with counts, "All equipment" first, then by name. */
    classChips(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const counts = {};
      list.forEach((r) => {
        const c = r.className || 'Other';
        counts[c] = (counts[c] || 0) + 1;
      });
      return [{ key: 'all', label: 'All equipment', count: list.length }]
        .concat(Object.keys(counts).sort((a, b) => a.localeCompare(b)).map((c) => ({ key: c, label: c, count: counts[c] })));
    }

    /** The cards shown: class, availability (ok = available or partial) and free text over name and class. */
    filterCatalog(rows, text, cls, avail) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(rows) ? rows : []).filter((r) => {
        if (cls && cls !== 'all' && (r.className || 'Other') !== cls) {
          return false;
        }
        if (avail === 'free' && ['ok', 'part'].indexOf(this.availability(r).key) === -1) {
          return false;
        }
        if (!q) {
          return true;
        }
        return [r.equipmentName, r.className, r.subclassName, r.equipmentDescription]
          .some((v) => v && String(v).toLowerCase().includes(q));
      });
    }

    /** Tasks matching the filter text (number or name), at most 30 so a big WBS stays readable. */
    taskMatches(tasks, text) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(tasks) ? tasks : [])
        .filter((t) => !q || [t.TaskNumber, t.TaskName].some((v) => v && String(v).toLowerCase().includes(q)))
        .slice(0, 30);
    }

    /** Quantity of one equipment already in the cart (0 when not there). */
    qtyIn(cart, id) {
      const it = (Array.isArray(cart) ? cart : []).find((c) => Number(c.id) === Number(id));
      return it ? Number(it.quantity) || 0 : 0;
    }

    /**
     * What is missing before leaving a step, as labels. Step 1 needs the dates and equipment; step 2 the fields
     * the old create page required for an INTERNAL request (customer, delivery location, project, task). 'draft'
     * checks what a draft needs (equipment and dates); 'submit' checks everything.
     */
    missingFor(step, form, cart) {
      const f = form || {};
      const out = [];
      const all = step === 'submit';
      if (step === 1 || step === 'draft' || all) {
        if (!f.startDate) out.push('Start date');
        if (!f.endDate) out.push('End date');
        if (f.startDate && f.endDate && d10(f.endDate) < d10(f.startDate)) out.push('End date on or after the start date');
        if (!(Array.isArray(cart) && cart.length)) out.push('At least one piece of equipment');
      }
      if (step === 2 || all) {
        if (!f.projectId) out.push('Project');
        if (!f.taskId) out.push('Task');
        if (f.customerId == null || f.customerId === '') out.push('Customer');
        if (!String(f.location || '').trim()) out.push('Delivery location');
      }
      if (all) {
        (Array.isArray(cart) ? cart : []).forEach((it) => {
          const s = d10(it.startDate || f.startDate);
          const e = d10(it.endDate || f.endDate);
          if (s && e && e < s) out.push('Dates of ' + (it.name || 'a line'));
        });
      }
      return out;
    }

    /**
     * The ActiveRequestDetail snapshot NavigateToCatalogChain takes for an INTERNAL request; requestHeaderBody and
     * requestLineBody read it (detail.* after request.*), so a request from here posts what the old page posts.
     */
    buildDetail(form) {
      const f = form || {};
      return {
        requestorId: f.requestorId != null ? f.requestorId : null,
        requestorName: f.requestorName || '',
        location: f.location || '',
        locationType: f.locationType || null,
        deliveryInvOrgId: num(f.deliveryInvOrgId),
        deliveryLocationId: num(f.deliveryLocationId),
        requestedStartDate: f.startDate || null,
        requestedEndDate: f.endDate || null,
        hours: num(f.hours),
        projectId: f.projectId,
        projectNumber: f.projectNumber || '',
        projectName: f.projectName || '',
        projectBuId: f.projectBuId != null ? f.projectBuId : null,
        projectBuName: f.projectBuName || '',
        taskId: f.taskId,
        taskNumber: f.taskNumber || '',
        taskName: f.taskName || '',
        customerRefId: null,
        customerName: '',
        internalCustomerId: f.customerId != null && f.customerId !== '' ? f.customerId : null,
        internalCustomerName: f.customerName || '',
        contractId: f.contractId != null && f.contractId !== '' ? f.contractId : null,
        contractNumber: f.contractNumber || '',
        notes: f.notes || '',
        isSoftReservation: false,
      };
    }

    money(n) {
      return money(n);
    }

    /** "2 Nov – 15 Dec · 44 days", or a prompt when the dates are not set yet. */
    windowText(start, end) {
      if (!start || !end) {
        return 'Pick the dates';
      }
      const n = this.days(start, end);
      return day(start) + ' – ' + day(end) + (n > 0 ? ' · ' + n + (n === 1 ? ' day' : ' days') : '');
    }

    day(v) {
      return day(v);
    }

    /** First letters of the class name for the card's picture box when the row has no image. */
    initials(name) {
      return String(name || '').split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase()).join('') || '?';
    }

    /** An image src the card can use: absolute and data: URIs as they are, app-relative ones under the app path. */
    imageSrc(raw, appPath) {
      if (!raw) {
        return '';
      }
      return /^(https?:|data:)/.test(raw) ? raw : (appPath || '') + raw;
    }
  }

  return PageModule;
});
