define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/requestProgress'], (exportKit, fmt, Progress) => {
  'use strict';

  // A request's tab: binding helpers.
  class PageModule {
    formats() { return exportKit.FORMATS; }
    /** "Project · Task" under the title. */
    subline(head) { return [head && (head.project || head.customer), head && head.task].filter((x) => !!x).join(' · '); }
    range(a, b) { return fmt.range(a, b); }
    date(v) { return fmt.date(v); }
    money(v) { return fmt.money(v); }

    /** A stop's note: "2 of 3 here", "All past", "Some past". */
    stopNote(stop, total) {
      if (!stop) return '';
      if (stop.state === 'here') return total > 1 ? stop.count + ' of ' + total + ' here' : 'Here';
      if (stop.state === 'done') return 'All past';
      if (stop.state === 'passed') return 'Some past';
      return '';
    }

    /** A line's stage and words, a customer request read as such. */
    lineStage(status, external) { return Progress.line(status, !!external).stage || 'ready'; }
    lineLabel(status, external) { return Progress.line(status, !!external).label; }

    /** An array, or an empty one (no array literals in bindings). */
    arr(a) { return Array.isArray(a) ? a : []; }

    /** A history step's state in words, beside its label. */
    stepState(m) {
      return { done: '', partly: 'in progress', here: 'now', todo: '', stopped: '', skipped: 'not reached' }[m && m.state] || '';
    }

    /** When a history step was reached and by whom; says so when it was reached but not recorded. */
    stepWhen(m) {
      if (!m || m.state === 'todo' || m.state === 'skipped') return '';
      if (m.when) return m.when + (m.who ? ' · ' + m.who : '');
      return m.missing ? 'Reached; the date was not recorded' : (m.state === 'here' ? 'Waiting' : '');
    }

    /** An event's when, who and where it comes from. */
    eventMeta(e) {
      if (!e) return '';
      return [e.when || 'Date not recorded', e.who || '', e.recorded ? 'recorded' : 'from its dates'].filter((t) => !!t).join(' · ');
    }

    /** What Confirm or Accept will do, asked before it is done. */
    askText(ask, acts) {
      const a = acts || {};
      const n = (k) => { const v = Number(a[k]) || 0; return v + (v === 1 ? ' piece' : ' pieces'); };
      if (ask === 'confirm') {
        return 'Confirm ' + n('confirm') + ' for picking? Fusion is asked for the transfer order (one per yard it ships from, through OIC) and the pieces '
          + 'are scheduled for picking; a fixed asset is confirmed without one. The yard then sees them in Picking & shipping.';
      }
      if (ask === 'accept') {
        return 'Accept ' + n('accept') + ' on site? Each piece on its way is accepted: a rental is then on site (Deployed), a consumable delivered, or '
          + 'consumed when its class issues it from stock. When everything is on site, the request is marked Deployed.';
      }
      return '';
    }

    /** The button that does it. */
    askGo(ask, acts, busy) {
      if (busy) return busy === 'confirm' ? 'Asking Fusion for the transfer order…' : 'Accepting…';
      const a = acts || {};
      return ask === 'confirm' ? 'Confirm ' + (a.confirm || 0) + ' for picking' : 'Accept ' + (a.accept || 0) + ' on site';
    }


    // ── The Redwood look (your menu): Oracle's general overview header over this tab's own body ───────────────────
    /** The header's subtitle: the kicker and the line under the Current title ("Project request · Pier B · 1.3 Foundations"). */
    rwSub(head, loading) {
      if (!head || !head.requestNumber) return loading ? 'Loading the request…' : '';
      return [head.external ? 'Customer request' : 'Project request', this.subline(head)].filter((x) => !!x).join(' · ');
    }

    /** The header's badge: where the equipment is, in Oracle's badge colours. */
    rwBadge(p) {
      const status = { draft: 'neutral', approval: 'info', ready: 'warning', out: 'info', onsite: 'success', back: 'info', done: 'neutral', stopped: 'danger' };
      return p && p.headline ? { text: p.headline, status: status[p.tone] || 'neutral' } : { text: '', status: 'neutral' };
    }

    /**
     * The steps this request offers, in the current look's order, as header actions: { id, label, icon, display }
     * ('disabled' where the current look's button is disabled).
     */
    rwSteps(head, acts, busy) {
      const h = head || {};
      const a = acts || {};
      const out = [];
      if (h.status === 'DRAFT' && !h.external) out.push({ id: 'finish', label: 'Finish this draft', icon: 'oj-ux-ico-edit-box' });
      if (a.approve) out.push({ id: 'approve', label: 'Approve…', icon: 'oj-ux-ico-check-circle' });
      if (a.assign) out.push({ id: 'assign', label: 'Assign units', icon: 'oj-ux-ico-assign-to-me' });
      if (a.confirm > 0) out.push({ id: 'confirm', label: 'Confirm ' + a.confirm + ' for picking', icon: 'oj-ux-ico-check-square', off: !a.mayConfirm || !!busy });
      if (a.pick > 0) out.push({ id: 'pick', label: 'Pick ' + a.pick + ' at the yard', icon: 'oj-ux-ico-fullfilment-box' });
      if (a.accept > 0) out.push({ id: 'accept', label: 'Accept ' + a.accept + ' on site', icon: 'oj-ux-ico-check-circle', off: !a.mayAccept || !!busy });
      return out;
    }

    /** The step the header's primary action takes (the first the request offers), or ''. */
    rwPrimaryId(head, acts, busy) { return (this.rwSteps(head, acts, busy)[0] || {}).id || ''; }

    /** The header's primary action: the request's next step, as the current look's first highlighted button. */
    rwPrimary(head, acts, busy) {
      const s = this.rwSteps(head, acts, busy)[0];
      return s ? { label: s.label, display: s.off ? 'disabled' : 'on' } : { label: '', display: 'off' };
    }

    /** The header's other actions: Refresh, Export, the request's other steps, and Act on it in New. */
    rwActions(head, acts, busy, loading, newBase) {
      const out = [{ id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: loading ? 'disabled' : 'on' },
        { id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: 'on' }];
      this.rwSteps(head, acts, busy).slice(1).forEach((s) => out.push({ id: s.id, label: s.label, icon: s.icon, display: s.off ? 'disabled' : 'on' }));
      if (head && head.status !== 'DRAFT' && this.newUrl(newBase, head)) out.push({ id: 'new', label: 'Act on it in New', icon: 'oj-ux-ico-external-link', display: 'on' });
      return out;
    }

    /** A line's stage as Oracle's oj-badge (the Redwood equipment table), as the Requests table colours its statuses. */
    rwLineBadge(status, external) {
      const badge = {
        draft: 'oj-badge oj-badge-subtle', approval: 'oj-badge oj-badge-info oj-badge-subtle', ready: 'oj-badge oj-badge-warning oj-badge-subtle',
        out: 'oj-badge oj-badge-info', onsite: 'oj-badge oj-badge-success oj-badge-subtle', back: 'oj-badge oj-badge-info oj-badge-subtle',
        done: 'oj-badge oj-badge-subtle', stopped: 'oj-badge oj-badge-danger oj-badge-subtle',
      };
      return badge[this.lineStage(status, external)] || badge.draft;
    }

    /** A line's rate: "$1,400.00 / DAY", or a dash. */
    rate(l) { return l && l.billRate != null && l.billRate !== '' ? this.money(l.billRate) + (l.priceUom ? ' / ' + l.priceUom : '') : '—'; }

    /** This request in New EquipRite (where it can be approved, allocated, delivered, returned today), or ''. */
    newUrl(newBase, head) {
      if (!newBase || !head || !head.id) return '';
      const base = newBase.slice(-1) === '/' ? newBase : newBase + '/';
      return base + 'vp/shell/request/request-detail?requestId=' + encodeURIComponent(head.requestNumber || '') + '&requestNumericId=' + encodeURIComponent(head.id);
    }
  }

  return PageModule;
});
