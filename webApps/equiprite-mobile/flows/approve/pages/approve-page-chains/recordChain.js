define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/requestProgress',
  'resources/js/mobileApprove',
  'resources/js/rules',
  'resources/js/fmt',
], (ActionChain, Actions, aa, queue, Progress, ma, rules, fmt) => {
  'use strict';

  // Reads the open request, as Next's Approve & allocate recordChain does: its lines (views/request-detail-lines, every
  // line, with availability over each line's dates: approveAllocate.loadLines) and its header (equipment-requests/{id}:
  // the requester, the customer, when it was raised), in parallel. Then, when units can be assigned, the suggested
  // units of each line that still needs some (suggestChain). Reads only. Also called after a write, so the request
  // shows what is stored now.
  //   keep: leave the last result (what a write did) on the request
  class recordChain extends ActionChain {
    async run(context, { keep }) {
      const { $page, $application } = context;
      const pv = $page.variables;
      const app = $application.variables;
      const cur = pv.current ? JSON.parse(JSON.stringify(pv.current)) : null;
      if (!cur || !cur.key || cur.id == null) return;
      pv.recSeq = (pv.recSeq || 0) + 1;
      const seq = pv.recSeq;
      if (!keep) pv.result = null;
      pv.rec = Object.assign({}, pv.rec, { loading: true, error: '' });
      const [lines, headRes] = await Promise.all([
        aa.loadLines(context, Actions, cur.id),
        Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestById', uriParams: { id: cur.id } }).catch(() => null),
      ]);
      if (pv.recSeq !== seq) return; // another request was opened meanwhile
      if (!lines.ok) {
        pv.lines = [];
        pv.rec = { loading: false, error: cur.number + ' could not be read (HTTP ' + (lines.status || '?') + '). Refresh to try again.', offline: false, head: {}, rows: [],
          verdict: { tone: '', text: '', next: '' } };
        return;
      }
      const now = Date.now();
      const first = lines.rows[0] || {};
      const header = (headRes && headRes.ok && headRes.body) || {};
      const status = String(first.requestStatus || header.status || cur.status || '').toUpperCase();
      const external = rules.isExternalSource(header.requestType || first.source) || !!header.eqrCustomerRefId || !!cur.external;
      const quotingAllowed = rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, external ? 'EXTERNAL' : 'INTERNAL');
      const raw = lines.lines;
      const progress = Progress.summarize(status, raw.map((l) => ({ lineStatus: l.line_status, start: l.line_start_date, end: l.line_end_date })),
        { start: cur.start, end: cur.end, external, now });
      const head = {
        id: cur.id,
        number: cur.number,
        status,
        external,
        project: first.projectName || header.projectName || (external ? '' : cur.party),
        task: first.taskName || header.taskName || cur.task || '',
        customer: header.customerName || (external ? cur.party : '') || '',
        requestor: first.requestorName || header.requestorName || cur.requestor || '',
        requestorUserId: header.requestorUserId != null ? header.requestorUserId : null,
        location: first.deploymentLocation || header.attribute1 || '',
        start: cur.start,
        end: cur.end,
        dates: fmt.range(cur.start, cur.end),
        est: raw.reduce((s, l) => s + (Number(l.est_cost) || 0), 0),
        quotingAllowed,
        quoteOwed: queue.isQuoteOwed(status, quotingAllowed),
        headline: progress.headline,
        tone: progress.tone || 'approval',
        when: cur.when,
        late: cur.lateWhy,
        deciding: status === 'SUBMITTED',
        age: header.createdDate ? ma.age(header.createdDate, now) : (cur.age || ''),
        pieces: raw.filter((l) => ['REJECTED', 'CANCELLED'].indexOf(String(l.line_status || '').toUpperCase()) === -1)
          .reduce((n, l) => n + (Number(l.qty) || 1), 0),
      };
      head.party = head.external ? (head.customer || head.project) : head.project;
      const rows = queue.lineRows(raw, head, quotingAllowed, !pv.canAct);
      head.allocating = rows.some((r) => r.action === 'allocate');
      head.needsUnits = rows.some((r) => r.action === 'allocate' && r.unitsTone !== 'complete');
      pv.lines = raw;
      pv.ticks = (pv.ticks || []).filter((id) => raw.some((l) => l.lineId === String(id)));
      pv.rec = { loading: false, error: '', offline: false, head, rows: ma.lineCards(rows, raw), verdict: queue.verdict(head, raw, quotingAllowed) };
      // Nothing left to assign: the request leaves the queue (the request list cannot tell free stock apart).
      const n = queue.settledCount(head, raw, quotingAllowed);
      const had = (pv.settled || {})[cur.key];
      if (n !== had && !(n == null && had === undefined)) {
        const settled = Object.assign({}, pv.settled || {});
        if (n == null) delete settled[cur.key];
        else settled[cur.key] = n;
        pv.settled = settled;
        await Actions.callChain(context, { chain: 'applyChain', params: { rebuild: true } });
      }
      if (head.allocating && pv.canAct) {
        await Actions.callChain(context, { chain: 'suggestChain', params: { seq } });
      } else {
        $page.functions.setSuggestions({});
        pv.sugg = { loading: false, byLine: {}, plan: { count: 0, lines: [], none: [], label: '' } };
      }
    }
  }

  return recordChain;
});
