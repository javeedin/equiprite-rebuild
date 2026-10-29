define([], () => {
  'use strict';

  // My requests, two ways to look at the same requests:
  //   Requests   a card per request, its equipment on the card (name × qty and each line's status), the rental window
  //              with today on it, the full equipment list one click away without leaving the page
  //   Equipment  a row per piece of equipment across every request: what it is, which request, where, when, status
  // Search covers both: "excavator" finds the requests that hold one. Lines come in bulk from views/my-request-lines;
  // a request the bulk view does not cover loads its own (views/request-detail-lines, as Request detail does).

  // Status groups for the chips (FDD 5.6 lifecycle, plus the line/quote states the backend also uses). Every
  // status a request can have belongs to exactly one group, so the group counts add up to "All".
  const GROUPS = [
    { key: 'action',  label: 'Needs action', statuses: ['DRAFT', 'REJECTED', 'QUOTE_GENERATED'] },
    { key: 'waiting', label: 'Waiting',      statuses: ['SUBMITTED', 'IN_PROCESS', 'APPROVED', 'ALLOCATED', 'QUOTE_ACCEPTED', 'UNDER_PROCUREMENT', 'SCHEDULED_FOR_PICKING'] },
    // On the way out to site, or back to the yard.
    { key: 'moving',  label: 'On the way',   statuses: ['PICK_INITIATED', 'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE', 'SHIPPED', 'SHIP_TO_SITE', 'RETURN_IN_PROCESS', 'SHIPPED_TO_YARD'] },
    { key: 'onsite',  label: 'On site',      statuses: ['DEPLOYED', 'DELIVERED', 'RETURN_INITIATED'] },
    { key: 'done',    label: 'Done',         statuses: ['RETURNED', 'CLOSED', 'CANCELLED', 'DECLINED', 'CONSUMED'] },
  ];
  const GROUP_OF = {};
  GROUPS.forEach((g) => g.statuses.forEach((s) => { GROUP_OF[s] = g.key; }));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY = 86400000;

  // Same rule as sourceLabel in app-flow.js: EXTERNAL or legacy CUSTOMER is external, anything else internal.
  const originOf = (r) => (/^(EXTERNAL|CUSTOMER)$/i.test(String((r && r.requestOrigin) || '').trim()) ? 'EXTERNAL' : 'INTERNAL');
  const statusOf = (r) => String((r && (r.status || r.requestStatus)) || '').toUpperCase();
  // Anything not listed (a new backend status) counts as Waiting rather than vanishing from every group.
  const groupOf = (r) => GROUP_OF[statusOf(r)] || 'waiting';
  const lineGroupOf = (l) => GROUP_OF[String((l && l.status) || '').toUpperCase()] || 'waiting';
  const pick = (r, names) => {
    for (let i = 0; i < names.length; i++) {
      const v = r && r[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };
  const dayMs = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const lc = (v) => String(v || '').toLowerCase();

  class PageModule {
    /** Chip definitions with counts: [{ key, label, count }], "All" first. */
    groups(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const counts = {};
      list.forEach((r) => { const g = groupOf(r); counts[g] = (counts[g] || 0) + 1; });
      return [{ key: 'all', label: 'All', count: list.length }]
        .concat(GROUPS.map((g) => ({ key: g.key, label: g.label, count: counts[g.key] || 0 })));
    }

    /** The same chips for equipment lines, counted by each line's own status. */
    lineGroups(lines) {
      const list = Array.isArray(lines) ? lines : [];
      const counts = {};
      list.forEach((l) => { const g = lineGroupOf(l); counts[g] = (counts[g] || 0) + 1; });
      return [{ key: 'all', label: 'All', count: list.length }]
        .concat(GROUPS.map((g) => ({ key: g.key, label: g.label, count: counts[g.key] || 0 })));
    }

    /**
     * The rows the list shows: status group, source (INTERNAL / EXTERNAL, managers only) and free text across
     * request number, project, task, customer and requestor, and (when given) the request's equipment.
     */
    filterRows(rows, text, group, source, linesByRequest) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(rows) ? rows : []).filter((r) => {
        if (group && group !== 'all' && groupOf(r) !== group) {
          return false;
        }
        if (source && originOf(r) !== source) {
          return false;
        }
        if (!q) {
          return true;
        }
        if ([r.requestNumber, r.projectName, r.taskName, r.customerName, r.projectInternalCustomer, r.requestorName, r.contactName]
          .some((v) => v && String(v).toLowerCase().includes(q))) {
          return true;
        }
        const lines = linesByRequest && linesByRequest[r.requestNumber];
        return !!(lines && lines.some((l) => lc(l.name).includes(q) || lc(l.cls).includes(q) || lc(l.serial).includes(q)));
      });
    }

    /** Equipment rows: line status group, the request's source, free text over equipment, serial, request, project. */
    filterLines(lines, text, group, source) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(lines) ? lines : []).filter((l) => {
        if (group && group !== 'all' && lineGroupOf(l) !== group) return false;
        if (source && l.origin !== source) return false;
        if (!q) return true;
        return [l.name, l.cls, l.serial, l.requestNumber, l.project, l.customer, l.location, l.requestor]
          .some((v) => v && String(v).toLowerCase().includes(q));
      });
    }

    /**
     * One equipment line in one shape, from either view: my-request-lines (equipmentName, className, qty,
     * requestStatus, allocationStatus, deploymentLocation, utilPct) or request-detail-lines (equipmentName,
     * equipmentClass, quantity, lineStatus, allocatedSerialNumber).
     */
    lineOf(raw, requestNumber) {
      const r = raw || {};
      const status = String(pick(r, ['lineStatus', 'status', 'requestStatus']) || '').toUpperCase();
      const util = pick(r, ['utilPct', 'utilizationPct']);
      return {
        key: String(pick(r, ['lineId', 'id', 'eqrEquipmentRequestLineId']) || '') + ':' + (pick(r, ['lineNumber']) || '') + ':' + (pick(r, ['equipmentName', 'name']) || ''),
        requestNumber: String(pick(r, ['requestNumber']) || requestNumber || ''),
        lineNumber: pick(r, ['lineNumber']) || null,
        name: pick(r, ['equipmentName', 'name', 'itemName']) || 'Equipment',
        cls: pick(r, ['className', 'equipmentClass', 'class']) || '',
        qty: Number(pick(r, ['qty', 'quantity'])) || 1,
        status,
        allocation: String(pick(r, ['allocationStatus']) || '').toUpperCase(),
        serial: pick(r, ['allocatedSerialNumber', 'allocatedSerial', 'serialNumber']) || '',
        start: String(pick(r, ['startDate', 'requestedStartDate']) || '').slice(0, 10),
        end: String(pick(r, ['endDate', 'requestedEndDate']) || '').slice(0, 10),
        location: pick(r, ['deploymentLocation', 'location']) || '',
        util: util !== undefined && !isNaN(Number(util)) ? Math.max(0, Math.min(100, Math.round(Number(util)))) : null,
      };
    }

    /** Bulk lines grouped by request number: { 'REQ-1': [line, …] }, in line order. */
    indexLines(rawLines) {
      const out = {};
      (Array.isArray(rawLines) ? rawLines : []).forEach((raw) => {
        const l = this.lineOf(raw);
        if (!l.requestNumber) return;
        (out[l.requestNumber] = out[l.requestNumber] || []).push(l);
      });
      Object.keys(out).forEach((k) => out[k].sort((a, b) => Number(a.lineNumber || 0) - Number(b.lineNumber || 0)));
      return out;
    }

    /**
     * Every line, joined to its request (project, customer, requestor, source, id) for the Equipment view, in the
     * list's own order (newest request first), each request's lines in line order. Lines of requests outside this
     * list (another scope) are left out.
     */
    flattenLines(rows, linesByRequest) {
      const out = [];
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        const lines = (linesByRequest || {})[r.requestNumber] || [];
        lines.forEach((l) => {
          out.push(Object.assign({}, l, {
            status: l.status || statusOf(r),
            requestId: r.eqrEquipmentRequestId,
            project: r.projectName || '',
            task: r.taskName || '',
            customer: r.customerName || r.projectInternalCustomer || '',
            requestor: r.requestorName || r.contactName || '',
            origin: originOf(r),
            start: l.start || String(r.startDate || '').slice(0, 10),
            end: l.end || String(r.endDate || '').slice(0, 10),
          }));
        });
      });
      return out;
    }

    /** The equipment chips on a card: the first `max` lines plus how many more. */
    chips(lines, max) {
      const list = Array.isArray(lines) ? lines : [];
      const n = max || 4;
      return { shown: list.slice(0, n), more: Math.max(0, list.length - n), units: list.reduce((s, l) => s + (Number(l.qty) || 0), 0) };
    }

    /**
     * Where today sits in a rental window: { pct, label, state: upcoming | running | ended }.
     * "Day 12 of 23", "Starts in 5 days", "Ended 3 days ago".
     */
    windowProgress(start, end, now) {
      const s = dayMs(start);
      const e = dayMs(end);
      const d = new Date(now || Date.now());
      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      if (s === null || e === null || e < s) return { pct: 0, label: '', state: 'none' };
      const total = Math.round((e - s) / DAY) + 1;
      if (t < s) {
        const n = Math.round((s - t) / DAY);
        return { pct: 0, label: n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`, state: 'upcoming' };
      }
      if (t > e) {
        const n = Math.round((t - e) / DAY);
        return { pct: 100, label: n === 1 ? 'Ended yesterday' : `Ended ${n} days ago`, state: 'ended' };
      }
      const nth = Math.round((t - s) / DAY) + 1;
      return { pct: Math.round((nth / total) * 100), label: `Day ${nth} of ${total}`, state: 'running' };
    }

    /** Status pill colour key for a line status (empty when unknown). */
    lineState(status) {
      return GROUP_OF[String(status || '').toUpperCase()] || (status ? 'waiting' : '');
    }

    /** "2 Nov – 15 Dec 2026" (the year once when both dates share it), from ISO dates. */
    dateRange(start, end) {
      const parse = (v) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
        return m ? { y: m[1], m: Number(m[2]) - 1, d: Number(m[3]) } : null;
      };
      const a = parse(start);
      const b = parse(end);
      const fmt = (x, withYear) => `${x.d} ${MON[x.m]}${withYear ? ` ${x.y}` : ''}`;
      if (a && b) {
        return a.y === b.y ? `${fmt(a, false)} – ${fmt(b, true)}` : `${fmt(a, true)} – ${fmt(b, true)}`;
      }
      return a ? fmt(a, true) : (b ? fmt(b, true) : '');
    }

    /** Units of equipment over lines (quantities added up). */
    units(lines) {
      return (Array.isArray(lines) ? lines : []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
    }

    /** "3 pieces" / "1 piece". */
    pieces(n) {
      const v = Number(n) || 0;
      return v + (v === 1 ? ' piece' : ' pieces');
    }

    day(v) {
      return v ? String(v).substring(0, 10) : '';
    }
  }

  return PageModule;
});
