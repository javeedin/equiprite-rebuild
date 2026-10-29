define(['resources/js/equipmentBoard'], (board) => {
  'use strict';

  // Equipment workbench: presentation helpers. The joining and the lane rules are resources/js/equipmentBoard.js.
  const LANE_LABEL = {};
  board.LANES.forEach((l) => { LANE_LABEL[l.key] = l.label; });

  class PageModule {
    laneLabel(key) {
      return LANE_LABEL[key] || key || '';
    }

    /** "2 Nov – 15 Dec" from ISO dates, or one of them. */
    range(start, end) {
      const a = board.fmtDay(start);
      const b = board.fmtDay(end);
      return a && b ? `${a} – ${b}` : (a || b || '');
    }

    /** The place line on a card: the project or customer when out, else the yard. */
    place(u) {
      if (!u) return '';
      if (u.party && (u.lane === 'out' || u.lane === 'due' || u.lane === 'overdue')) return u.party;
      return u.yard || u.party || '';
    }

    /** "SERIAL" -> "Serial", "LOT" -> "Lot", "ITEM" -> "Item". */
    typeLabel(t) {
      const s = String(t || '');
      return s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
    }

    /** "Next: REQ-123 · 5 Nov" or ''. */
    nextText(u) {
      return u && u.next ? `Next: ${u.next.requestNumber} · ${board.fmtDay(u.next.start)}` : '';
    }

    /** "1-day turnaround", "Back and out the same day". */
    turnaroundText(u) {
      if (!u || u.turnaround === null || u.turnaround === undefined) return '';
      if (u.turnaround <= 0) return u.turnaround < 0 ? 'Booked again before it is back' : 'Back and out the same day';
      return `${u.turnaround}-day turnaround`;
    }

    pct(n) {
      return n === null || n === undefined ? '–' : `${n}%`;
    }
  }

  return PageModule;
});
