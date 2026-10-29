/**
 * Smart-search criterion → per-endpoint query params, for the Analytics and
 * Reports pages.
 *
 * WHY THIS EXISTS
 * Both pages render with oj-data-grid + a custom DataGridProvider, which cannot
 * be driven by a ServiceDataProvider/ListDataProviderView the way oj-table can.
 * So instead of an SDP transform, the criterion is translated here and handed to
 * the same `Actions.callRest` the pages already use — the search is genuinely
 * server-side, it just isn't wearing an SDP.
 *
 * SCOPING IS THE POINT
 * Every endpoint gets its OWN param map below. A criterion field that the active
 * endpoint does not support is dropped rather than forwarded, because an
 * undeclared uriParam is silently discarded by VBCS and a *declared but wrong*
 * one would filter on a column the view doesn't have. This is what keeps a
 * search on the Rate Exceptions tab from emitting Rental-Requests params.
 *
 * Criterion shapes handled (via catalogCriterion.flatten):
 *   keyword        → { text:'crane', matchBy:'phrase' }          → q
 *   single chip    → { op:'$eq', value:{ className:'Cranes' } }  → className
 *   flat chip      → { op:'$eq', attribute:'className', value }  → className
 *   combined       → { $tag:'_root_', op:'$and', criteria:[...] }
 *
 * Param names are verified against services/eqp-v1/openapi3.json — see
 * ENDPOINT_PARAMS. Adding a mapping here without declaring the param in the
 * spec is a silent no-op.
 */
define(['resources/js/catalogCriterion'], function (catalogCriterion) {
  'use strict';

  /**
   * criterion-field → query-param, per endpoint key.
   *
   * `_q` is the free-text param name (always 'q' today, but kept explicit so an
   * endpoint that names it differently doesn't need special-casing).
   *
   * Only fields listed for an endpoint are forwarded. Everything else is dropped.
   */
  var ENDPOINT_PARAMS = {
    // ── Analytics ────────────────────────────────────────────────────────────
    // yard-stock: invOrgId, unitStatus, groupBy, className, unitType, q, page, size
    // NB invOrgId here is the views' yard key, which equals inv-orgs'
    // ORGANIZATION_ID — not inv-orgs' own invOrgId column. Looking a yard name up
    // by the wrong one silently returns nothing.
    'yard-stock': {
      _q: 'q',
      className:  'className',
      unitStatus: 'unitStatus',
      unitType:   'unitType',
      invOrgId:   'invOrgId'
    },
    // onhand-qty: invOrgId, groupBy, className, minQty, maxQty, q, page, size
    'onhand-qty': {
      _q: 'q',
      className: 'className',
      minQty:    'minQty',
      maxQty:    'maxQty',
      invOrgId:  'invOrgId'
    },
    // pending-approval-lines: invOrgId, lineStatus, unitType, includeAll,
    //                         groupBy, className, fromDate, toDate, q, page, size
    'pending-approval-lines': {
      _q: 'q',
      className:  'className',
      lineStatus: 'lineStatus',
      unitType:   'unitType',
      includeAll: 'includeAll',
      invOrgId:   'invOrgId',
      fromDate:   'fromDate',
      toDate:     'toDate'
    },
    // yard-utilization: fromDate, toDate, invOrgId, lineStatus, unitType, days, q, page, size
    // NB fromDate/toDate are the REQUIRED window and are supplied by the page,
    // not by search — deliberately not mapped here so a stray date chip cannot
    // widen or break the window.
    // unitType stays mapped but NO CHIP EMITS IT today — the Unit Type chip was
    // removed from this tab, so equip-utilization.json declares no filters at
    // all. The mapping is kept because this table documents what the ENDPOINT
    // accepts, not what the UI currently offers: unitType is the one unit filter
    // that is safe here, since it scopes BOTH the fleet (denominator) and the
    // deployed units (numerator). lineStatus is deliberately absent — it filters
    // the numerator only, which yields a misleading utilisation ratio.
    'yard-utilization': {
      _q: 'q',
      unitType: 'unitType'
    },

    // ── Reports ──────────────────────────────────────────────────────────────
    // equipment-history: equipmentMasterId, serialNumber, allocationStatus,
    //                    lineStatus, projectNumber, duration, fromDate, toDate, q
    // NB there is no equipmentName param here — this view filters equipment by
    // ID, so the Equipment chip on this tab is EquipMasterFilter (value =
    // equipmentMasterId), not the name-based one used on Rate Exceptions.
    'equipment-history': {
      _q: 'q',
      equipmentMasterId: 'equipmentMasterId',
      serialNumber:     'serialNumber',
      allocationStatus: 'allocationStatus',
      lineStatus:       'lineStatus',
      projectNumber:    'projectNumber',
      duration:         'duration',
      fromDate:         'fromDate',
      toDate:           'toDate'
    },
    // rental-requests: requestNumber, projectName, customerName, lineStatus,
    //                  requestStatus, equipmentClass, dateFrom, dateTo, procurement, q
    // NB this view names its window dateFrom/dateTo, not fromDate/toDate.
    'rental-requests': {
      _q: 'q',
      requestNumber:  'requestNumber',
      projectName:    'projectName',
      customerName:   'customerName',
      lineStatus:     'lineStatus',
      requestStatus:  'requestStatus',
      equipmentClass: 'equipmentClass',
      fromDate:       'dateFrom',
      toDate:         'dateTo',
      procurement:    'procurement'
    },
    // project-cost-detail: projectNumber, customerName, requestNumber,
    //                      equipmentNumber, yardLocation, postedStatus, q
    'project-cost-detail': {
      _q: 'q',
      projectNumber:   'projectNumber',
      customerName:    'customerName',
      requestNumber:   'requestNumber',
      equipmentNumber: 'equipmentNumber',
      yardLocation:    'yardLocation',
      postedStatus:    'postedStatus'
    },
    // rate-exceptions: equipmentName, equipmentClass, subclass, yard, q
    'rate-exceptions': {
      _q: 'q',
      equipmentName:  'equipmentName',
      equipmentClass: 'equipmentClass',
      subclass:       'subclass',
      yard:           'yard'
    },
    // rate-sched-lines: className, effectiveFrom, effectiveTo, scheduleCode,
    //                   scheduleName, rateType, isActiveFlag, periodType, q
    'rate-sched-lines': {
      _q: 'q',
      className:    'className',
      scheduleCode: 'scheduleCode',
      scheduleName: 'scheduleName',
      rateType:     'rateType',
      isActiveFlag: 'isActiveFlag',
      periodType:   'periodType',
      fromDate:     'effectiveFrom',
      toDate:       'effectiveTo'
    },
    // agreement-expiry: agreementType, status, expiryStatus, customerRefId,
    //                   lineStatus, allocationStatus, q
    'agreement-expiry': {
      _q: 'q',
      agreementType:    'agreementType',
      status:           'status',
      expiryStatus:     'expiryStatus',
      customerRefId:    'customerRefId',
      lineStatus:       'lineStatus',
      allocationStatus: 'allocationStatus'
    }
  };

  /**
   * Pull { field, value } pairs out of a criterion, plus the free-text term.
   * Returns { q: string|undefined, fields: { field: value } }.
   */
  function readCriterion(criterion) {
    var out = { q: undefined, fields: {} };
    if (!criterion) return out;

    catalogCriterion.flatten(criterion).forEach(function (part) {
      var node = part.node;
      if (!node) return;

      // Keyword node — no field.
      if (node.text && node.matchBy) {
        var t = String(node.text).trim();
        if (t) out.q = t;
        return;
      }

      // Chip node — value may be nested under the field name or flat.
      var field = part.field;
      if (!field) return;
      var value = (node.value && typeof node.value === 'object' && field in node.value)
        ? node.value[field]
        : node.value;

      if (value === null || value === undefined || value === '') return;
      out.fields[field] = value;
    });

    return out;
  }

  /**
   * Translate a criterion into uriParams for ONE endpoint.
   *
   *   toUriParams('rate-exceptions', criterion)
   *     → { q:'crane', equipmentClass:'Lifting and Cranes' }
   *
   * Fields the endpoint doesn't declare are dropped. Returns {} for no criterion,
   * so callers can always spread the result.
   */
  function toUriParams(endpointKey, criterion) {
    var map = ENDPOINT_PARAMS[endpointKey];
    if (!map) {
      console.warn('[reportCriterion] unknown endpoint key: ' + endpointKey);
      return {};
    }

    var read = readCriterion(criterion);
    var params = {};

    if (read.q !== undefined && map._q) params[map._q] = read.q;

    Object.keys(read.fields).forEach(function (field) {
      var param = map[field];
      // Guard against the reserved key: a criterion field literally named "_q"
      // must not be treated as the free-text mapping.
      if (!param || field === '_q') return;
      params[param] = read.fields[field];
    });

    return params;
  }

  /**
   * Stable signature of a criterion for an endpoint — lets a caller skip a
   * refetch when the criterion changed in a way this endpoint ignores (e.g. a
   * chip for a field it doesn't support).
   */
  function signature(endpointKey, criterion) {
    var p = toUriParams(endpointKey, criterion);
    return Object.keys(p).sort().map(function (k) { return k + '=' + p[k]; }).join('&');
  }

  /** Which criterion fields an endpoint actually honours (for suggestion chips). */
  function supportedFields(endpointKey) {
    var map = ENDPOINT_PARAMS[endpointKey] || {};
    return Object.keys(map).filter(function (k) { return k !== '_q'; });
  }

  return {
    toUriParams:     toUriParams,
    readCriterion:   readCriterion,
    signature:       signature,
    supportedFields: supportedFields,
    ENDPOINT_PARAMS: ENDPOINT_PARAMS
  };
});
