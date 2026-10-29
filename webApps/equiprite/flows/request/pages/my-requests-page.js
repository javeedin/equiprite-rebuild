define([], () => {
  'use strict';

  // Status groups for the chips (FDD 5.6 lifecycle, plus the line/quote states the backend also uses). Every
  // status a request can have belongs to exactly one group, so the group counts add up to "All".
  const GROUPS = [
    { key: 'action',  label: 'Needs action', statuses: ['DRAFT', 'REJECTED', 'QUOTE_GENERATED'] },
    { key: 'waiting', label: 'Waiting',      statuses: ['SUBMITTED', 'IN_PROCESS', 'APPROVED', 'ALLOCATED', 'QUOTE_ACCEPTED'] },
    { key: 'moving',  label: 'On the way',   statuses: ['PICK_INITIATED', 'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE', 'SHIPPED', 'SHIP_TO_SITE'] },
    { key: 'onsite',  label: 'On site',      statuses: ['DEPLOYED', 'DELIVERED', 'RETURN_INITIATED'] },
    { key: 'done',    label: 'Done',         statuses: ['RETURNED', 'CLOSED', 'CANCELLED', 'DECLINED'] },
  ];
  const GROUP_OF = {};
  GROUPS.forEach((g) => g.statuses.forEach((s) => { GROUP_OF[s] = g.key; }));

  // Same rule as sourceLabel in app-flow.js: EXTERNAL or legacy CUSTOMER is external, anything else internal.
  const originOf = (r) => (/^(EXTERNAL|CUSTOMER)$/i.test(String((r && r.requestOrigin) || '').trim()) ? 'EXTERNAL' : 'INTERNAL');
  const statusOf = (r) => String((r && (r.status || r.requestStatus)) || '').toUpperCase();
  // Anything not listed (a new backend status) counts as Waiting rather than vanishing from every group.
  const groupOf = (r) => GROUP_OF[statusOf(r)] || 'waiting';

  class PageModule {
    /** Chip definitions with counts: [{ key, label, count }], "All" first. */
    groups(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const counts = {};
      list.forEach((r) => { const g = groupOf(r); counts[g] = (counts[g] || 0) + 1; });
      return [{ key: 'all', label: 'All', count: list.length }]
        .concat(GROUPS.map((g) => ({ key: g.key, label: g.label, count: counts[g.key] || 0 })));
    }

    /**
     * The rows the table shows: status group, source (INTERNAL / EXTERNAL, managers only) and free text across
     * request number, project, task, customer and requestor.
     */
    filterRows(rows, text, group, source) {
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
        return [r.requestNumber, r.projectName, r.taskName, r.customerName, r.projectInternalCustomer, r.requestorName, r.contactName]
          .some((v) => v && String(v).toLowerCase().includes(q));
      });
    }

    /**
     * Columns: Source and Customer only for roles that see both origins (canChooseCustomerType). oj-table sizes
     * columns from width / minWidth (pixels); style alone only styles the cells.
     */
    columns(isManager) {
      const cols = [];
      if (isManager) {
        cols.push({ headerText: 'Source', field: 'requestOrigin', template: 'sourceTpl', sortable: 'enabled', style: 'width:110px;', width: 110 });
      }
      cols.push({ headerText: 'Request', field: 'requestNumber', template: 'numberTpl', sortable: 'enabled', style: 'width:140px;', minWidth: 130 });
      cols.push({ headerText: 'Project / task', field: 'projectName', template: 'projectTpl', sortable: 'enabled', minWidth: 190 });
      if (isManager) {
        cols.push({ headerText: 'Customer', field: 'customerName', template: 'customerTpl', sortable: 'enabled', minWidth: 160 });
      }
      cols.push({ headerText: 'Requestor', field: 'requestorName', sortable: 'enabled', style: 'width:160px;' });
      cols.push({ headerText: 'Status', field: 'status', template: 'statusTpl', sortable: 'enabled', style: 'width:180px;', minWidth: 170 });
      cols.push({ headerText: 'Dates', field: 'startDate', template: 'datesTpl', sortable: 'enabled', style: 'width:180px;', minWidth: 180 });
      cols.push({ headerText: 'Lines', field: 'lines', sortable: 'disabled', style: 'width:70px;', width: 70 });
      return cols;
    }

    day(v) {
      return v ? String(v).substring(0, 10) : '';
    }

    /** "2 Nov – 15 Dec 2026" (the year once when both dates share it), from ISO dates. */
    dateRange(start, end) {
      const parse = (v) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
        return m ? { y: m[1], m: Number(m[2]) - 1, d: Number(m[3]) } : null;
      };
      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const a = parse(start);
      const b = parse(end);
      const fmt = (x, withYear) => `${x.d} ${MON[x.m]}${withYear ? ` ${x.y}` : ''}`;
      if (a && b) {
        return a.y === b.y ? `${fmt(a, false)} – ${fmt(b, true)}` : `${fmt(a, true)} – ${fmt(b, true)}`;
      }
      return a ? fmt(a, true) : (b ? fmt(b, true) : '');
    }
  }

  return PageModule;
});
