define(['resources/js/inspectionRules', 'resources/js/fmt', 'resources/js/requestProgress'], function (Rules, fmt, Progress) {
  'use strict';

  // The inspector's queue in EquipRite Next (FDD 7.12, 7.17.3, S16, DP-03): every unit waiting at one of the four
  // inspection points, read the way New EquipRite reads it (resources/js/inspectionRules.js is New's inspection page
  // module, unchanged: points, the inspection matrix, "asked for" or "everything waiting", the order). What this adds
  // is the screen's words: where each unit is going, when it is needed, what is late, the chips, the export, and what
  // "Complete inspection" is about to do. Display only: nothing here writes.

  var rules = new Rules();
  var DAY = 86400000;

  // The four points in plain words, and the journey colour each sits in (resources/css/next.css .nx-stage--*).
  var POINTS = {
    SHIP_OUT_YARD: { label: 'Leaving the yard', stage: 'ready', short: 'Before it ships from the yard' },
    RECEIVE_SITE: { label: 'Arriving on site', stage: 'out', short: 'When it reaches the site' },
    SHIP_OUT_SITE: { label: 'Leaving a site', stage: 'back', short: 'Before it leaves the site' },
    RECEIVE_YARD: { label: 'Back at the yard', stage: 'back', short: 'When it is back at the yard' }
  };
  var ORDER = ['SHIP_OUT_YARD', 'RECEIVE_SITE', 'SHIP_OUT_SITE', 'RECEIVE_YARD'];
  var FAILED = 'INSPECTION_FAILED';

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function low(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function iso(v) { return v ? String(v).slice(0, 10) : ''; }

  function pointWords(key) {
    return POINTS[key] || { label: rules.pointLabel(key) || 'Inspection', stage: 'ready', short: '' };
  }

  /** The stored line status in words. INSPECTION_FAILED (DP-03) is not in requestProgress's list, so it is named here. */
  function lineWords(status) {
    if (up(status) === FAILED) return 'Failed inspection';
    return Progress.line(status).label;
  }

  /** When the unit is needed, and whether that has passed. Only a unit still at the yard can be late to ship. */
  function timing(l, point, now) {
    var start = iso(l.startDate || l.requestedStartDate);
    var end = iso(l.endDate || l.requestedEndDate);
    var today = fmt.today(now);
    if (point === 'SHIP_OUT_YARD' && start) {
      var s = fmt.dayMs(start);
      var days = Math.round((today - s) / DAY);
      if (days > 0) {
        return { when: 'Needed on site ' + fmt.date(start), late: true, lateDays: days,
          lateText: 'Needed on site since ' + fmt.date(start, false) + ' · ' + days + (days === 1 ? ' day late' : ' days late') };
      }
      return { when: 'Needed on site ' + fmt.date(start) + ' (' + fmt.relative(start, now) + ')', late: false, lateDays: 0, lateText: '' };
    }
    if (point === 'RECEIVE_SITE' && start) return { when: 'Due on site ' + fmt.date(start), late: false, lateDays: 0, lateText: '' };
    if ((point === 'SHIP_OUT_SITE' || point === 'RECEIVE_YARD') && end) return { when: 'Rental ends ' + fmt.date(end), late: false, lateDays: 0, lateText: '' };
    return { when: '', late: false, lateDays: 0, lateText: '' };
  }

  /**
   * Queue entries: New's queue (every point, `scope` 'required' or 'all', in New's order: asked for first, then the
   * earliest needed) with the words this screen shows on each unit.
   */
  function entries(lines, matrix, scope, now) {
    return rules.queue(lines, matrix, '', '', scope).map(function (l) {
      var p = pointWords(l.point);
      var t = timing(l, l.point, now);
      var failed = up(l.lineStatus) === FAILED;
      return Object.assign({}, l, {
        unit: rules.unitText(l),
        pointWords: p.label,
        stage: failed ? 'stopped' : p.stage,
        failed: failed,
        statusWords: lineWords(l.lineStatus),
        when: t.when,
        late: t.late,
        lateDays: t.lateDays,
        lateText: t.lateText,
        party: l.projectName || l.customerName || '',
        hay: [l.equipmentName, l.allocatedSerial, l.className, l.requestNumber, l.projectName, l.customerName, l.taskName, p.label]
          .map(low).join(' ')
      });
    });
  }

  /** The chips: everything, what is late, each point, and the failed units waiting on a decision. */
  function chips(list) {
    var all = Array.isArray(list) ? list : [];
    var out = [{ key: 'all', label: 'Everything waiting', count: all.length },
      { key: 'late', label: 'Late', count: all.filter(function (e) { return e.late; }).length }];
    ORDER.forEach(function (k) {
      out.push({ key: k, label: POINTS[k].label, count: all.filter(function (e) { return e.point === k && !e.failed; }).length });
    });
    out.push({ key: 'failed', label: 'Failed, needs a decision', count: all.filter(function (e) { return e.failed; }).length });
    return out;
  }

  /** What a chip and the search leave. A failed unit sits under Failed, not under Leaving the yard. */
  function filter(list, chip, text) {
    var q = low(text);
    return (Array.isArray(list) ? list : []).filter(function (e) {
      if (chip === 'late' && !e.late) return false;
      if (chip === 'failed' && !e.failed) return false;
      if (POINTS[chip] && (e.point !== chip || e.failed)) return false;
      return !q || e.hay.indexOf(q) !== -1;
    });
  }

  /** "5 units to inspect · 2 leaving the yard · 1 failed · 1 late". */
  function summary(list) {
    var all = Array.isArray(list) ? list : [];
    if (!all.length) return 'Nothing waiting for an inspection';
    var parts = [fmt.count(all.length, 'unit') + ' to inspect'];
    ORDER.forEach(function (k) {
      var n = all.filter(function (e) { return e.point === k && !e.failed; }).length;
      if (n) parts.push(n + ' ' + POINTS[k].label.toLowerCase());
    });
    var failed = all.filter(function (e) { return e.failed; }).length;
    if (failed) parts.push(failed + ' failed');
    var late = all.filter(function (e) { return e.late; }).length;
    if (late) parts.push(late + ' late');
    return parts.join(' · ');
  }

  /** Excel columns for the queue as shown. */
  function exportColumns() {
    return [
      { key: 'equipmentName', label: 'Equipment' },
      { key: 'allocatedSerial', label: 'Serial' },
      { key: 'className', label: 'Class' },
      { key: 'requestNumber', label: 'Request' },
      { key: 'party', label: 'Project or customer' },
      { key: 'pointWords', label: 'Inspection' },
      { key: 'required', label: 'Asked for by the matrix', value: function (e) { return e.required ? 'Yes' : 'No'; } },
      { key: 'statusWords', label: 'Where it is' },
      { key: 'when', label: 'When' },
      { key: 'lateDays', label: 'Days late', type: 'number', value: function (e) { return e.late ? e.lateDays : ''; } },
      { key: 'lineStatus', label: 'Stored line status' }
    ];
  }

  /** The tone of a result, in the journey colours: pass green, conditional amber, fail red, not finished grey. */
  function tone(code, finished) {
    if (!finished) return 'draft';
    return { PASS: 'onsite', CONDITIONAL: 'ready', FAIL: 'stopped' }[code] || 'draft';
  }

  /**
   * What "Complete inspection" is about to write, in words (every action says what it will do before it does it).
   * The calls are New's completeInspectionChain: the inspection, the answers, the defects and their photos, completed
   * with the result, then the line status at the yard ship-out only.
   */
  function willDo(point, code, finished, ack, answered, defects, saved) {
    if (!finished) return '';
    var unsaved = (Array.isArray(defects) ? defects : []).filter(function (d) { return !d.saved; }).length;
    var what = [fmt.count(answered, 'answer')];
    if (unsaved) what.push(unsaved === 1 ? '1 defect with its photo' : unsaved + ' defects with their photos');
    var start = saved && saved.inspectionId ? 'Finishes inspection ' + saved.inspectionId + ' with ' : 'Saves the inspection with ';
    var text = start + what.join(' and ') + ', completed as ' + ({ PASS: 'Pass', CONDITIONAL: 'Conditional', FAIL: 'Fail' }[code] || code) + '. ';
    var status = rules.lineStatusAfter(point, code, ack);
    if (status === 'INSPECTION_FAILED') return text + 'The line is marked Failed inspection and cannot ship.';
    if (status === 'EQP_INSPECTION_COMPLETE') return text + 'The line is marked Inspected, ready to ship.';
    if (point === 'SHIP_OUT_YARD') return text + 'The line stays as it is until the result is acknowledged.';
    return text + 'The line status does not change here: the ' + (point === 'SHIP_OUT_SITE' ? 'return' : 'receipt') + ' itself is done in Receiving & returns.';
  }

  return {
    POINTS: POINTS,
    ORDER: ORDER,
    pointWords: pointWords,
    lineWords: lineWords,
    timing: timing,
    entries: entries,
    chips: chips,
    filter: filter,
    summary: summary,
    exportColumns: exportColumns,
    tone: tone,
    willDo: willDo
  };
});
