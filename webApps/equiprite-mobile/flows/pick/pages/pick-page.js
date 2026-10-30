define(['resources/js/mobileBus', 'resources/js/mobilePick', 'resources/js/mobileRecent'], (bus, mp, recent) => {
  'use strict';

  // Pick & ship: binding helpers, and the page's lines to the outside: a request another tab or a deep link hands over
  // (mobileBus.focus('pick', …): focusRequest), the connection coming and going (connection), and the page being
  // hidden (hidden: the camera stops). The logic is resources/js/mobilePick.js over Next's resources/js/yardWork.js.
  let current = null;
  let bound = false;

  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      current = helper;
      const fire = (name, payload) => { if (current) current.fireCustomEvent(name, payload || {}); };
      bus.onFocus('pick', () => fire('focusRequest'));
      if (typeof window !== 'undefined' && !bound) {
        bound = true;
        window.addEventListener('online', () => fire('connection', { online: true }));
        window.addEventListener('offline', () => fire('connection', { online: false }));
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', () => { if (document.hidden) fire('hidden'); });
        }
      }
    }

    /** The class for a stage's colours. */
    stage(key) { return 'mb-stage--' + (key || 'ready'); }

    plural(n, one, many) { const v = Number(n) || 0; return v + ' ' + (v === 1 ? one : (many || one + 's')); }

    chipClass(chip, stage) { return 'mb-chip' + (chip && chip.key === stage ? ' mb-chip--on' : '') + (chip && chip.key === 'late' && chip.count ? ' mb-pick-chip--late' : ''); }

    chipCount(chip) { return chip && (chip.count || chip.key === 'all') ? String(chip.count) : ''; }

    whenClass(c) { return 'mb-pick-when mb-pick-when--' + ((c && c.tone) || 'plain'); }

    /** Where the next step is done: here, in New EquipRite, in Fusion. */
    whereText(where) { return { here: 'Here', new: 'In New EquipRite', fusion: 'In Fusion' }[where] || ''; }

    whereClass(where) { return 'mb-pick-where mb-pick-where--' + (where || 'none'); }

    yardLabel(yard) { return mp.yardLabel(yard); }

    /** "3 yards" for the yard button's note (All yards first in the chips). */
    yardCount(chips) { const n = Math.max(0, (chips || []).length - 1); return n === 1 ? '1 yard' : n + ' yards'; }

    /** "Last 3 days": the period the list opens on. */
    recentLabel() { return recent.LABEL; }

    /** The empty list, in words (older requests left out by the period: the line under it). */
    empty(records, stage, yard, text, dated) {
      if (!records || !records.length) return 'Nothing is waiting to go out of the yard.';
      if (text) return 'Nothing matches “' + text + '”.';
      const lately = dated && dated.filtered && dated.older > 0 ? ' ' + recent.PHRASE : '';
      if (yard && yard !== 'all') return 'Nothing to pick or ship from ' + yard + ' here' + lately + '.';
      if (stage && stage !== 'all') return 'Nothing at this stage' + lately + '.';
      return lately ? 'Nothing to pick or ship' + lately + '.' : 'Nothing to show.';
    }

    pieceClass(p, flash, canAct) {
      return 'mb-pick-piece mb-pick-piece--' + p.step + (p.ticked ? ' mb-pick-piece--on' : '') + (flash && flash === p.lineId ? ' mb-pick-piece--flash' : '')
        + (canAct && p.tickable ? '' : ' mb-pick-piece--fixed');
    }

    /** The round mark on a piece: ticked, shipped, waiting for Fusion, or (read-only) just the piece. */
    checkIcon(p, canAct) {
      if (p.step === 'shipped') return 'oj-ux-ico-truck';
      if (p.step === 'fusion') return 'oj-ux-ico-lock';
      if (!canAct) return 'oj-ux-ico-package';
      return p.ticked ? 'oj-ux-ico-check' : '';
    }

    /** A piece's line of units: "EX-2201" or "No unit assigned". */
    unit(p) { return (p && p.unit) || 'No unit assigned'; }

    qty(p) { return p && p.qty > 1 ? ' ×' + p.qty : ''; }

    bannerClass(b) { return 'mb-pick-banner mb-pick-banner--' + ((b && b.type) || 'info'); }

    resultClass(last) { return 'mb-pick-result mb-pick-result--' + ((last && last.tone) || 'info'); }

    resultIcon(last) {
      const t = last && last.tone;
      if (t === 'ok') return 'oj-ux-ico-check-circle';
      if (t === 'miss') return 'oj-ux-ico-error';
      if (t === 'warn') return 'oj-ux-ico-warning';
      return 'oj-ux-ico-information';
    }

    /** The Ship button: green once every piece it ships is ticked as picked. */
    shipClass(check) { return 'mb-btn ' + (check && check.shipAllTicked ? 'mb-btn--ok' : 'mb-btn--primary') + ' mb-pick-go'; }

    newUrl(base) { return mp.newUrl(base); }

    /** The line in Old EquipRite (line detail), where a unit is re-allocated (Next's link). */
    oldLineLink(oldAppUrl, req, lineId, lines) {
      if (!oldAppUrl || !req || !lineId) return '';
      const numericId = req.eqrEquipmentRequestId || req.id;
      if (!numericId) return '';
      const line = (Array.isArray(lines) ? lines : []).filter((l) => String(l.lineId) === String(lineId))[0] || {};
      const base = oldAppUrl.slice(-1) === '/' ? oldAppUrl : oldAppUrl + '/';
      return base + 'vp/shell/equipment-foundation/line-detail?requestId=' + encodeURIComponent(numericId)
        + '&requestNumber=' + encodeURIComponent(req.requestNumber || '') + '&lineId=' + encodeURIComponent(lineId)
        + '&equipmentMasterId=' + encodeURIComponent(line.equipmentMasterId != null ? line.equipmentMasterId : '');
    }

    /** The open request's other pieces, not at a picking step (Next's "Also on this request"). */
    others(linesBy, openId, lines, external) { return mp.otherLines((linesBy || {})[openId], lines, external); }

    /** When the open request must ship, in words. */
    when(req) { return mp.whenText(req, Date.now()); }

    late(req) { return /late/.test(mp.whenText(req, Date.now())); }

    subline(req) { return [req && req.party, req && req.task].filter((x) => !!x).join(' · ') || 'No project'; }

    // ── The pick slip (DOM only) ───────────────────────────────────────────────────────────────────────────
    /** Whether the phone can hand a file to another app (its share sheet: print, mail, a chat). */
    canShareFiles() {
      try {
        if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File === 'undefined') return false;
        return navigator.canShare({ files: [new File([''], 'pick-slip.pdf', { type: 'application/pdf' })] });
      } catch (e) {
        return false;
      }
    }

    downloadSlip(url, fileName) {
      if (!url) return false;
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'pick-slip.pdf';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    }

    /** The slip to the phone's share sheet; { ok, cancelled } (a person closing the sheet is not a failure). */
    async shareSlip(url, fileName, title) {
      try {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], fileName || 'pick-slip.pdf', { type: 'application/pdf' });
        await navigator.share({ files: [file], title: title || 'Pick slip' });
        return { ok: true, cancelled: false };
      } catch (e) {
        return { ok: false, cancelled: !!(e && e.name === 'AbortError') };
      }
    }
  }

  return PageModule;
});
