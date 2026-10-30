define(['resources/js/requestList', 'resources/js/alerts', 'resources/js/rules'], function (list, alerts, rules) {
  'use strict';

  // My work: what each persona needs to see first, from the requests (and, for those who run the fleet, the units).
  //   tiles    the counts that matter to this persona, each opening the screen where it is dealt with
  //   needs    what waits on them now (alerts.derive: late, approvals, units to assign, deliveries, sent back)
  //   recent   their latest requests, read from the equipment
  //   actions  the screens this persona starts from (only those the role may open)

  var FLEET_PERSONAS = { EQUIP_ADMIN: 1, EQUIP_MGR: 1, INSPECTION: 1 };

  var SHORTCUTS = {
    EQUIP_ADMIN: ['approvals', 'requests', 'fleet', 'availability', 'analytics', 'settings'],
    EQUIP_MGR: ['approvals', 'requests', 'fleet', 'availability', 'picking', 'returns'],
    REQUESTOR: ['new-request', 'requests', 'timesheets'],
    INSPECTION: ['inspection', 'returns', 'fleet'],
    TIMEKEEPER: ['timesheets', 'requests'],
    TIME_APPROVER: ['approve-time', 'timesheets'],
    FINANCE_USER: ['costs', 'direct-costs', 'analytics']
  };

  function wantsFleet(persona) { return !!FLEET_PERSONAS[persona]; }

  /**
   * persona: a persona code; items: requestList.decorate(rows, …); linesByRequest; fleet: equipmentBoard.summary or null;
   * canOpen(navId): whether the role may open a screen. now: for lateness.
   */
  function build(persona, items, rows, linesByRequest, fleet, canOpen, now) {
    var open = canOpen || function () { return true; };
    var active = (items || []).filter(function (r) { return r.lane !== 'done'; });
    var late = active.filter(function (r) { return r.p.late.length; });
    var count = function (fn) { return active.filter(fn).length; };
    var pieces = function (stage) { return active.reduce(function (s, r) { return s + (r.p.counts[stage] || 0); }, 0); };
    var toAssign = active.reduce(function (s, r) {
      return s + ((linesByRequest || {})[r.requestNumber] || []).filter(function (l) { return /^(IN_PROCESS|QUOTE_ACCEPTED|APPROVED)$/.test(String(l.lineStatus || '')); }).length;
    }, 0);
    var tiles = [];
    var add = function (key, label, value, note, navId, tone) {
      if (navId && !open(navId)) return;
      tiles.push({ key: key, label: label, value: value, note: note || '', navId: navId || '', tone: tone || '' });
    };
    if (persona === 'EQUIP_MGR' || persona === 'EQUIP_ADMIN') {
      add('approval', 'Waiting for approval', count(function (r) { return r.p.counts.approval > 0; }), 'requests', 'approvals', 'approval');
      add('assign', 'Units to assign', toAssign, 'approved pieces', 'approvals', 'ready');
      add('late', 'Late', late.length, 'requests behind', 'requests', 'stopped');
      if (fleet) {
        add('due', 'Due back this week', fleet.due + fleet.overdue, fleet.overdue ? fleet.overdue + ' overdue' : 'units', 'fleet', 'ready');
        add('out', 'Out on rent', fleet.outNow, fleet.utilizationPct != null ? fleet.utilizationPct + '% of the fleet' : 'units', 'fleet', 'onsite');
        add('yard', 'In the yard', fleet.yard, fleet.going ? fleet.going + ' going out this week' : 'units', 'fleet', 'done');
      }
    } else if (persona === 'INSPECTION' && fleet) {
      add('back', 'Coming back', pieces('back'), 'pieces returning', 'returns', 'back');
      add('due', 'Due back this week', fleet.due + fleet.overdue, 'units', 'fleet', 'ready');
      add('maint', 'In maintenance', fleet.maint, 'units', 'fleet', 'approval');
    } else {
      add('open', 'Open requests', active.length, 'not finished', 'requests', 'approval');
      add('out', 'On the way to site', pieces('out'), 'pieces: accept them when they arrive', 'requests', 'out');
      add('onsite', 'On site', pieces('onsite'), 'pieces in use', 'requests', 'onsite');
      add('late', 'Late', late.length, 'requests behind', 'requests', 'stopped');
    }
    var needs = alerts.derive(persona, rows, linesByRequest, now).filter(function (a) {
      return !a.open || !a.open.navId || open(a.open.navId);
    }).sort(function (a, b) { return a.severity - b.severity; });
    var recent = (items || []).slice().sort(function (a, b) { return (Number(b.eqrEquipmentRequestId) || 0) - (Number(a.eqrEquipmentRequestId) || 0); }).slice(0, 6);
    var actions = (SHORTCUTS[persona] || SHORTCUTS.REQUESTOR).filter(function (id) { return open(id); });
    return { tiles: tiles, needs: needs, recent: recent, actions: actions };
  }

  return { build: build, wantsFleet: wantsFleet, SHORTCUTS: SHORTCUTS, personaLabel: rules.personaLabel, decorate: list.decorate };
});
