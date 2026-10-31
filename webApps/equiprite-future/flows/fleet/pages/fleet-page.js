define(['resources/js/equipmentBoard', 'resources/js/exportKit'], (board, exportKit) => {
  'use strict';

  // Fleet: binding helpers. Joining the views and the lane rules: resources/js/equipmentBoard.js.
  const LANE_LABEL = {};
  board.LANES.forEach((l) => { LANE_LABEL[l.key] = l.label; });

  class PageModule {
    formats() { return exportKit.FORMATS; }

    /** The lane tiles, in the order a unit moves through them, then the turnaround warning. */
    tiles() {
      return [{ k: 'yard', l: 'In the yard' }, { k: 'going', l: 'Going out this week' }, { k: 'out', l: 'Out on rent' },
        { k: 'due', l: 'Due back this week' }, { k: 'overdue', l: 'Overdue' }, { k: 'maint', l: 'Maintenance' }, { k: 'tight', l: 'Tight turnaround' }];
    }
    laneLabel(key) { return LANE_LABEL[key] || key || ''; }

    /** "2 Nov – 15 Dec", or one of them. */
    range(start, end) {
      const a = board.fmtDay(start);
      const b = board.fmtDay(end);
      return a && b ? a + ' – ' + b : (a || b || '');
    }

    /** Where it is: the project or customer when out, else the yard. */
    place(u) {
      if (!u) return '';
      if (u.party && (u.lane === 'out' || u.lane === 'due' || u.lane === 'overdue')) return u.party;
      return u.yard || u.party || '';
    }

    typeLabel(t) {
      const s = t ? '' + t : '';
      return s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
    }

    /** "Next: REQ-123 on 5 Nov", or ''. */
    nextText(u) { return u && u.next ? 'Next: ' + u.next.requestNumber + ' on ' + board.fmtDay(u.next.start) : ''; }

    /** "1-day turnaround", "Back and out the same day". */
    turnaroundText(u) {
      if (!u || u.turnaround === null || u.turnaround === undefined) return '';
      if (u.turnaround <= 0) return u.turnaround < 0 ? 'Booked again before it is back' : 'Back and out the same day';
      return u.turnaround + '-day turnaround';
    }

    pct(n) { return n === null || n === undefined ? '–' : n + '%'; }

    /** The tile a lane filter sits on is "on". */
    tileOn(key, lane, tight) { return key === 'tight' ? !!tight : (!tight && lane === key); }
  }

  return PageModule;
});
