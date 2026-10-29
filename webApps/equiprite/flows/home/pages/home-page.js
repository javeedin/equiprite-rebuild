define([], () => {
  'use strict';

  // Old EquipRite pages a Home row opens until their new screens exist (shape -> old flow/page and its URL
  // parameters). Mirrors the old dashboard's navigateDashboardRowChain, so a row opens what it always opened.
  const OLD_ROW_PAGES = {
    workbenchPicking: () => ({ path: 'equipment-foundation/initiate-picking', params: {} }),
    timesheets: (row) => ({
      path: 'equipment-foundation/timesheet-detail',
      params: { requestId: row.requestNumber, projectName: row.project, weekStartDate: row.weekStartDate },
    }),
    timesheetApprovals: (row) => ({
      path: 'equipment-foundation/timesheet-approval-detail',
      params: { requestNumber: row.requestNumber, weekStartDate: row.weekStartDate, projectName: row.project },
    }),
    postCost: () => ({ path: 'equipment-foundation/post-cost-test', params: {} }),
    request: (row) => ({
      path: 'main/equipment-request-detail',
      params: { requestId: row.requestNumber, requestNumericId: row.eqrEquipmentRequestId, sourcePage: 'Equipment Requests' },
    }),
  };

  // New EquipRite screen a Home row opens (shape -> menu item and the URL parameters that page reads). Rows open
  // their new screen once that menu item is built; until then (or when it is switched off) they open Old EquipRite.
  const NEW_ROW_ITEMS = {
    workbenchPicking: () => ({ navId: 'picking', params: {} }),
    timesheets: (row) => ({ navId: 'time-entry', params: { request: row.requestNumber, week: row.weekStartDate } }),
    timesheetApprovals: (row) => ({ navId: 'timesheet-approval', params: { week: row.weekStartDate } }),
    postCost: (row) => ({ navId: 'post-costs', params: { request: row.requestNumber } }),
  };

  class PageModule {
    /**
     * The New EquipRite screen a Home row opens: { navId, params } with empty values left out, or null when the row
     * opens Request detail (request rows) or has no new screen.
     * @param {Object} row   mapped Home row (homeInitChain MAPPERS)
     * @param {string} shape $page.variables.tableRowNav
     */
    newRowTarget(row, shape) {
      const make = NEW_ROW_ITEMS[shape];
      if (!make || !row) {
        return null;
      }
      const t = make(row);
      const params = {};
      Object.keys(t.params).forEach((k) => {
        const v = t.params[k];
        if (v !== undefined && v !== null && v !== '' && v !== '—') {
          params[k] = String(v);
        }
      });
      return { navId: t.navId, params };
    }

    /**
     * Address of a Home row's detail in Old EquipRite, or '' when it has none (no old app address yet, or a row
     * without a request number).
     * @param {string} oldAppUrl $application.variables.oldAppUrl
     * @param {Object} row       mapped Home row (homeInitChain MAPPERS)
     * @param {string} shape     $page.variables.tableRowNav
     */
    oldRequestLink(oldAppUrl, row, shape) {
      const number = row && row.requestNumber && row.requestNumber !== '—' ? String(row.requestNumber) : '';
      if (!oldAppUrl || !number) {
        return '';
      }
      const target = (OLD_ROW_PAGES[shape] || OLD_ROW_PAGES.request)(row);
      const query = Object.keys(target.params)
        .filter((k) => target.params[k] !== undefined && target.params[k] !== null && target.params[k] !== '')
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(target.params[k])}`)
        .join('&');
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : `${oldAppUrl}/`;
      return `${base}vp/shell/${target.path}${query ? `?${query}` : ''}`;
    }

    /** "Good morning, Priya": greeting by local time and first name, or just the greeting. */
    greeting(user) {
      const h = new Date().getHours();
      const part = h < 12 ? 'Good morning' : (h < 18 ? 'Good afternoon' : 'Good evening');
      const name = String((user && (user.fullName || user.displayName || user.username)) || '').trim();
      const first = name.includes('.') && !name.includes(' ') ? name.split('.')[0] : name.split(' ')[0];
      return first ? `${part}, ${first.charAt(0).toUpperCase()}${first.slice(1)}` : part;
    }

    /** A KPI tile's value for display: money as $12,340, counts as 1,234, nothing yet as an en dash. */
    kpiValue(kpis, card) {
      const v = kpis && card ? kpis[card.key] : undefined;
      if (v === undefined || v === null || v === '') {
        return '–';
      }
      const n = Number(v);
      if (!Number.isFinite(n)) {
        return String(v);
      }
      return card.money
        ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
        : n.toLocaleString();
    }

    /** Status code for a status pill class: "In process" -> IN_PROCESS. */
    statusKey(status) {
      return String(status || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    }

    /** Status code as words: IN_PROCESS -> "In process". */
    statusLabel(status) {
      const s = String(status || '').replace(/_/g, ' ').toLowerCase();
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    }

    money(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '';
    }
  }

  return PageModule;
});
