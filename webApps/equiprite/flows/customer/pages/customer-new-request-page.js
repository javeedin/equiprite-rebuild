define(['resources/js/requestLineBody', 'resources/js/requestModel', 'resources/js/rentalTerms', 'resources/js/customerPortal'],
  (lineBody, requestModel, terms, portal) => {
  'use strict';

  // New request, customer variant (replaces customer-create-req, request-catalog and request-cart for customers).
  // A copy of New EquipRite's flows/request/pages/new-request-page.js with what an EXTERNAL request needs instead of
  // the project parts:
  //   1 Equipment     dates first, the catalog with availability and the estimate, the cart (unchanged)
  //   2 Your details  customer, contact, delivery address and notes: the old customer-create-req form's fields
  //   3 Review        lines, per-line dates and notes, total, the rental terms to accept, Submit / Save draft
  // buildDetail and buildRequest below are the two objects the old CreateRequestNextChain hands the cart
  // (ActiveRequestDetail and $flow.variables.request), so the shared requestHeaderBody / requestLineBody builders post
  // exactly what the old customer cart posts.

  const STEPS = [
    { n: 1, label: 'Equipment' },
    { n: 2, label: 'Your details' },
    { n: 3, label: 'Review & submit' },
  ];

  const d10 = (v) => (v ? String(v).slice(0, 10) : '');
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
    /**
     * A blank customer request. The fields are customer-create-req's formData: customerRefId / customerName (the
     * EQR_CUSTOMER_REF customer), requestorId / requestorName (the EQR_CUSTOMER_PORTAL_USER contact), dates,
     * location and notes. No project, task, contract, site or hours: the old customer form has none.
     */
    emptyForm() {
      return {
        requestType: 'EXTERNAL',
        customerRefId: null, customerName: '',
        requestorId: null, requestorName: '',
        location: '', locationType: null, locationLatitude: null, locationLongitude: null,
        startDate: '', endDate: '', notes: '',
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

    /** Estimated cost of one cart line, as requestLineBody.build stores estimatedCost (null while a quote is pending). */
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

    /** The rail and review totals: { lines, units, total, priced }. */
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

    /**
     * Customers or contacts matching the typed text, at most 20 so a long list stays readable.
     * Customers: { id, customerName }; contacts: { id, contactName, username, email } (customer-create-req's rows).
     */
    partyMatches(list, text) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(list) ? list : [])
        .filter((p) => !q || [p.customerName, p.contactName, p.username, p.email].some((v) => v && String(v).toLowerCase().includes(q)))
        .slice(0, 20);
    }

    /** Quantity of one equipment already in the cart (0 when not there). */
    qtyIn(cart, id) {
      const it = (Array.isArray(cart) ? cart : []).find((c) => Number(c.id) === Number(id));
      return it ? Number(it.quantity) || 0 : 0;
    }

    /**
     * What is missing before leaving a step, as labels. Step 1 needs the dates and equipment; step 2 what
     * CreateRequestNextChain required (customer name, customer contact, delivery location). 'draft' checks what a draft
     * needs (equipment and dates); 'submit' checks everything.
     */
    missingFor(step, form, cart) {
      const f = form || {};
      const out = [];
      const all = step === 'submit';
      const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
      if (step === 1 || step === 'draft' || all) {
        if (!f.startDate) out.push('Start date');
        if (!f.endDate) out.push('End date');
        if (f.startDate && f.endDate && d10(f.endDate) < d10(f.startDate)) out.push('End date on or after the start date');
        if (!(Array.isArray(cart) && cart.length)) out.push('At least one piece of equipment');
      }
      if (step === 2 || all) {
        if (blank(f.customerRefId)) out.push('Customer');
        if (blank(f.requestorId)) out.push('Contact');
        if (blank(f.location)) out.push('Delivery address');
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

    /** The ActiveRequestDetail snapshot CreateRequestNextChain takes for a customer request, field for field. */
    buildDetail(form) {
      const f = form || {};
      return {
        customerRefId:      f.customerRefId,
        customerName:       f.customerName,
        requestorId:        f.requestorId,
        requestorName:      f.requestorName,
        location:           f.location,
        requestedStartDate: f.startDate,
        requestedEndDate:   f.endDate,
        notes:              f.notes || '',
        projectId:          null,
        projectNumber:      '',
        projectName:        '',
        taskId:             null,
        taskNumber:         '',
        taskName:           '',
        internalCustomerId:   null,
        internalCustomerName: '',
        contractId:         null,
        contractNumber:     '',
        isSoftReservation:  false,
      };
    }

    /**
     * $flow.variables.request as CreateRequestNextChain builds it: requestModel.defaultRequest() with the customer
     * form laid over it, requestType EXTERNAL, and the delivery point it resolved.
     */
    buildRequest(form) {
      const f = form || {};
      const r = Object.assign(requestModel.defaultRequest(), {
        customerId:        f.customerRefId,
        requestorId:       f.requestorId,
        requestorName:     f.requestorName,
        location:          f.location,
        startDate:         f.startDate,
        endDate:           f.endDate,
        notes:             f.notes || '',
        projectId:         null,
        projectNumber:     '',
        projectName:       '',
        taskId:            null,
        taskNumber:        '',
        taskName:          '',
        isSoftReservation: false,
      });
      r.requestType = 'EXTERNAL';
      r.locationLatitude = f.locationLatitude != null ? f.locationLatitude : null;
      r.locationLongitude = f.locationLongitude != null ? f.locationLongitude : null;
      if (f.locationType) {
        r.locationType = f.locationType; // a reopened draft keeps its delivery mode
      }
      return r;
    }

    termsIntro() { return terms.INTRO; }

    termsSections() { return terms.SECTIONS; }

    agreeLabel() { return terms.AGREE_LABEL; }

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

    initials(name) {
      return String(name || '').split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase()).join('') || '?';
    }

    imageSrc(raw, appPath) {
      if (!raw) {
        return '';
      }
      return /^(https?:|data:)/.test(raw) ? raw : (appPath || '') + raw;
    }

    /** Staff raising a request for a customer (the "acting on behalf" note on step 2). */
    actsForCustomers(map, loaded) {
      return portal.actsForCustomers(map, loaded);
    }

    /** The same screen in Old EquipRite's portal. */
    oldLink(oldAppUrl) {
      if (!oldAppUrl) return '';
      return (oldAppUrl.endsWith('/') ? oldAppUrl : oldAppUrl + '/') + 'vp/shell/customer-portal/customer-create-req';
    }
  }

  return PageModule;
});
