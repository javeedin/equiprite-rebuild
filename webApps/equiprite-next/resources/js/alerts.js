define(['resources/js/requestProgress'], function (Progress) {
  'use strict';

  // The bell: what needs the user, in one list.
  //
  //   derived   worked out from the requests and their equipment (requestProgress): what is late, and what waits on
  //             this persona (approvals, units to assign, deliveries to accept, requests sent back)
  //   updates   the notifications service (GET /notifications?userId=), read only; its field names are not
  //             documented, so several spellings are accepted
  //
  // Read marks are kept in this browser only (nothing is written to the server). A derived alert's id carries its
  // count, so "3 waiting" read is not hidden when it becomes 4.

  var READ_KEY = 'eqr.next.read';
  var MANAGER = { EQUIP_MGR: 1, EQUIP_ADMIN: 1 };

  function up(v) { return String(v == null ? '' : v).toUpperCase(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function pick(r, names) {
    for (var i = 0; i < names.length; i++) {
      var v = r && r[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  /**
   * Alerts worked out from requests (views/my-requests rows) and their lines by request number.
   * Each: { id, kind: 'late' | 'action' | 'info', severity: 1 high … 3 low, title, text, open: { record } | { navId } }
   */
  function derive(persona, rows, linesByRequest, now) {
    var out = [];
    var waitingApproval = 0;
    var toAssign = 0;
    var external = function (r) { return /^(EXTERNAL|CUSTOMER)$/i.test(String((r && r.requestOrigin) || '').trim()); };
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !r.requestNumber) return;
      var lines = (linesByRequest || {})[r.requestNumber] || [];
      var p = Progress.summarize(up(r.status || r.requestStatus), lines, { start: r.startDate, end: r.endDate, external: external(r), now: now });
      var open = { record: 'request', params: { id: r.eqrEquipmentRequestId, number: r.requestNumber } };
      p.late.forEach(function (l) {
        out.push({ id: 'late:' + r.requestNumber + ':' + l.kind + ':' + l.count, kind: 'late', severity: 1,
          title: r.requestNumber + (l.kind === 'overdue' ? ' is overdue' : ' is late'), text: l.text, open: open });
      });
      if (p.headline === 'Sent back') {
        out.push({ id: 'sentback:' + r.requestNumber, kind: 'action', severity: 2, title: r.requestNumber + ' was sent back',
          text: 'Fix it and send it again.', open: open });
      }
      if (p.counts.out > 0 && !MANAGER[persona]) {
        out.push({ id: 'delivery:' + r.requestNumber + ':' + p.counts.out, kind: 'action', severity: 2,
          title: plural(p.counts.out, 'piece', 'pieces') + ' on the way to ' + (r.projectName || r.customerName || 'site'),
          text: r.requestNumber + ': accept the delivery when it arrives.', open: open });
      }
      if (MANAGER[persona]) {
        if (p.stage === 'approval' || p.counts.approval > 0) waitingApproval += 1;
        active(lines).forEach(function (l) { if (/^(IN_PROCESS|QUOTE_ACCEPTED|APPROVED)$/.test(up(l.status || l.lineStatus))) toAssign += 1; });
      }
    });
    if (waitingApproval) {
      out.push({ id: 'approvals:' + waitingApproval, kind: 'action', severity: 2, title: plural(waitingApproval, 'request waits', 'requests wait') + ' for approval',
        text: 'Approve, or send back with a reason.', open: { navId: 'approvals' } });
    }
    if (toAssign) {
      out.push({ id: 'assign:' + toAssign, kind: 'action', severity: 2, title: plural(toAssign, 'piece needs', 'pieces need') + ' a unit assigned',
        text: 'Approved, with no unit allocated yet.', open: { navId: 'approvals' } });
    }
    return out;
  }

  function active(lines) {
    return (lines || []).filter(function (l) { return !/^(REJECTED|CANCELLED|DECLINED)$/.test(up(l && (l.status || l.lineStatus))); });
  }

  /** Notifications service rows -> alerts (kind 'info'), newest first. */
  function fromServer(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (r) {
      var id = pick(r, ['notificationId', 'id', 'eqrNotificationId']);
      var title = pick(r, ['subject', 'title', 'notificationTitle', 'eventName', 'notificationType', 'type']) || 'Notification';
      var text = pick(r, ['message', 'body', 'messageText', 'notificationText', 'description', 'details']) || '';
      var when = pick(r, ['createdDate', 'creationDate', 'createdOn', 'sentDate', 'notificationDate', 'lastUpdateDate']) || '';
      var read = String(pick(r, ['readFlag', 'isRead', 'read', 'status']) || '').toUpperCase();
      var number = pick(r, ['requestNumber', 'referenceNumber']);
      var reqId = pick(r, ['requestId', 'eqrEquipmentRequestId', 'referenceId']);
      return {
        id: 'n:' + (id != null ? id : title + when), kind: 'info', severity: 3, title: String(title), text: String(text), when: String(when),
        serverRead: read === 'Y' || read === 'TRUE' || read === 'READ',
        open: number || reqId ? { record: 'request', params: { id: reqId, number: number } } : null
      };
    }).sort(function (a, b) { return String(b.when).localeCompare(String(a.when)); });
  }

  /** One list: unread first, then by severity; with the unread count. */
  function merge(derived, updates, readIds) {
    var read = {};
    (readIds || []).forEach(function (id) { read[id] = 1; });
    var all = (derived || []).concat(updates || []).map(function (a) {
      return Object.assign({}, a, { read: !!(read[a.id] || a.serverRead) });
    });
    all.sort(function (a, b) { return (a.read - b.read) || (a.severity - b.severity) || String(b.when || '').localeCompare(String(a.when || '')); });
    return { items: all, unread: all.filter(function (a) { return !a.read; }).length };
  }

  /** Read marks kept in this browser; old ones are dropped once their alert is gone. */
  function loadRead() {
    try { return JSON.parse(localStorage.getItem(READ_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function saveRead(ids, current) {
    var keep = {};
    (current || []).forEach(function (a) { keep[a.id] = 1; });
    var list = (ids || []).filter(function (id, i, a) { return a.indexOf(id) === i && (!current || keep[id]); }).slice(-500);
    try { localStorage.setItem(READ_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
    return list;
  }

  return { derive: derive, fromServer: fromServer, merge: merge, loadRead: loadRead, saveRead: saveRead, READ_KEY: READ_KEY };
});
