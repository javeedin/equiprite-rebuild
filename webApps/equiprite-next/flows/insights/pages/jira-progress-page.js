define(['resources/js/jiraProgress'], (JP) => {
  'use strict';

  // Jira · Daily progress: binding helpers (resources/js/jiraProgress.js works the numbers out; the chains read Jira).
  // No function uses `this` (a binding may call one detached). The chart is plain HTML: a column a day (its two bars —
  // closed, new — grow from one baseline), the stories-touched strip under it, and "so far" (two lines on one axis).
  const SECT = [['closed', 'Closed'], ['created', 'New'], ['reopened', 'Reopened'], ['moved', 'Moved'], ['updated', 'Updated']];
  const pct = (n, max) => (max > 0 ? Math.round((n / max) * 1000) / 10 : 0);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  /** The days shown: all, or the working days only. */
  const shownDays = (prog, workOnly) => ((prog && prog.days) || []).filter((d) => !workOnly || !d.weekend);
  /** A round top for the axis: 1, 2, 5, 10, 20… at or above the highest value. */
  const niceTop = (max) => { if (max <= 4) return Math.max(1, max); const p = Math.pow(10, Math.floor(Math.log10(max))); const s = [1, 2, 2.5, 5, 10].map((k) => k * p).filter((v) => v >= max)[0]; return Math.ceil(s); };
  const dayOf = (prog, sel) => { const l = (prog && prog.days) || []; return l.filter((d) => d.key === sel)[0] || l[l.length - 1] || null; };

  class PageModule {
    ranges() { return JP.RANGES.map((n) => ({ n: n, label: n + ' days' })); }
    rangeClass(days, n, custom) { return 'nx-jp-range' + (!custom && Number(days) === n ? ' nx-jp-range--on' : ''); }
    /** Today, for the date boxes' upper limit (YYYY-MM-DD, this PC's day). */
    today() { return JP.dayKey(Date.now()); }
    datesClass(custom) { return 'nx-jp-dates' + (custom ? ' nx-jp-dates--on' : ''); }

    subtitle(prog, readAt, isLoading, more) {
      if (isLoading && !prog) return 'Reading Jira…';
      if (!prog) return '';
      const when = !prog.custom && prog.endsToday ? 'in the last ' + prog.n + ' days (' + prog.days[0].label + ' – ' + prog.days[prog.days.length - 1].label + ')' : 'from ' + JP.windowText(prog);
      return JP.PROJECT + ' · the stories changed ' + when + ' · ' + plural(prog.read, 'story', 'stories') + ' read'
        + (more ? ' (the first 1,000)' : '') + (readAt ? ' · at ' + readAt : '');
    }

    /** The headline numbers: closed, new, net, reopened, touched, stuck. */
    tiles(prog, stuck, stuckRead, stuckMore) {
      if (!prog) return [];
      const t = prog.totals;
      const net = t.net > 0 ? '+' + t.net : String(t.net).replace('-', '−');
      return [
        { id: 'closed', label: 'Closed', value: String(t.closed), note: t.perDay + ' a working day' + (t.best ? ' · best ' + t.best.label + ' (' + t.best.closed + ')' : '') },
        { id: 'created', label: 'New', value: String(t.created), note: 'stories created' },
        { id: 'net', label: 'Net', value: net, note: t.net > 0 ? 'more closed than new' : t.net < 0 ? 'more new than closed' : 'as many closed as new' },
        { id: 'reopened', label: 'Reopened', value: String(t.reopened), note: 'moved back out of done' },
        { id: 'touched', label: 'Stories touched', value: String(t.touched), note: plural(t.moved, 'status change') + ' · ' + plural(t.comments, 'comment') },
        { id: 'stuck', label: 'Stuck', value: stuckRead ? String((stuck || []).length) + (stuckMore ? '+' : '') : '—', note: 'open, no change for ' + JP.STUCK_DAYS + '+ days' + (stuckMore ? ' (the first 300)' : '') },
      ];
    }

    /** A column a day: its bars (percent of the axis top), its labels, its tooltip; the chosen day and today marked. */
    cols(prog, workOnly, sel) {
      const l = shownDays(prog, workOnly);
      if (!l.length) return [];
      const top = niceTop(prog.max);
      const topSoFar = niceTop(prog.maxSoFar);
      const chosen = (dayOf(prog, sel) || {}).key;
      const few = l.length <= 21;
      const step = Math.ceil(l.length / 15);
      return l.map((d, i) => {
        const parts = d.label.split(' '); // Tue, 10, Nov
        const date = parts[1] + (i === 0 || parts[1] === '1' ? ' ' + parts[2] : '');
        return {
        key: d.key, closed: d.closed, created: d.created, touched: d.touched,
        x: few ? parts[0] : (i % step === 0 || d.today ? date : ''),
        x2: few ? date : '',
        cls: 'nx-jp-col' + (d.weekend ? ' nx-jp-col--wknd' : '') + (d.today ? ' nx-jp-col--today' : '') + (d.key === chosen ? ' nx-jp-col--sel' : '') + (i >= l.length - 3 ? ' nx-jp-col--end' : '') + (i < 2 ? ' nx-jp-col--start' : ''),
        hClosed: pct(d.closed, top) + '%', hNew: pct(d.created, top) + '%',
        vClosed: few && d.closed > 0 ? String(d.closed) : '', vNew: few && d.created > 0 ? String(d.created) : '',
        yClosed: pct(d.closedSoFar, topSoFar) + '%', yNew: pct(d.createdSoFar, topSoFar) + '%',
        cell: 'nx-jp-cell nx-jp-cell--' + (d.touched === 0 ? 0 : Math.min(4, 1 + Math.floor((d.touched / Math.max(1, prog.maxTouched)) * 3.999))),
        tip: d.long + (d.today ? ' (today)' : ''), tip2: plural(d.closed, 'closed', 'closed') + ' · ' + plural(d.created, 'new', 'new') + ' · ' + plural(d.moved, 'moved', 'moved') + ' · ' + plural(d.touched, 'story', 'stories') + ' touched · ' + plural(d.comments, 'comment'),
        tip3: 'So far: ' + d.closedSoFar + ' closed, ' + d.createdSoFar + ' new',
        aria: d.long + ': ' + d.closed + ' closed, ' + d.created + ' new, ' + d.touched + ' touched. Show the day.',
        };
      });
    }
    /** The axis lines of the daily chart: 0, half, top. */
    grid(prog) { if (!prog) return []; const top = niceTop(prog.max); const half = top / 2; return [{ y: '100%', v: String(top) }].concat(Number.isInteger(half) && half > 0 ? [{ y: '50%', v: String(half) }] : []).concat([{ y: '0%', v: '0' }]); }
    gridSoFar(prog) { if (!prog) return []; const top = niceTop(prog.maxSoFar); const half = top / 2; return [{ y: '100%', v: String(top) }].concat(Number.isInteger(half) && half > 0 ? [{ y: '50%', v: String(half) }] : []).concat([{ y: '0%', v: '0' }]); }
    showValues(prog, workOnly) { return shownDays(prog, workOnly).length <= 21; }
    /** "So far": the two lines (closed, new) drawn under the day columns' dots — the same x for each day. */
    linesSrc(prog, workOnly) {
      const l = shownDays(prog, workOnly);
      if (!l.length) return '';
      const top = niceTop(prog.maxSoFar);
      const pts = (k) => l.map((d, i) => (((i + 0.5) / l.length) * 100).toFixed(2) + ',' + (100 - pct(d[k], top)).toFixed(2)).join(' ');
      const line = (k, c) => '<polyline points="' + pts(k) + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + line('createdSoFar', '#eb6834') + line('closedSoFar', '#2a78d6') + '</svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }
    soFarEnd(prog) { if (!prog) return ''; const d = prog.days[prog.days.length - 1]; return d.closedSoFar + ' closed · ' + d.createdSoFar + ' new, ' + prog.days[0].label + ' to ' + d.label; }
    stuckTitle(stuck, more) { return 'Stuck · ' + (stuck || []).length + (more ? '+' : ''); }
    soFarText(prog) {
      if (!prog) return '';
      const t = prog.totals;
      if (!t.closed && !t.created) return 'Nothing closed or new in these days.';
      return t.net > 0 ? 'Closing faster than new work arrives: ' + t.net + ' more closed than new.' : t.net < 0 ? 'New work is arriving faster than it is closed: ' + (-t.net) + ' more new than closed.' : 'As many closed as new.';
    }

    /** The day shown in detail (the one chosen, else the latest). */
    day(prog, sel) { return dayOf(prog, sel); }
    dayTitle(prog, sel) { const d = dayOf(prog, sel); return d ? d.long + (d.today ? ' · today' : '') : ''; }
    dayHead(d) { return !d ? '' : plural(d.closed, 'closed', 'closed') + ' · ' + plural(d.created, 'new', 'new') + ' · ' + plural(d.reopened, 'reopened', 'reopened') + ' · ' + plural(d.moved, 'move') + ' · ' + plural(d.touched, 'story', 'stories') + ' touched · ' + plural(d.comments, 'comment'); }
    sections(d) {
      if (!d) return [];
      return SECT.map((s) => ({ id: s[0], title: s[1], n: d.stories[s[0]].length, cls: 'nx-jp-sec nx-jp-sec--' + s[0],
        rows: d.stories[s[0]].map((r) => ({ key: r.key, summary: r.summary, text: r.text, meta: [r.by, r.time, r.type, r.status ? 'now ' + r.status : ''].filter(Boolean).join(' · ') })) })).filter((s) => s.n > 0);
    }
    canPrev(prog, sel, workOnly) { const l = shownDays(prog, workOnly); const d = dayOf(prog, sel); return !!d && l.length > 0 && l[0].key !== d.key; }
    canNext(prog, sel, workOnly) { const l = shownDays(prog, workOnly); const d = dayOf(prog, sel); return !!d && l.length > 0 && l[l.length - 1].key !== d.key; }

    /** Who moved things in these days: closed first. */
    people(prog) { return ((prog && prog.people) || []).slice(0, 12); }
    stuckRows(stuck) { return (stuck || []).slice(0, 25).map((s) => ({ key: s.key, summary: s.summary, meta: s.status + ' · ' + s.assignee + ' · ' + s.type, quiet: s.quiet + ' days' })); }
    /** The numbers, a row a day (newest first): the table view of the chart. */
    numbers(prog, workOnly) { return shownDays(prog, workOnly).slice().reverse(); }
  }

  return PageModule;
});
