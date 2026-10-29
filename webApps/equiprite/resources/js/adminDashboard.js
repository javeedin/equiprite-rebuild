define([], function () {
  'use strict';

  // The Administrator's Home (FDD 7.1.2 System Administrator tiles, 7.1.3 KPI summary bar, RPT-15 overdue
  // equipment, RPT-16 agreement expiry, RPT-17 integration errors and DLQ). Pure: homeInitChain loads the rows,
  // this turns them into what the page shows. Every figure says where it comes from (FDD section 6 tables):
  //
  //   requests      views/my-requests (EQR_EQUIPMENT_REQUEST), the manager-scope list
  //   fleet         views/yard-stock?groupBy=unitStatus, the same call and rule as Analytics (utilisation = rented
  //                 units / all units)
  //   timesheets    views/timesheet-approvals (EQR_TIME_ENTRY), submitted weeks
  //   finance       views/post-cost, counted by the Finance Home's own counter (weeks and cost not yet posted)
  //   health        integrationHealth.model(): EQR_ERROR_LOG, EQR_DEAD_LETTER_QUEUE, EQR_JOB_RUN_LOG, integration
  //                 events, open sync exceptions, the sync lock
  //   certifications  equipment-certifications (EQR_EQUIPMENT_CERTIFICATION.expiry_date)
  //   portalUsers   customer-portal-users (EQR_CUSTOMER_PORTAL_USER.status LOCKED)
  //   audit         audit-trail, the latest configuration changes
  //   appRoles      rbac/app-roles

  var DAY = 86400000;

  // Request stages for the pipeline, in lifecycle order (FDD 5.6). Every status belongs to one stage.
  var STAGES = [
    { key: 'draft', label: 'Draft', statuses: ['DRAFT'] },
    { key: 'submitted', label: 'Waiting approval', statuses: ['SUBMITTED'] },
    { key: 'process', label: 'Approved / allocating', statuses: ['IN_PROCESS', 'APPROVED', 'ALLOCATED', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'UNDER_PROCUREMENT'] },
    { key: 'moving', label: 'Picking & shipping', statuses: ['SCHEDULED_FOR_PICKING', 'PICK_INITIATED', 'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE', 'SHIPPED', 'SHIP_TO_SITE'] },
    { key: 'onsite', label: 'On site', statuses: ['DEPLOYED', 'DELIVERED'] },
    { key: 'returning', label: 'Returning', statuses: ['RETURN_INITIATED', 'RETURN_IN_PROCESS', 'SHIPPED_TO_YARD'] },
    { key: 'done', label: 'Closed', statuses: ['RETURNED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DECLINED'] }
  ];
  var STAGE_OF = {};
  STAGES.forEach(function (s) { s.statuses.forEach(function (c) { STAGE_OF[c] = s.key; }); });

  // Out with the customer or project and not back yet: past its end date this is overdue (RPT-15).
  var OUT = { SHIP_TO_SITE: 1, SHIPPED: 1, DEPLOYED: 1, DELIVERED: 1, RETURN_INITIATED: 1 };
  // Approved or waiting but not yet on its way: starting within a week this is at risk.
  var NOT_MOVING = { SUBMITTED: 1, IN_PROCESS: 1, APPROVED: 1, ALLOCATED: 1, QUOTE_GENERATED: 1, QUOTE_ACCEPTED: 1, UNDER_PROCUREMENT: 1 };
  var CLOSED = { RETURNED: 1, CLOSED: 1, CANCELLED: 1, REJECTED: 1, DECLINED: 1 };

  var MODULES = [
    { key: 'PROJECTS_MODULE_ENABLED', label: 'Projects' },
    { key: 'TIMESHEETS_ENABLED', label: 'Timesheets' },
    { key: 'PPM_RATES_ENABLED', label: 'PPM rates' },
    { key: 'CUSTOMERS_MODULE_ENABLED', label: 'Customer portal' },
    { key: 'AGREEMENTS_ENABLED', label: 'Rental agreements' },
    { key: 'EXTERNAL_PROJECT_ASSIGN_ENABLED', label: 'Projects on customer requests' }
  ];

  var SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

  function statusOf(r) { return String((r && (r.status || r.requestStatus)) || '').trim().toUpperCase(); }
  function d10(v) { return v ? String(v).slice(0, 10) : ''; }
  function dayMs(v) {
    var s = d10(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  }
  function today(now) {
    var d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function pick(r, names) {
    for (var i = 0; i < names.length; i++) {
      if (r && r[names[i]] !== undefined && r[names[i]] !== null && r[names[i]] !== '') return r[names[i]];
    }
    return undefined;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function isCustomer(r) { return /^(EXTERNAL|CUSTOMER)$/i.test(String((r && r.requestOrigin) || '').trim()); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** "2 Nov – 15 Dec 2026" (the year once when both share it). */
  function dateText(start, end) {
    var p = function (v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? { y: m[1], m: Number(m[2]) - 1, d: Number(m[3]) } : null; };
    var a = p(start), b = p(end);
    var f = function (x, y) { return x.d + ' ' + MON[x.m] + (y ? ' ' + x.y : ''); };
    if (a && b) return a.y === b.y ? f(a, false) + ' – ' + f(b, true) : f(a, true) + ' – ' + f(b, true);
    return a ? f(a, true) : (b ? f(b, true) : '');
  }
  function money(n) {
    var v = Math.round(Number(n) || 0);
    return '$' + v.toLocaleString('en-US');
  }

  /** Requests grouped into the pipeline stages: [{ key, label, count, pct }] in lifecycle order. */
  function pipeline(requests) {
    var counts = {};
    (requests || []).forEach(function (r) {
      var k = STAGE_OF[statusOf(r)] || 'process';
      counts[k] = (counts[k] || 0) + 1;
    });
    var total = (requests || []).length;
    return STAGES.map(function (s) {
      var c = counts[s.key] || 0;
      return { key: s.key, label: s.label, count: c, pct: total ? Math.round((c / total) * 100) : 0 };
    });
  }

  /** The request-based counts the KPI bar and the attention list share. */
  function requestFacts(requests, now) {
    var t = today(now);
    var facts = { active: 0, submitted: 0, urgentApprovals: 0, overdue: [], atRisk: [], staleDrafts: 0, onSite: 0, project: 0, customer: 0 };
    (requests || []).forEach(function (r) {
      var s = statusOf(r);
      var start = dayMs(r.startDate || r.requestedStartDate);
      var end = dayMs(r.endDate || r.requestedEndDate);
      if (isCustomer(r)) facts.customer++; else facts.project++;
      if (s !== 'DRAFT' && !CLOSED[s]) facts.active++;
      if (s === 'SUBMITTED') {
        facts.submitted++;
        if (start !== null && start - t <= 3 * DAY) facts.urgentApprovals++;
      }
      if (OUT[s]) facts.onSite++;
      if (OUT[s] && end !== null && end < t) {
        facts.overdue.push({ request: r, days: Math.round((t - end) / DAY) });
      }
      if (NOT_MOVING[s] && start !== null && start >= t && start - t <= 7 * DAY) {
        facts.atRisk.push({ request: r, days: Math.round((start - t) / DAY) });
      }
      if (s === 'DRAFT' && start !== null && start < t) facts.staleDrafts++;
    });
    facts.overdue.sort(function (a, b) { return b.days - a.days; });
    facts.atRisk.sort(function (a, b) { return a.days - b.days; });
    return facts;
  }

  /** Units by status from the yard-stock groups: { total, rented, available, utilizationPct, byStatus: [...] }. */
  function fleet(groups, label) {
    var byStatus = {};
    var total = 0;
    (groups || []).forEach(function (g) {
      var k = String(g.groupKey || 'UNKNOWN').toUpperCase();
      var c = Number(g.count || 0);
      byStatus[k] = (byStatus[k] || 0) + c;
      total += c;
    });
    var rented = byStatus.RENTED || 0;
    var list = Object.keys(byStatus).sort(function (a, b) { return byStatus[b] - byStatus[a]; }).map(function (k) {
      return { key: k, label: label ? label(k) : k, count: byStatus[k], pct: total ? Math.round((byStatus[k] / total) * 100) : 0 };
    });
    return {
      total: total,
      rented: rented,
      available: byStatus.AVAILABLE || 0,
      utilizationPct: total ? Math.round((rented / total) * 100) : null,
      byStatus: list
    };
  }

  /** Certificates past or within 30 days of their expiry date (EQR_EQUIPMENT_CERTIFICATION). */
  function certificates(rows, now) {
    var t = today(now);
    var out = { expired: 0, expiring: 0 };
    (rows || []).forEach(function (c) {
      var exp = dayMs(c.expiryDate);
      var s = String(c.status || '').toUpperCase();
      if (s === 'EXPIRED' || (exp !== null && exp < t)) out.expired++;
      else if (s === 'EXPIRING' || (exp !== null && exp - t <= 30 * DAY)) out.expiring++;
    });
    return out;
  }

  /** Customer portal accounts that are locked (EQR_CUSTOMER_PORTAL_USER.status). */
  function lockedUsers(rows) {
    return (rows || []).filter(function (u) {
      return /LOCK/i.test(String(pick(u, ['status', 'userStatus', 'accountStatus']) || ''));
    }).length;
  }

  /** The latest configuration changes from the audit trail, newest first. */
  function changes(rows, max) {
    return (rows || []).slice().sort(function (a, b) {
      return String(b.changedDate || '').localeCompare(String(a.changedDate || ''));
    }).slice(0, max || 5).map(function (a) {
      return {
        key: String(a.id || '') + ':' + (a.changedDate || ''),
        when: d10(a.changedDate),
        who: a.changedBy || '—',
        what: a.changeSummary || ((a.action || 'Changed') + ' ' + (a.entityName || '')).trim()
      };
    });
  }

  /**
   * The "needs attention" list, most severe first. Each item: { key, severity, count, title, detail, nav, action }.
   * Only things with a count show; nothing to do gives an empty list.
   */
  function attention(f, x) {
    var items = [];
    var h = x.health || {};
    var hc = h.counts || {};
    if (h.banner) {
      items.push({ key: 'integration-down', severity: 'critical', count: hc.down || 1, title: h.banner.name + ' is down',
        detail: [h.banner.reason, h.banner.what, h.banner.fix].filter(Boolean).join('. ').replace(/\.\./g, '.'),
        nav: 'integration-health', action: 'Open integration health' });
    }
    if (f.overdue.length) {
      var worst = f.overdue[0];
      items.push({ key: 'overdue', severity: 'high', count: f.overdue.length,
        title: plural(f.overdue.length, 'request') + ' past the end date and not back',
        detail: 'Longest: ' + (worst.request.requestNumber || '') + ', ' + plural(worst.days, 'day') + ' over (RPT-15).',
        nav: 'receipt', action: 'Open receipt & returns' });
    }
    if (f.urgentApprovals) {
      items.push({ key: 'approvals-urgent', severity: 'high', count: f.urgentApprovals,
        title: plural(f.urgentApprovals, 'request') + ' waiting approval and starting within 3 days',
        detail: plural(f.submitted, 'request') + ' waiting approval in all.', nav: 'workbench', action: 'Open workbench' });
    } else if (f.submitted) {
      items.push({ key: 'approvals', severity: 'medium', count: f.submitted, title: plural(f.submitted, 'request') + ' waiting approval',
        detail: 'None starts within 3 days.', nav: 'workbench', action: 'Open workbench' });
    }
    if (f.atRisk.length) {
      items.push({ key: 'at-risk', severity: 'medium', count: f.atRisk.length,
        title: plural(f.atRisk.length, 'request') + ' starting this week and not yet on the way',
        detail: 'Next: ' + (f.atRisk[0].request.requestNumber || '') + (f.atRisk[0].days === 0 ? ' starts today.' : ' in ' + plural(f.atRisk[0].days, 'day') + '.'),
        nav: 'workbench', action: 'Open workbench' });
    }
    if ((hc.attention || 0) > 0) {
      items.push({ key: 'integration-attention', severity: 'medium', count: hc.attention,
        title: plural(hc.attention, 'integration') + ' need attention', detail: 'Degraded, slow or with open errors.',
        nav: 'integration-health', action: 'Open integration health' });
    }
    if (x.dlqOpen > 0) {
      items.push({ key: 'dlq', severity: 'medium', count: x.dlqOpen, title: plural(x.dlqOpen, 'transaction') + ' in the dead letter queue',
        detail: 'Failed for good after retries (RPT-17); target under 5 at month end.', nav: 'integration-health', action: 'Review the queue' });
    }
    if (x.syncExceptions > 0) {
      items.push({ key: 'sync-exceptions', severity: 'low', count: x.syncExceptions, title: plural(x.syncExceptions, 'item') + ' a Fusion sync could not apply',
        detail: 'Open sync exceptions.', nav: 'integration-health', action: 'Review' });
    }
    if (x.certs && (x.certs.expired || x.certs.expiring)) {
      items.push({ key: 'certificates', severity: x.certs.expired ? 'high' : 'low', count: x.certs.expired + x.certs.expiring,
        title: (x.certs.expired ? plural(x.certs.expired, 'certificate') + ' expired' : '') + (x.certs.expired && x.certs.expiring ? ', ' : '')
          + (x.certs.expiring ? plural(x.certs.expiring, 'certificate') + ' expiring within 30 days' : ''),
        detail: 'Equipment with an expired certificate should not go out.', nav: 'equipment', action: 'Open equipment' });
    }
    if (x.timesheetsSubmitted > 0) {
      items.push({ key: 'timesheets', severity: 'low', count: x.timesheetsSubmitted, title: plural(x.timesheetsSubmitted, 'timesheet week') + ' waiting approval',
        detail: 'Approved hours feed the costs.', nav: 'timesheet-approval', action: 'Open timesheet approval' });
    }
    if (x.finance && x.finance.weeksToPost > 0) {
      items.push({ key: 'post-costs', severity: 'low', count: x.finance.weeksToPost, title: plural(x.finance.weeksToPost, 'week') + ' of cost not posted',
        detail: money(x.finance.costPending) + ' incurred and not yet in Fusion Projects.', nav: 'post-costs', action: 'Open post costs' });
    }
    if (x.lockedUsers > 0) {
      items.push({ key: 'locked-users', severity: 'low', count: x.lockedUsers, title: plural(x.lockedUsers, 'customer portal account') + ' locked',
        detail: 'Locked after failed sign-ins; unlock in the customer account set-up.', nav: '', action: '' });
    }
    if (f.staleDrafts) {
      items.push({ key: 'drafts', severity: 'low', count: f.staleDrafts, title: plural(f.staleDrafts, 'draft') + ' whose start date has passed',
        detail: 'Submit them with new dates or delete them.', nav: 'my-requests', action: 'Open my requests' });
    }
    items.sort(function (a, b) { return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]; });
    return items;
  }

  /**
   * Everything the Administrator's Home shows.
   * @param {Object} x { requests, fleetGroups, unitStatusLabel, timesheetsSubmitted, finance: {weeksToPost, costPending}|null,
   *                     health (integrationHealth.model()), dlqOpen, syncExceptions, certifications, portalUsers, audit,
   *                     appRoles, modules: { FLAG: true|false }, settingsLoaded }
   * @param {number} now ms
   */
  function build(x, now) {
    x = x || {};
    var t = now || Date.now();
    var requests = x.requests || [];
    var f = requestFacts(requests, t);
    var fl = fleet(x.fleetGroups, x.unitStatusLabel);
    var h = x.health || {};
    var hc = h.counts || {};
    var cards = (h.cards || []);
    var certs = certificates(x.certifications, t);
    var locked = lockedUsers(x.portalUsers);
    var integrationsTotal = cards.length;
    var kpis = [
      { key: 'active', label: 'Active requests', value: String(f.active), hint: plural(f.project, 'project') + ' · ' + plural(f.customer, 'customer'), accent: 'info', nav: 'my-requests' },
      { key: 'deployed', label: 'Equipment deployed', value: fl.total ? String(fl.rented) : String(f.onSite),
        hint: fl.total ? 'units out of ' + fl.total : 'requests on site', accent: 'success', nav: 'schedule' },
      { key: 'approvals', label: 'Pending approvals', value: String(f.submitted), hint: f.urgentApprovals ? f.urgentApprovals + ' start within 3 days' : 'requests submitted', accent: f.urgentApprovals ? 'danger' : 'warning', nav: 'workbench' },
      { key: 'overdue', label: 'Overdue returns', value: String(f.overdue.length), hint: 'past end date, not back', accent: f.overdue.length ? 'danger' : 'success', nav: 'receipt' },
      { key: 'utilization', label: 'Fleet utilisation', value: fl.utilizationPct === null ? '–' : fl.utilizationPct + '%', hint: fl.total ? fl.available + ' units available' : 'no stock data', accent: 'info', nav: 'analytics' },
      { key: 'integrations', label: 'Integrations', value: integrationsTotal ? (hc.healthy || 0) + ' / ' + integrationsTotal : '–',
        hint: (hc.down ? hc.down + ' down' : (hc.attention ? hc.attention + ' need attention' : 'healthy')), accent: hc.down ? 'danger' : (hc.attention ? 'warning' : 'success'), nav: 'integration-health' }
    ];
    var recent = requests.slice().sort(function (a, b) {
      return Number(b.eqrEquipmentRequestId || 0) - Number(a.eqrEquipmentRequestId || 0);
    }).slice(0, 8).map(function (r) {
      return {
        id: r.eqrEquipmentRequestId, requestNumber: r.requestNumber || '—', source: isCustomer(r) ? 'Customer' : 'Project',
        who: isCustomer(r) ? (r.customerName || '—') : (r.projectName || '—'), requestor: r.requestorName || r.contactName || '—',
        status: statusOf(r), start: d10(r.startDate || r.requestedStartDate), end: d10(r.endDate || r.requestedEndDate),
        dates: dateText(r.startDate || r.requestedStartDate, r.endDate || r.requestedEndDate)
      };
    });
    return {
      kpis: kpis,
      attention: attention(f, { health: h, dlqOpen: x.dlqOpen || 0, syncExceptions: x.syncExceptions || 0, certs: certs,
        timesheetsSubmitted: x.timesheetsSubmitted || 0, finance: x.finance || null, lockedUsers: locked }),
      pipeline: pipeline(requests),
      totalRequests: requests.length,
      source: { project: f.project, customer: f.customer, projectPct: requests.length ? Math.round((f.project / requests.length) * 100) : 0 },
      overdue: f.overdue.slice(0, 5).map(function (o) {
        return { id: o.request.eqrEquipmentRequestId, requestNumber: o.request.requestNumber || '—', who: o.request.projectName || o.request.customerName || '—', days: o.days };
      }),
      fleet: fl,
      integrations: {
        counts: { healthy: hc.healthy || 0, attention: hc.attention || 0, down: hc.down || 0, running: hc.running || 0, idle: hc.idle || 0 },
        cards: cards.slice(0, 6).map(function (c) { return { key: c.key, name: c.name, health: c.health }; }),
        lastSync: (h.kpis && h.kpis.lastSync) || '–',
        lastSyncHint: (h.kpis && h.kpis.lastSyncHint) || '',
        dlqOpen: x.dlqOpen || 0
      },
      modules: MODULES.map(function (m) { return { key: m.key, label: m.label, on: !!(x.modules && x.modules[m.key]) }; }),
      changes: changes(x.audit, 5),
      access: { roles: (x.appRoles || []).length, lockedUsers: locked },
      certificates: certs,
      recent: recent
    };
  }

  return {
    STAGES: STAGES,
    MODULES: MODULES,
    pipeline: pipeline,
    requestFacts: requestFacts,
    fleet: fleet,
    certificates: certificates,
    lockedUsers: lockedUsers,
    changes: changes,
    attention: attention,
    build: build,
    dateText: dateText,
    money: money
  };
});
