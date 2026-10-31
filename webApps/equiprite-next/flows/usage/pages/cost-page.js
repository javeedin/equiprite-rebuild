define(['resources/js/costPreview', 'resources/js/costPosting', 'resources/js/exportKit', 'resources/js/fmt'], (CP, costPosting, exportKit, fmt) => {
  'use strict';

  // A request's costs: binding helpers. The figures and the posting rules are New EquipRite's (resources/js/costPreview.js
  // CostRules, New's Post costs page module unchanged); what is ticked, the confirmation's words, the calls as they will
  // be sent and the grid's rows are resources/js/costPosting.js.
  class PageModule extends CP.CostPreview {
    formats() { return exportKit.FORMATS; }

    money(n) { return fmt.money(n) || '$0'; }

    range(a, b) { return fmt.range(a, b); }

    plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

    /** The heading's pill: what is left to do on this request. */
    headWord(f) {
      if (!f || f.ready == null) return '';
      if (f.ready > 0) return this.money(f.ready) + ' ready to post';
      if (f.running > 0) return 'Running, nothing ready yet';
      if (f.posted > 0) return 'All posted';
      return 'Nothing to post';
    }

    headTone(f) {
      if (!f || f.ready == null) return 'draft';
      if (f.ready > 0) return 'ready';
      if (f.running > 0) return 'out';
      if (f.posted > 0) return 'onsite';
      return 'draft';
    }

    subline(row) {
      const r = row || {};
      const parts = [];
      if (r.projectName && r.projectName !== '—') parts.push(r.projectName + (r.taskName && r.taskName !== '—' ? ' / ' + r.taskName : ''));
      if (r.ppmProjectNumber) parts.push('PPM ' + r.ppmProjectNumber + (r.ppmTaskNumber ? ' / ' + r.ppmTaskNumber : ''));
      const dates = fmt.range(r.startDate, r.endDate);
      if (dates) parts.push(dates);
      return parts.join(' · ');
    }

    readyNote(f) {
      if (!f) return '';
      const parts = [];
      if (f.readyWeeks) parts.push(this.plural(f.readyWeeks, 'week') + ' ended');
      if (f.readyCharges) parts.push(this.plural(f.readyCharges, 'charge') + ' not posted');
      return parts.length ? parts.join(' + ') : 'Nothing has ended that is not posted';
    }

    // ── posting ──

    /** The head's Post button: what it posts, or why it cannot. */
    postLabel(all) {
      const s = this.selection(all);
      return s.items ? 'Post ' + costPosting.itemsText(s) + ' · ' + this.money(s.cost) : 'Tick what to post';
    }

    /** "3 weeks and 1 charge ticked, $3,590" over the grid. */
    tickedText(all) {
      const s = this.selection(all);
      return s.items ? costPosting.itemsText(s) + ' ticked, ' + this.money(s.cost) : 'Nothing ticked';
    }

    readyCount(all) {
      return (all || []).filter((r) => costPosting.tickable(r)).length;
    }

    sentence(all, row) { return costPosting.sentence(all, this.hdrOf(row)); }

    steps(all, row) { return costPosting.steps(all, row && row.requestNumber); }

    calls(all, row) { return costPosting.calls(all, row); }

    gridRows(all, row, readOnly) { return costPosting.gridRows(all, this.hdrOf(row), readOnly); }

    /** The grid's row class: its kind, and whether it is ticked. */
    rowClass(t) {
      return 'nx-row nx-pr-row nx-pr-row--' + t.kind + (t.on ? ' nx-pr-row--on' : '') + (t.excluded ? ' nx-pr-row--out' : '');
    }

    /** A line's state in the post dialog and the result: its pill. */
    stateTone(state) {
      return { waiting: 'draft', posting: 'out', recorded: 'approval', posted: 'onsite', failed: 'stopped', skipped: 'draft' }[state] || 'draft';
    }

    stateWord(state) {
      return { waiting: 'Waiting', posting: 'Sending…', recorded: 'Recorded', posted: 'Posted', failed: 'Not posted', skipped: 'Not sent' }[state] || '';
    }

    /** The post dialog's kicker: what it is doing, then how it went. */
    postKicker(post) {
      const p = post || {};
      if (p.step === 'ask') return 'Post to Fusion PPM';
      if (p.step === 'posting') return 'Posting…';
      if (p.tone === 'error') return 'Not posted';
      if (p.fusion && p.fusion.state === 'failed') return 'Recorded, not sent to Fusion PPM yet';
      return p.tone === 'warn' ? 'Partly posted' : 'Posted';
    }

    toneClass(tone) {
      return 'nx-pp-result nx-pp-result--' + (tone || 'ok');
    }

    /** The charges of a post as one line, or none. */
    chargeLines(charges) { return charges ? [charges] : []; }

    /** A post's lines so far. */
    linesOf(post) { return post && Array.isArray(post.lines) ? post.lines : []; }

    hasResult(r) { return !!(r && r.summary); }

    /** The slices' percentages added up, in words ("Total 100%"). */
    splitTotalText(slices) { return 'Total ' + (this.splitPctTotal(slices) / 100) + '%'; }
  }

  return PageModule;
});
