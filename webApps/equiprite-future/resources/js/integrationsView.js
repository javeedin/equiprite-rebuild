define(['resources/js/integrationHealth', 'resources/js/nav'], function (IntegrationHealth, nav) {
  'use strict';

  // Integrations in EquipRite Next: what is down, since when, what failed and what to do. Every grade is New
  // EquipRite's (resources/js/integrationHealth.js, copied unchanged): healthy / degraded / down / running / quiet from
  // the same rules (FDD 9.4: down when the last 3 calls failed or none succeeded in 24 h, or a sync's last run failed;
  // degraded under 99.5 % success, with an open error, or slower than 3 s), the same plain-language explanation of a
  // failure and the same exception queue. This module adds only what the page says around it: since when, the tiles,
  // the exports. Re-running a sync or reprocessing writes to EquipRite from Fusion, so it stays in New EquipRite: the
  // page says what it would do and links there. Pure; the chain loads the rows.

  var ih = new IntegrationHealth();

  // New's loadHealthChain reads, unchanged (endpoints, params, the single lock object).
  var READS = [
    { key: 'events', what: 'Integration events', endpoint: 'eqp-v1/getIntegrationEvents' },
    { key: 'errors', what: 'Error logs', endpoint: 'eqp-v1/getErrorLogs' },
    { key: 'dlq', what: 'The dead letter queue', endpoint: 'eqp-v1/getDeadLetterQueue' },
    { key: 'jobs', what: 'Job runs', endpoint: 'eqp-v1/getJobRunLogs', uriParams: { orderBy: 'startedAt:desc', size: 200 } },
    { key: 'syncExceptions', what: 'Sync exceptions', endpoint: 'eqp-v1/getFusionSyncExceptions', uriParams: { status: 'OPEN' } },
    { key: 'lock', what: 'The sync lock', endpoint: 'eqp-v1/getFusionSyncLock', single: true }
  ];

  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }

  var TONE = { down: 'down', degraded: 'degraded', running: 'running', healthy: 'healthy', idle: 'idle' };

  /** The time a run of failures began: the oldest failure since the last success (newest first in `list`). */
  function streakStart(list) {
    var since = null;
    for (var i = 0; i < list.length; i++) {
      var c = list[i].cls;
      if (c === 'ok') break;
      if (c === 'fail' && list[i].when != null) since = list[i].when;
    }
    return since;
  }

  /**
   * Since when each card has been in its state: { key: ms }. Down: since the first of the failures since the last
   * success. Degraded: since its oldest open error, else its first failure in the last 24 hours.
   */
  function sinceByKey(raw, model, now) {
    var r = raw || {};
    var events = (r.events || []).map(function (x) { return ih.norm(x, 'event'); }).filter(function (e) { return e.key; });
    var jobs = (r.jobs || []).map(function (x) { return ih.norm(x, 'job'); }).filter(function (j) { return j.key; });
    var errors = (r.errors || []).map(function (x) { return ih.norm(x, 'error'); })
      .filter(function (e) { return !e.resolved && e.severity !== 'INFO' && e.severity !== 'WARNING'; });
    var out = {};
    (model.cards || []).forEach(function (c) {
      var mine = (c.kind === 'job' ? jobs : events).filter(function (e) { return e.key === c.key; })
        .sort(function (a, b) { return (b.when || 0) - (a.when || 0); });
      var since = null;
      if (c.health.key === 'down') {
        since = streakStart(mine);
      } else if (c.health.key === 'degraded') {
        var open = errors.filter(function (e) { return e.key === c.key && e.when != null; }).map(function (e) { return e.when; });
        if (open.length) since = Math.min.apply(null, open);
        else {
          var day = mine.filter(function (e) { return e.cls === 'fail' && e.when != null && now - e.when <= 86400000; }).map(function (e) { return e.when; });
          since = day.length ? Math.min.apply(null, day) : null;
        }
      }
      if (since != null) out[c.key] = since;
    });
    return out;
  }

  function sinceText(state, since, now) {
    if (since == null) return '';
    return (state === 'down' ? 'Down since ' : 'Since ') + ih.stamp(since) + ' (' + ih.ago(since, now).replace(' ago', '') + ')';
  }

  /** What a Run or Apply would do, and that it is done in New EquipRite. */
  function actionText(action) {
    if (!action) return '';
    return ih.confirmText(action).replace(/^(Run|Apply)[^?]*\? /, '');
  }

  /**
   * Everything the page shows.
   *   raw   { events, errors, dlq, jobs, syncExceptions, lock } as loaded
   *   f     { integ: '' } the queue's integration chip
   */
  function view(raw, now, f) {
    var t = now || Date.now();
    var m = ih.model(raw || {}, t);
    var since = sinceByKey(raw, m, t);
    var o = f || {};

    var cards = m.cards.map(function (c) {
      var why = c.lastFailure ? ih.explain(c.lastFailure) : null;
      // A sync whose last run failed reads as its exception-queue entry does (New's wording for a failed job).
      var queued = c.kind === 'job' ? m.queue.filter(function (q) { return q.source === 'job' && q.integ === c.key; })[0] : null;
      if (queued) why = { what: queued.what, fix: queued.fix };
      var s = since[c.key];
      var bad = c.health.key === 'down' || c.health.key === 'degraded';
      var fix = why ? why.fix : (c.kind === 'job' && c.health.key === 'down'
        ? 'Run it again; if it fails the same way, check the stored Fusion sign-in and the Fusion report it reads.' : '');
      return {
        key: c.key, name: c.name, kind: c.kind, kindLabel: c.kind === 'job' ? 'Fusion sync (job)' : 'Calls to Fusion',
        state: TONE[c.health.key] || 'idle', label: c.health.label, reason: c.health.reason, detail: c.detail,
        since: s != null ? s : null, sinceText: bad ? sinceText(c.health.key, s, t) : '',
        failedWhat: bad && why ? why.what : (bad && c.lastFailure && c.lastFailure.message ? c.lastFailure.message : ''),
        failedWhen: bad && c.lastFailure && c.lastFailure.when != null ? 'Last failure ' + ih.stamp(c.lastFailure.when) : '',
        fix: bad ? fix : '', effect: c.effect || '',
        action: c.action ? { type: c.action.type, label: c.action.label, text: actionText(c.action) } : null,
        // A card with nothing wrong stays short: no effect text, the link small.
        compact: !bad
      };
    });

    // What is down, each with since when, what failed and what to do.
    var banner = null;
    var downs = cards.filter(function (c) { return c.state === 'down'; });
    if (downs.length) {
      banner = {
        count: downs.length,
        title: downs.length === 1 ? downs[0].name + ' is down.' : downs.length + ' integrations are down: ' + downs.map(function (c) { return c.name; }).join(', ') + '.',
        items: downs.map(function (c) {
          return { key: c.key, name: c.name, what: c.failedWhat, fix: c.fix, action: c.action,
            sub: [c.sinceText, c.reason].filter(function (x) { return !!x; }).join(' · ') };
        })
      };
    }

    var counts = m.counts;
    var parts = [];
    if (counts.down) parts.push(counts.down + ' down');
    if (counts.attention) parts.push(counts.attention + ' need' + (counts.attention === 1 ? 's' : '') + ' attention');
    if (counts.running) parts.push(counts.running + ' running');
    if (counts.healthy) parts.push(counts.healthy + ' healthy');
    if (counts.idle) parts.push(counts.idle + ' quiet');
    var oldCount = m.queue.filter(function (q) { return q.old; }).length;
    var answer = !cards.length ? 'Nothing is logged yet: no calls to Fusion, no sync runs, no errors.'
      : (counts.down ? cap(parts.join(', ')) + '; what is down and what to do is listed first. '
        : (counts.attention ? 'Nothing is down; ' + counts.attention + ' need' + (counts.attention === 1 ? 's' : '') + ' attention. ' : 'Everything that ran is healthy. '))
        + (m.queue.length ? m.queue.length + (m.queue.length === 1 ? ' item waits' : ' items wait') + ' in the exception queue'
          + (oldCount ? ', ' + oldCount + ' of them older than 48 hours (the target is 48)' : '') + '.' : 'Nothing waits in the exception queue.');

    var chips = ih.queueChips(m.queue);
    var queue = ih.filterQueue(m.queue, o.integ).map(function (q) {
      return Object.assign({}, q, { actionText: q.action ? actionText(q.action) : '', actionLabel: q.action ? q.action.label + ' in New EquipRite' : '' });
    });

    return {
      answer: answer,
      summary: parts.join(' · '),
      banner: banner,
      lockText: m.lockText,
      kpis: [
        { key: 'rate', label: 'Calls that succeeded (24 h)', value: m.kpis.rate, note: m.kpis.rateHint, tone: m.kpis.rateLow ? 'down' : 'healthy' },
        { key: 'waiting', label: 'Waiting in the exception queue', value: String(m.kpis.waiting), note: m.kpis.waitingHint, tone: m.kpis.waiting ? 'degraded' : 'healthy' },
        { key: 'dlq', label: 'Dead letter queue', value: String(m.kpis.dlq), note: 'Retries gave up · ' + m.kpis.dlqHint.charAt(0).toLowerCase() + m.kpis.dlqHint.slice(1), tone: m.kpis.dlq ? 'down' : 'healthy' },
        { key: 'sync', label: 'Last Fusion sync', value: m.kpis.lastSync, note: m.kpis.lastSyncHint, tone: 'idle' }
      ],
      cards: cards,
      silent: m.silent,
      silentText: m.silent.length ? 'Nothing logged for ' + m.silent.length + ' of the FDD\'s integrations: ' + m.silent.join(', ') + '.' : '',
      chips: chips,
      queue: queue,
      queueAll: m.queue.length,
      jobs: m.jobs
    };
  }

  /** The exports: the integrations, the exception queue, the job runs. */
  function exportOf(list) {
    if (list === 'cards') {
      return { name: 'integrations', title: 'Integrations', columns: [
        { key: 'name', label: 'Integration' }, { key: 'kindLabel', label: 'Kind' }, { key: 'label', label: 'Health' }, { key: 'reason', label: 'Why' },
        { key: 'sinceText', label: 'Since' }, { key: 'detail', label: 'Last activity' }, { key: 'failedWhat', label: 'What failed' }, { key: 'fix', label: 'What to do' }] };
    }
    if (list === 'jobs') {
      return { name: 'integration-job-runs', title: 'Fusion sync runs', columns: [
        { key: 'name', label: 'Sync' }, { key: 'code', label: 'Job' }, { key: 'statusText', label: 'Result' }, { key: 'started', label: 'Started' },
        { key: 'took', label: 'Took' }, { key: 'notes', label: 'Notes' }] };
    }
    return { name: 'integration-exceptions', title: 'Exception queue', columns: [
      { key: 'kind', label: 'Kind' }, { key: 'integName', label: 'Integration' }, { key: 'what', label: 'What happened' }, { key: 'fix', label: 'What to do' },
      { key: 'record', label: 'Record' }, { key: 'when', label: 'When' }, { key: 'age', label: 'Waiting' }, { key: 'tries', label: 'Tries' }] };
  }

  /** New EquipRite's Integration health, where a sync is run again. */
  function newLink(newBase) { return nav.newUrl(newBase, 'integrations'); }

  return { READS: READS, view: view, sinceByKey: sinceByKey, exportOf: exportOf, newLink: newLink, health: ih };
});
