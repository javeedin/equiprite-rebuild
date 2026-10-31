define(['resources/js/fmt', 'resources/js/rules'], function (fmt, rules) {
  'use strict';

  // The cart in the top bar: the requests saved as drafts (Save draft on New request), to carry on with. Pure: read
  // from the shared request list (requestData: views/my-requests and their lines), nothing fetched or written here.
  //
  // Yours are the drafts whose requester is you (requestorUsername, as Save draft records it, or the requester's name).
  // A row that names no requester is counted as yours: the view is scoped to the user unless they manage requests. A
  // manager also sees everyone else's drafts, apart.

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function lc(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function pick(r, names) {
    for (var i = 0; i < names.length; i++) {
      var v = r && r[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  /** Whether a row's requester is one of who (usernames and names, any case). */
  function isMine(r, who) {
    var names = ['requestorUsername', 'createdBy', 'requestorName', 'requestor', 'submittedBy']
      .map(function (k) { return r && r[k]; }).filter(function (v) { return v != null && v !== ''; }).map(lc);
    if (!names.length) return true;
    var me = (who || []).map(lc).filter(Boolean);
    return names.some(function (n) { return me.indexOf(n) !== -1; });
  }

  /**
   * The drafts: { mine: [...], others: [...] }, newest first. Each: { id, number, party, task, dates, pieces, lines,
   * names (first equipment names), est, saved ("Saved 3 days ago"), requestor, external }.
   *   rows, linesByRequest  requestData's; who: [username, display name]; now: for "saved … ago"
   */
  function list(rows, linesByRequest, who, now) {
    var out = { mine: [], others: [] };
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !r.requestNumber || up(r.status || r.requestStatus) !== 'DRAFT') return;
      var lines = (linesByRequest || {})[r.requestNumber] || [];
      var pieces = lines.reduce(function (s, l) { return s + (Number(l.qty) || 1); }, 0);
      var savedAt = pick(r, ['lastUpdatedDate', 'lastUpdateDate', 'updatedDate', 'createdDate', 'creationDate']);
      var names = lines.map(function (l) { return l.name; }).filter(Boolean);
      var est = pick(r, ['totalEstCost', 'estimatedCost']);
      var item = {
        id: r.eqrEquipmentRequestId != null ? Number(r.eqrEquipmentRequestId) : null,
        number: String(r.requestNumber),
        party: r.projectName || r.customerName || r.projectInternalCustomer || '',
        task: r.taskName || '',
        dates: fmt.range(r.startDate || r.requestedStartDate, r.endDate || r.requestedEndDate),
        lines: lines.length,
        pieces: pieces,
        names: names.slice(0, 2).join(', ') + (names.length > 2 ? ' and ' + (names.length - 2) + ' more' : ''),
        est: est != null && !isNaN(Number(est)) ? fmt.money(Number(est)) : '',
        saved: savedAt ? 'Saved ' + fmt.relative(String(savedAt).slice(0, 10), now) : '',
        requestor: r.requestorName || r.requestorUsername || '',
        external: rules.isExternalSource(r.requestOrigin || r.source)
      };
      (isMine(r, who) ? out.mine : out.others).push(item);
    });
    var newest = function (a, b) { return Number(b.id || 0) - Number(a.id || 0); };
    out.mine.sort(newest);
    out.others.sort(newest);
    return out;
  }

  /** "2 pieces · Komatsu D65EX-18 Dozer, Tadano ATF 220G-5" (or that it has no equipment yet). */
  function about(d) {
    if (!d) return '';
    if (!d.pieces && !d.lines) return 'No equipment yet';
    return (d.pieces === 1 ? '1 piece' : d.pieces + ' pieces') + (d.names ? ' · ' + d.names : '');
  }

  return { list: list, isMine: isMine, about: about };
});
