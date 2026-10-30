define(['resources/js/requestProgress'], (Progress) => {
  'use strict';

  // My requests, two ways to look at the same requests:
  //   Requests   a card per request, its equipment on the card (name × qty and each line's status), the rental window
  //              with today on it, the full equipment list one click away without leaving the page
  //   Equipment  a row per piece of equipment across every request: what it is, which request, where, when, status
  // Search covers both: "excavator" finds the requests that hold one. Lines come in bulk from views/my-request-lines;
  // a request the bulk view does not cover loads its own (views/request-detail-lines, as Request detail does).

  // Where a request is comes from its equipment, not from the request's own status, which stays IN_PROCESS from
  // approval to the end (resources/js/requestProgress.js). The chips follow the equipment's journey. A request
  // shows under every stage its equipment is in (one piece on the way and two being picked: On the way and Getting
  // ready), so the chips need not add up to All. Late comes first: not shipped by the start date, or still out after
  // the end date.
  const CHIPS = [
    { key: 'late',     label: 'Late' },
    { key: 'action',   label: 'Needs action' },          // drafts, sent back, a quote waiting for the customer
    { key: 'approval', label: 'Waiting for approval' },
    { key: 'ready',    label: 'Getting ready' },
    { key: 'out',      label: 'On the way' },
    { key: 'onsite',   label: 'On site' },
    { key: 'back',     label: 'Coming back' },
    { key: 'done',     label: 'Done' },
  ];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY = 86400000;

  // Same rule as sourceLabel in app-flow.js: EXTERNAL or legacy CUSTOMER is external, anything else internal.
  const originOf = (r) => (/^(EXTERNAL|CUSTOMER)$/i.test(String((r && r.requestOrigin) || '').trim()) ? 'EXTERNAL' : 'INTERNAL');
  const statusOf = (r) => String((r && (r.status || r.requestStatus)) || '').toUpperCase();
  const isExternal = (r) => originOf(r) === 'EXTERNAL';
  // The chips a request belongs to, from its progress.
  const keysOf = (p) => {
    if (!p) return [];
    const keys = p.late && p.late.length ? ['late'] : [];
    if (p.stage === 'draft' || p.headline === 'Sent back' || (p.next && p.next.who === 'Customer')) keys.push('action');
    if (p.stage === 'stopped' && p.headline !== 'Sent back') keys.push('done');
    return keys.concat(p.stages.filter((k) => k !== 'draft' && k !== 'stopped'));
  };
  // The chips one piece of equipment belongs to: its stage, Needs action when it waits on the requester, Late.
  const lineKeysOf = (l) => {
    const keys = l.late ? ['late'] : [];
    if (l.stage === 'draft' || l.status === 'REJECTED' || l.status === 'QUOTE_GENERATED') keys.push('action');
    else keys.push(l.stage === 'stopped' ? 'done' : l.stage);
    return keys;
  };
  const chipCounts = (items, keysFn) => {
    const counts = {};
    items.forEach((it) => keysFn(it).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
    return [{ key: 'all', label: 'All', count: items.length }]
      .concat(CHIPS.map((c) => ({ key: c.key, label: c.label, count: counts[c.key] || 0 })))
      .filter((c) => c.key === 'all' || c.count > 0 || c.key !== 'late');
  };
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
    /** Each request's progress from its equipment, by request number (requestProgress.summarize). */
    progressMap(rows, linesByRequest, now) {
      const out = {};
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        if (!r) return;
        out[r.requestNumber || ''] = Progress.summarize(statusOf(r), (linesByRequest || {})[r.requestNumber] || [],
          { start: r.startDate, end: r.endDate, external: isExternal(r), now });
      });
      return out;
    }

    /** Chip definitions with counts: [{ key, label, count }], "All" first; a request counts in each stage it is in. */
    groups(rows, progress) {
      const list = Array.isArray(rows) ? rows : [];
      const p = progress || this.progressMap(list, {});
      return chipCounts(list, (r) => keysOf(p[r.requestNumber || '']));
    }

    /** The same chips for equipment, each piece counted by its own stage. */
    lineGroups(lines) {
      return chipCounts(Array.isArray(lines) ? lines : [], lineKeysOf);
    }

    /**
     * The rows the list shows: journey chip, source (INTERNAL / EXTERNAL, managers only) and free text across
     * request number, project, task, customer and requestor, and (when given) the request's equipment.
     */
    filterRows(rows, text, group, source, linesByRequest, progress) {
      const q = String(text || '').trim().toLowerCase();
      const list = Array.isArray(rows) ? rows : [];
      const p = progress || (group && group !== 'all' ? this.progressMap(list, linesByRequest) : {});
      return list.filter((r) => {
        if (group && group !== 'all' && keysOf(p[r.requestNumber || '']).indexOf(group) === -1) {
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
        if (group && group !== 'all' && lineKeysOf(l).indexOf(group) === -1) return false;
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
    flattenLines(rows, linesByRequest, now) {
      const out = [];
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        const lines = (linesByRequest || {})[r.requestNumber] || [];
        lines.forEach((l) => {
          const status = l.status || statusOf(r);
          const info = Progress.line(status, isExternal(r));
          const one = Progress.summarize(status, [{ status, start: l.start, end: l.end }],
            { start: r.startDate, end: r.endDate, external: isExternal(r), now });
          out.push(Object.assign({}, l, {
            status,
            stage: info.stage,
            label: info.label,
            late: one.late.length ? one.late[0].text.replace(/^1 /, '') : '',
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

    /** The journey stage of a line status (the colour), customer requests read as such. */
    lineStage(status, origin) {
      return Progress.line(status, isExternal({ requestOrigin: origin })).stage || 'ready';
    }

    /** A line status in words: "Approved, no unit assigned yet", "On the way to site". */
    lineLabel(status, origin) {
      return Progress.line(status, isExternal({ requestOrigin: origin })).label;
    }

    /** The serial, else whether a unit is assigned yet (the allocation status), in words. */
    serialText(line) {
      const l = line || {};
      if (l.serial) return l.serial;
      return { ALLOCATED: 'Unit assigned', PARTIALLY_ALLOCATED: 'Partly assigned', PENDING: 'No unit assigned yet',
        UNALLOCATED: 'No unit assigned yet' }[l.allocation] || '—';
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
