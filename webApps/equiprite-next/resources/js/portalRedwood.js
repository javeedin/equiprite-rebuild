define(['resources/js/fmt', 'resources/js/requestList'], function (fmt, list) {
  'use strict';

  // The customer portal's Redwood view (your menu, Look): its requests as Old's customer My requests page shows them,
  // Oracle's Smart Search over an oj-table. Here: the table's rows, one plain row per request shown (so the template
  // binds plain values), every column filter's options with how many requests have each (from all the requests, not just
  // the ones shown), and the column filters on the rows. The rows come from the portal's own (portalView.decorate, its
  // chip and search applied); the column filters narrow the Redwood rows only. The header's badge, for the records.
  // Pure: no calls. Customers never see a unit's own number: no row carries one.

  // Oracle's own badge classes per stage (the same as the Redwood Requests table, requestList.js).
  var BADGE = {
    draft: 'oj-badge oj-badge-subtle', approval: 'oj-badge oj-badge-info oj-badge-subtle', ready: 'oj-badge oj-badge-warning oj-badge-subtle',
    out: 'oj-badge oj-badge-info', onsite: 'oj-badge oj-badge-success oj-badge-subtle', back: 'oj-badge oj-badge-info oj-badge-subtle',
    done: 'oj-badge oj-badge-subtle', stopped: 'oj-badge oj-badge-danger oj-badge-subtle'
  };
  // The general overview page's badge status per stage (oj-sp: success, info, warning, danger, neutral).
  var STATUS = { draft: 'neutral', approval: 'info', ready: 'warning', out: 'info', onsite: 'success', back: 'info', done: 'neutral', stopped: 'danger' };
  var NOTHING = 'Nothing for now';
  var NO_CONTRACT = 'No contract yet';
  // The filters, in the table's column order, then the portal's own chip (Needs you, Open, Finished, All).
  var COLUMNS = ['number', 'dates', 'status', 'next', 'contract'];

  function str(v) { return v == null ? '' : ('' + v).trim(); }
  function badge(tone) { return BADGE[tone] || BADGE.draft; }

  /** The general overview page's badge for a record: { text, status }. */
  function headerBadge(text, tone) { return { text: str(text), status: STATUS[tone] || 'neutral' }; }

  function statusOf(r) { return str(r && r.headline) || '—'; }
  function nextOf(r) { return str(r && r.next) || NOTHING; }
  function contractOf(r) { return str(r && r.contractNumber) || NO_CONTRACT; }

  /** The oj-table's rows: what each cell says, for the requests shown (portalView.decorate rows). */
  function rows(shown, now) {
    return (Array.isArray(shown) ? shown : []).map(function (r) {
      var p = r.p || {};
      return {
        key: str(r.id),
        number: str(r.requestNumber),
        raised: r.createdDate ? 'Raised ' + fmt.date(r.createdDate, false) : '',
        dates: str(r.dates) || '—',
        when: str(r.when),
        status: statusOf(r),
        badge: badge(p.tone),
        detail: str(r.detail) || (r.linesRead ? '' : (r.lines ? r.lines + (r.lines === 1 ? ' line' : ' lines') : '')),
        next: str(r.next) || '—',
        mine: !!r.mine,
        late: str(r.late),
        contract: str(r.contractNumber) || '—'
      };
    });
  }

  // Options with their counts, by label: [{ value, label: 'On your site (3)' }].
  function tally(items, valueOf) {
    var counts = {};
    (items || []).forEach(function (r) { var v = valueOf(r); if (v) counts[v] = (counts[v] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); })
      .map(function (v) { return { value: v, label: v + ' (' + counts[v] + ')' }; });
  }

  /**
   * Every filter's options, from all the customer's requests: Request, Dates (the rental's window, as on Requests),
   * Where your equipment is, Next, Contract, then Show (the portal's chips, with their counts).
   */
  function options(all, chips, now) {
    var items = Array.isArray(all) ? all : [];
    var inWindow = {};
    items.forEach(function (r) { list.dateKeys(r, now).forEach(function (k) { inWindow[k] = (inWindow[k] || 0) + 1; }); });
    return {
      number: items.slice().sort(function (a, b) { return (Number(b.id) || 0) - (Number(a.id) || 0); })
        .filter(function (r) { return str(r.requestNumber); })
        .map(function (r) { return { value: str(r.requestNumber), label: str(r.requestNumber) + (r.headline ? ' · ' + r.headline : '') }; }),
      dates: list.DATE_WINDOWS.map(function (w) { return { value: w.key, label: w.label + ' (' + (inWindow[w.key] || 0) + ')' }; }),
      status: tally(items, statusOf),
      next: tally(items, nextOf),
      contract: tally(items, contractOf),
      group: (Array.isArray(chips) ? chips : []).map(function (c) { return { value: c.key, label: c.label + ' (' + c.count + ')' }; })
    };
  }

  /** The requests that match every column filter set: { number, dates, status, next, contract } ('' = any). */
  function byColumns(items, f, now) {
    var c = f || {};
    return (Array.isArray(items) ? items : []).filter(function (r) {
      if (c.number && str(r.requestNumber) !== c.number) return false;
      if (c.dates && list.dateKeys(r, now).indexOf(c.dates) === -1) return false;
      if (c.status && statusOf(r) !== c.status) return false;
      if (c.next && nextOf(r) !== c.next) return false;
      if (c.contract && contractOf(r) !== c.contract) return false;
      return true;
    });
  }

  /**
   * Smart Search's criterion as the portal's own state: the text typed, the Show chip ('all' when none is picked) and a
   * value per column. The criterion is a tree: a text node, and $eq nodes for a filter's field, the value either on the
   * node or inside an object (as Old's pages and Requests read it).
   */
  function readCriterion(c) {
    var out = { text: '', group: 'all', cols: { number: '', dates: '', status: '', next: '', contract: '' } };
    function pick(field, val) {
      var value = val === undefined || val === null ? '' : ('' + val);
      if (field === 'group') out.group = value || 'all';
      else if (COLUMNS.indexOf(field) !== -1) out.cols[field] = value;
    }
    function read(node) {
      if (!node) return;
      if (Array.isArray(node.criteria)) node.criteria.forEach(read);
      if (node.text !== undefined && node.text !== null) out.text = ('' + node.text).trim();
      if (node.op === '$eq') {
        if (node.attribute) pick(node.attribute, node.value);
        else if (node.value && typeof node.value === 'object') Object.keys(node.value).forEach(function (k) { pick(k, node.value[k]); });
      }
    }
    read(c);
    return out;
  }

  return {
    BADGE: BADGE, STATUS: STATUS, COLUMNS: COLUMNS, badge: badge, headerBadge: headerBadge, rows: rows, options: options,
    byColumns: byColumns, readCriterion: readCriterion
  };
});
