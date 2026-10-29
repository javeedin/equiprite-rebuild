define([], () => {
  'use strict';

  // Workbench (FDD 7.11): every project and customer request, by stage. Pure functions only; the data comes from
  // loadWorkbenchChain (the old Workbench's stage calls) and the bindings read what these return.

  // Coerce a possibly-string/null numeric field to a finite number (old WorkbenchInitChain's num()): null or '' must
  // not become NaN, which is what produced blank and 'NaN%' allocation cells there.
  const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const day = (v) => (v ? String(v).slice(0, 10) : '');

  // The stage tabs (FDD: the old Outbound / Deployed / Inbound plus To approve, To pick and Procurement). Every
  // request lands in exactly one tab, so the counts add up.
  const TABS = [
    { key: 'approve',     label: 'To approve',  hint: 'Submitted requests waiting for your decision.' },
    { key: 'pick',        label: 'To pick',     hint: 'Approved, with units allocated: ready for Initiate picking.' },
    { key: 'outbound',    label: 'Outbound',    hint: 'Approved, picking, inspection and shipped requests.' },
    { key: 'deployed',    label: 'Deployed',    hint: 'Every line on site.' },
    { key: 'inbound',     label: 'Inbound',     hint: 'Returns in progress.' },
    { key: 'procurement', label: 'Procurement', hint: 'Lines bought or rented in from a supplier, waiting on the purchase order.' },
  ];
  // Tabs whose count asks for the manager's action (their count badge is highlighted when not zero).
  const ACTION_TABS = ['approve', 'pick', 'procurement'];

  // Headers that open Approve & allocate: approval (SUBMITTED) and the allocation window (IN_PROCESS, and
  // QUOTE_ACCEPTED, the quoted customer request's equivalent of IN_PROCESS). Anything else opens Request detail.
  const APPROVE_ALLOCATE = ['SUBMITTED', 'IN_PROCESS', 'QUOTE_ACCEPTED'];
  // A quote exists from these header statuses on (old isQuoteOwed / rowClickChain).
  const QUOTE_EXISTS = ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED'];

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parseDay = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? { y: m[1], m: Number(m[2]) - 1, d: Number(m[3]) } : null;
  };
  const dayNumber = (v) => {
    const p = parseDay(v);
    return p ? Math.round(Date.UTC(Number(p.y), p.m, p.d) / 86400000) : null;
  };

  class PageModule {
    tabDefs() {
      return TABS;
    }

    /**
     * workbench-requests rows -> table rows. Carried over from the old Workbench's WorkbenchInitChain
     * (flows/equipment-foundation/pages/equipment-workbench-page-chains): one row per request (deduped on
     * eqrEquipmentRequestId), the same project / task / customer rule (hasProject), the same allocation percentage,
     * newest first. Old field names are kept so the two apps read the same.
     * @param {Object[]} raw      body.data of views/workbench-requests
     * @param {Function} isExt    $application.functions.isExternalSource
     * @param {Function} [quoting] (source) => isQuotingAllowed(...) for that origin
     */
    mapRequests(raw, isExt, quoting) {
      const ext = typeof isExt === 'function' ? isExt : () => false;
      const byRequest = new Map();
      (Array.isArray(raw) ? raw : []).forEach((r) => {
        const id = r && r.eqrEquipmentRequestId;
        if (id == null) return;
        if (!byRequest.has(id)) byRequest.set(id, r);
      });
      // Does this request carry a project? Internal rows always do; external rows only once a project is assigned
      // (projectRefId, or a project name that is not the customer's name mirrored into projectName).
      const hasProject = (r) => {
        if (r.projectRefId != null && String(r.projectRefId).trim() !== '') return true;
        if (!r.projectName) return false;
        if (!ext(r.source)) return true;
        return String(r.projectName).trim() !== String(r.customerName || '').trim();
      };
      return Array.from(byRequest.values())
        .map((r) => {
          const lines = num(r.totalLines);
          const allocated = num(r.allocatedLines);
          const pct = r.allocationPct != null
            ? num(r.allocationPct)
            : (lines > 0 ? Math.round((allocated / lines) * 100) : 0);
          const status = r.requestStatus || '';
          const external = ext(r.source);
          return {
            request_id:      r.eqrEquipmentRequestId,
            request_number:  r.requestNumber || '-',
            source:          r.source || '',
            project:         hasProject(r) ? (r.projectName || '') : '',
            task:            hasProject(r) ? (r.taskName || '') : '',
            customer:        external ? (r.customerName || r.projectName || '') : (r.projectInternalCustomer || ''),
            requestor:       r.requestor || r.contactName || '-',
            location:        r.location || '-',
            start_date:      r.requestedStartDate ? r.requestedStartDate.slice(0, 10) : '-',
            end_date:        r.requestedEndDate ? r.requestedEndDate.slice(0, 10) : '-',
            status:          status,
            lines:           lines,
            allocated_lines: allocated,
            allocation_pct:  Math.max(0, Math.min(100, pct)),
            total_est_cost:  num(r.totalEstCost),
            // New EquipRite: origin resolved once here, and whether a quote is still owed (old isQuoteOwed).
            origin:          r.source ? (external ? 'EXTERNAL' : 'INTERNAL') : '',
            quote_owed:      typeof quoting === 'function' && !!quoting(r.source)
                             && QUOTE_EXISTS.indexOf(String(status).toUpperCase()) === -1,
          };
        })
        .sort((a, b) => Number(b.request_id) - Number(a.request_id));
    }

    /**
     * views/pending-approval-lines rows (UNDER_PROCUREMENT lines) -> one row per request. The view carries the
     * request number but no request id, so the id and header status come from the same request in the other stage
     * lists when it is there (it normally is: such a request is still outbound).
     */
    procurementRows(lines, known) {
      const byNumber = {};
      (Array.isArray(known) ? known : []).forEach((r) => { byNumber[r.request_number] = r; });
      const groups = new Map();
      (Array.isArray(lines) ? lines : []).forEach((l) => {
        const key = l && l.requestNumber;
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(l);
      });
      return Array.from(groups.entries()).map(([number, ls]) => {
        const first = ls[0];
        const match = byNumber[number] || null;
        const id = match ? match.request_id
          : (first.eqrEquipmentRequestId != null ? first.eqrEquipmentRequestId : (first.requestId != null ? first.requestId : null));
        return {
          request_id:      id,
          request_number:  number,
          source:          match ? match.source : (first.source || ''),
          origin:          match ? match.origin : '',
          project:         match ? match.project : (first.projectName || ''),
          task:            match ? match.task : (first.taskName || ''),
          customer:        match ? match.customer : '',
          requestor:       first.requestor || (match ? match.requestor : '-'),
          location:        match ? match.location : '-',
          start_date:      day(first.lineStartDate) || (match ? match.start_date : '-'),
          end_date:        day(first.lineEndDate) || (match ? match.end_date : '-'),
          status:          match ? match.status : '',
          lines:           match ? match.lines : ls.length,
          allocated_lines: match ? match.allocated_lines : 0,
          allocation_pct:  match ? match.allocation_pct : 0,
          total_est_cost:  ls.reduce((s, l) => s + num(l.estimatedCost), 0),
          quote_owed:      false,
          procurement_lines: ls.length,
          equipment:       ls.map((l) => l.equipmentName || '').filter(Boolean).join(', '),
        };
      }).sort((a, b) => Number(b.request_id || 0) - Number(a.request_id || 0));
    }

    /**
     * The six tab buckets, each request in exactly one. To approve = submitted outbound requests; To pick = the
     * Initiate picking queue (stage INITIATE: IN_PROCESS with an allocated line); Outbound = the rest of the outbound
     * stage. To approve, To pick and Outbound are sorted by start date, soonest first (what is due next).
     */
    buckets(stages) {
      const s = stages || {};
      const pick = (s.pick || []).slice();
      const inPick = new Set(pick.map((r) => String(r.request_id)));
      const approve = [];
      const outbound = [];
      (s.outbound || []).forEach((r) => {
        if (String(r.status).toUpperCase() === 'SUBMITTED') approve.push(r);
        else if (!inPick.has(String(r.request_id))) outbound.push(r);
      });
      const bySoonest = (a, b) => (String(a.start_date).localeCompare(String(b.start_date)))
        || (Number(b.request_id) - Number(a.request_id));
      return {
        approve:     approve.sort(bySoonest),
        pick:        pick.sort(bySoonest),
        outbound:    outbound.sort(bySoonest),
        deployed:    (s.deployed || []).slice(),
        inbound:     (s.inbound || []).slice(),
        procurement: (s.procurement || []).slice(),
      };
    }

    /** Tabs with their counts: [{ key, label, hint, count, hot }]. */
    tabs(buckets) {
      const b = buckets || {};
      return TABS.map((t) => {
        const count = (b[t.key] || []).length;
        return { key: t.key, label: t.label, hint: t.hint, count, hot: count > 0 && ACTION_TABS.indexOf(t.key) !== -1 };
      });
    }

    /** Rows of one tab after the source chip (INTERNAL / EXTERNAL) and the search (old Workbench search fields). */
    filterRows(rows, text, source) {
      const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
      return (Array.isArray(rows) ? rows : []).filter((r) => {
        if (source && r.origin !== source) return false;
        if (!words.length) return true;
        return words.some((w) => [r.request_number, r.project, r.customer, r.requestor, r.task, r.equipment]
          .some((v) => v && String(v).toLowerCase().includes(w)));
      });
    }

    /** Where a row's request number leads: Approve & allocate while approval or allocation is open, else Request detail. */
    detailTarget(row) {
      return row && APPROVE_ALLOCATE.indexOf(String(row.status || '').toUpperCase()) !== -1 ? 'approve-allocate' : 'request-detail';
    }

    /**
     * The next action on a row, by tab: { label, target, navId, tone }. target is 'approve-allocate',
     * 'request-detail' or 'nav' (a menu item: navId).
     */
    nextAction(row, tab) {
      const r = row || {};
      const status = String(r.status || '').toUpperCase();
      const unallocated = Math.max(0, num(r.lines) - num(r.allocated_lines));
      switch (tab) {
        case 'approve':
          return { label: 'Review', target: 'approve-allocate', tone: 'dark' };
        case 'pick':
          return { label: 'Initiate picking', target: 'nav', navId: 'picking', tone: 'dark' };
        case 'inbound':
          return { label: 'Receive', target: 'nav', navId: 'receipt', tone: 'plain' };
        case 'procurement':
          return { label: 'Review', target: r.request_id != null ? this.detailTarget(r) : 'none', tone: 'plain' };
        case 'outbound':
          if (APPROVE_ALLOCATE.indexOf(status) !== -1 && unallocated > 0) {
            return { label: 'Allocate', target: 'approve-allocate', tone: 'dark' };
          }
          return { label: 'Open', target: this.detailTarget(r), tone: 'plain' };
        default:
          return { label: 'Open', target: this.detailTarget(r), tone: 'plain' };
      }
    }

    /** What is holding a row up, in a few words ('' when nothing is). */
    blocker(row, tab) {
      const r = row || {};
      const status = String(r.status || '').toUpperCase();
      const unallocated = Math.max(0, num(r.lines) - num(r.allocated_lines));
      if (tab === 'approve') {
        return r.quote_owed ? 'Quote owed before allocation' : '';
      }
      if (tab === 'procurement') {
        return r.procurement_lines ? `${r.procurement_lines} ${r.procurement_lines === 1 ? 'line' : 'lines'} waiting on a PO` : '';
      }
      if (status === 'QUOTE_GENERATED') return 'Customer has not accepted the quote';
      if ((tab === 'outbound' || tab === 'pick') && APPROVE_ALLOCATE.indexOf(status) !== -1 && unallocated > 0) {
        return r.quote_owed ? 'Quote owed before allocation'
          : `${unallocated} of ${num(r.lines)} ${num(r.lines) === 1 ? 'line' : 'lines'} not allocated`;
      }
      return '';
    }

    /** One line under the tabs: what this stage holds, and what needs attention in it. */
    stageSummary(tab, rows) {
      const list = Array.isArray(rows) ? rows : [];
      const n = list.length;
      const reqs = `${n} ${n === 1 ? 'request' : 'requests'}`;
      const lines = list.reduce((s, r) => s + num(r.lines), 0);
      const cost = list.reduce((s, r) => s + num(r.total_est_cost), 0);
      const partly = list.filter((r) => num(r.allocation_pct) < 100).length;
      switch (tab) {
        case 'approve': {
          const owed = list.filter((r) => r.quote_owed).length;
          return `${reqs} · ${lines} ${lines === 1 ? 'line' : 'lines'} · ${this.money(cost)} estimated`
            + (owed ? ` · ${owed} owe a quote` : '');
        }
        case 'pick':
          return `${reqs} ready for picking` + (partly ? ` · ${partly} only partly allocated` : '');
        case 'outbound': {
          const need = list.filter((r) => APPROVE_ALLOCATE.indexOf(String(r.status).toUpperCase()) !== -1
            && num(r.lines) > num(r.allocated_lines));
          const missing = need.reduce((s, r) => s + (num(r.lines) - num(r.allocated_lines)), 0);
          return reqs + (need.length ? ` · ${need.length} need allocation (${missing} ${missing === 1 ? 'line' : 'lines'})` : ' · nothing waiting on allocation');
        }
        case 'deployed':
          return `${reqs} on site`;
        case 'inbound':
          return `${reqs} with returns in progress`;
        case 'procurement': {
          const pl = list.reduce((s, r) => s + num(r.procurement_lines), 0);
          return `${reqs} · ${pl} ${pl === 1 ? 'line' : 'lines'} waiting on a purchase order`;
        }
        default:
          return reqs;
      }
    }

    /** What the ticked To approve rows add up to, for the selection bar (the consequence before the click). */
    selectionSummary(rows, selectedIds) {
      const ids = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
      const picked = (Array.isArray(rows) ? rows : []).filter((r) => ids.has(String(r.request_id)));
      const project = picked.filter((r) => r.origin !== 'EXTERNAL').length;
      const customer = picked.length - project;
      const lines = picked.reduce((s, r) => s + num(r.lines), 0);
      const cost = picked.reduce((s, r) => s + num(r.total_est_cost), 0);
      const parts = [];
      if (project) parts.push(`${project} project`);
      if (customer) parts.push(`${customer} customer`);
      return {
        count: picked.length,
        ids: picked.map((r) => r.request_id),
        text: picked.length
          ? `${picked.length} selected · ${parts.join(', ')} · ${lines} ${lines === 1 ? 'line' : 'lines'} · ${this.money(cost)} estimated`
          : '',
      };
    }

    /** What an empty table says: still loading, filtered out, or nothing in this stage. */
    emptyText(tab, loading, filtered) {
      if (loading) return 'Loading the workbench…';
      if (filtered) return 'No request in this stage matches. Clear the search or pick another source.';
      const EMPTY = {
        approve: 'Nothing is waiting for approval.',
        pick: 'Nothing is ready for picking.',
        outbound: 'Nothing is on its way out.',
        deployed: 'No request is on site.',
        inbound: 'No return is in progress.',
        procurement: 'No line is waiting on a purchase order.',
      };
      return EMPTY[tab] || 'Nothing here.';
    }

    isSelected(selectedIds, id) {
      return (Array.isArray(selectedIds) ? selectedIds : []).some((s) => String(s) === String(id));
    }

    allSelected(rows, selectedIds) {
      const list = Array.isArray(rows) ? rows : [];
      return list.length > 0 && list.every((r) => this.isSelected(selectedIds, r.request_id));
    }

    money(v) {
      const n = num(v);
      return '$' + Math.round(n).toLocaleString('en-US');
    }

    /** "2 Nov – 15 Dec 2026" (the year once when both dates share it). */
    dateRange(start, end) {
      const a = parseDay(start);
      const b = parseDay(end);
      const fmt = (x, withYear) => `${x.d} ${MON[x.m]}${withYear ? ` ${x.y}` : ''}`;
      if (a && b) {
        return a.y === b.y ? `${fmt(a, false)} – ${fmt(b, true)}` : `${fmt(a, true)} – ${fmt(b, true)}`;
      }
      return a ? fmt(a, true) : (b ? fmt(b, true) : '—');
    }

    /** How soon the equipment is needed, for rows still to be approved or picked: 'in 3 days', 'today', 'started 2 days ago'. */
    startHint(start, today) {
      const s = dayNumber(start);
      const t = dayNumber(today);
      if (s === null || t === null) return '';
      const d = s - t;
      if (d === 0) return 'starts today';
      if (d === 1) return 'starts tomorrow';
      if (d > 1) return `starts in ${d} days`;
      return d === -1 ? 'started yesterday' : `started ${-d} days ago`;
    }

    /** True when the start date is today or past: the row is late for approval or picking. */
    isLate(start, today) {
      const s = dayNumber(start);
      const t = dayNumber(today);
      return s !== null && t !== null && s <= t;
    }

    /** Allocation tone, as the old Workbench: 'none' (0), 'partial', 'complete' (100). */
    allocTone(pct) {
      const p = Number(pct);
      if (!Number.isFinite(p) || p <= 0) return 'none';
      return p >= 100 ? 'complete' : 'partial';
    }

    /** Request number in Old EquipRite's quote page (customer and project quotes are generated there). */
    oldQuoteLink(oldAppUrl, row) {
      if (!oldAppUrl || !row || row.request_id == null) return '';
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : `${oldAppUrl}/`;
      return `${base}vp/shell/equipment-foundation/request-quote?requestId=${encodeURIComponent(row.request_id)}`
        + `&requestNumber=${encodeURIComponent(row.request_number || '')}&sourcePage=request-detail`;
    }
  }

  return PageModule;
});
