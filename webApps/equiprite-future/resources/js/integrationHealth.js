define([], () => {
  'use strict';

  // Integration health (FDD 9.4; wireframe Integration health). No old screen: built only on services/eqp-v1
  //   GET  /integration-events          calls to Fusion / OIC (card health)
  //   GET  /error-logs                  EQR_ERROR_LOG (exception queue)
  //   GET  /dead-letter-queue           EQR_DEAD_LETTER_QUEUE (exception queue, count)
  //   GET  /job-run-logs                EQR_JOB_RUN_LOG (sync cards, job monitor)
  //   GET  /fusion-sync/exceptions      items a Sync from Fusion could not apply (exception queue)
  //   GET  /fusion-sync/lock            a Fetch / Sync running now
  //   POST /int-configs/{syncCode}/run  run a sync again (Reprocess for a failed sync)
  //   POST /fusion-sync/refresh-units   apply staged stock to the units (Reprocess for a failed unit refresh)
  //
  // FIELD NAMES. The spec types integration events, error logs, the dead letter queue and job runs as plain objects
  // (GenericListResponse), so their columns are not declared anywhere. Each value is read from the first present of
  // a few likely names (pick + FIELDS below); the job-run names jobName / startedAt / notes / status are the ones the
  // old Import from Fusion chain and the endpoint's own parameters use. Confirm the rest against the backend.
  //
  // Everything here is pure (no fetches, no variables): the chains load the rows and hand them to model().
  // Shared: the Integration health page's module is this class, and the Administrator's Home builds its integration
  // panel from the same model(), so the two always grade an integration the same way.

  const FIELDS = {
    id: ['id', 'integrationEventId', 'errorLogId', 'errorId', 'deadLetterId', 'dlqId', 'jobRunId', 'eventId', 'logId'],
    integ: ['integrationCode', 'integrationId', 'integrationName', 'interfaceCode', 'interfaceName', 'integration', 'integrationKey'],
    job: ['jobName', 'syncCode', 'jobCode'],
    status: ['status', 'eventStatus', 'processStatus', 'runStatus', 'jobStatus', 'state', 'statusCode'],
    when: ['createdAt', 'creationDate', 'createdDate', 'eventDate', 'errorDate', 'loggedAt', 'startedAt', 'startTime', 'timestamp', 'lastUpdateDate'],
    ended: ['endedAt', 'finishedAt', 'completedAt', 'endTime', 'endDate'],
    message: ['errorMessage', 'message', 'errorText', 'errorDetail', 'detail', 'statusMessage', 'statusMsg', 'failureReason', 'notes'],
    code: ['errorCode', 'code'],
    http: ['httpStatus', 'httpStatusCode', 'responseCode', 'responseStatus'],
    severity: ['severity', 'errorSeverity', 'level'],
    record: ['recordRef', 'referenceNumber', 'requestNumber', 'businessKey', 'entityKey', 'sourceRef', 'recordId', 'entityId'],
    entity: ['entityType', 'recordType', 'objectType'],
    retries: ['retryCount', 'attempts', 'attemptCount', 'tries'],
    duration: ['durationMs', 'elapsedMs', 'responseTimeMs', 'responseTime'],
    resolved: ['resolvedAt', 'resolvedDate', 'resolved', 'isResolved', 'resolvedFlag'],
  };

  // FDD 8 (INT-01 to INT-20).
  const INTEGRATIONS = {
    'INT-01': 'Equipment master sync', 'INT-02': 'Project / task list', 'INT-03': 'Serial / lot availability',
    'INT-04': 'Transfer order', 'INT-05': 'Inventory reservation', 'INT-06': 'Pick release', 'INT-07': 'Inventory receipt',
    'INT-08': 'Expense posting', 'INT-09': 'Inventory transaction', 'INT-10': 'Intercompany billing', 'INT-11': 'AR invoice',
    'INT-12': 'Customer list', 'INT-13': 'Maintenance work order', 'INT-14': 'Analytics extract', 'INT-15': 'Maintenance work orders in',
    'INT-16': 'Project misc. issue', 'INT-17': 'Direct cost posting', 'INT-18': 'Inter-org transfer', 'INT-19': 'Fusion notifications',
    'INT-20': 'User inventory org security',
  };

  // The Fusion syncs EquipRite runs (EQR_INT_CONFIG sync codes, as the old Equipment page's Import / Sync from
  // Fusion chains name them; for these the job-run JOB_NAME is the sync code). `run`: Reprocess = POST
  // /int-configs/{code}/run. EQUIP_FUSION_REFRESH is the run log of refresh-units: Reprocess = POST
  // /fusion-sync/refresh-units with snapshot 'N' (moves staged stock in; never clears missing units).
  const SYNCS = {
    EQUIP_ITEM_REFRESH_SYNC: { label: 'Equipment items: refresh', run: true,
      effect: 'Updates the Fusion fields of items already in EquipRite (what changed since the last run). Class and subclass are never touched.' },
    EQUIP_ITEM_DEF_SYNC: { label: 'Equipment items: import', run: true,
      effect: 'Reads new Fusion items into staging for Import from Fusion. Nothing changes in the equipment list until they are imported on the Equipment page.' },
    EQUIP_UNIT_SERIAL_SYNC: { label: 'Serialised units', run: true,
      effect: 'Reads yard serials from Fusion into staging. Apply staged stock then moves them onto the units.' },
    EQUIP_UNIT_LOT_SYNC: { label: 'Lots', run: true,
      effect: 'Reads yard lots from Fusion into staging. Apply staged stock then moves them onto the units.' },
    EQUIP_UNIT_ONHAND_SYNC: { label: 'On-hand stock', run: true,
      effect: 'Reads yard on-hand quantities from Fusion into staging. Apply staged stock then moves them onto the units.' },
    EQUIP_ASSET_GROUP_SYNC: { label: 'Asset groups', run: true,
      effect: 'Reads Fusion asset groups into staging, for the next import or sync.' },
    EQUIP_FUSION_REFRESH: { label: 'Apply stock to units', refresh: true,
      effect: 'Moves the staged serials, lots and on-hand stock onto the units (Fusion-owned fields only). Units Fusion no longer has are cleared only by a complete Sync from Fusion on the Equipment page.' },
  };
  const SYNC_ORDER = Object.keys(SYNCS);

  const LOCK_LABELS = { FETCH: 'An Import from Fusion fetch', SYNC: 'A Sync from Fusion', STOCK: 'A stock sync' };

  const TARGET_RATE = 0.995;   // FDD 9.4.3: success rate 99.5%+
  const SLOW_MS = 3000;        // FDD 9.4.1: flag API response times above 3 s
  const OLD_HOURS = 48;        // FDD 9.4.3: 95% of exceptions resolved in 48 h
  const DAY_MS = 24 * 3600 * 1000;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const HEALTH_ORDER = { down: 0, degraded: 1, running: 2, healthy: 3, idle: 4 };

  function pick(row, keys) {
    if (!row) return undefined;
    for (let i = 0; i < keys.length; i++) {
      const v = row[keys[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }
  function timeOf(v) {
    if (v === undefined || v === null || v === '') return null;
    const t = typeof v === 'number' ? v : Date.parse(String(v));
    return isNaN(t) ? null : t;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /** A row's rows: { data: [] }, { items: [] } or a bare array. */
  function rowsOf(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.data)) return body.data;
    if (body && Array.isArray(body.items)) return body.items;
    return [];
  }

  class PageModule {
    rowsOf(body) {
      return rowsOf(body);
    }

    /** ok | fail | run | other, from whatever status word a log uses. Failure wins over "COMPLETED_WITH_ERRORS". */
    statusClass(status) {
      const s = String(status === undefined || status === null ? '' : status).trim().toUpperCase();
      if (!s) return 'other';
      if (/RUNNING|IN[_ ]?PROGRESS|STARTED|PROCESSING|QUEUED|PENDING|RETRYING|ACCEPTED/.test(s)) return 'run';
      if (/FAIL|ERROR|^E$|REJECT|DEAD|DLQ|ABORT|TIMEOUT|TIMED/.test(s)) return 'fail';
      if (/SUCCESS|SUCCEEDED|COMPLETE|^OK$|^S$|DONE|PROCESSED|RESOLVED|SENT|DELIVERED|^200$|^201$|^202$/.test(s)) return 'ok';
      return 'other';
    }

    /** INT-07, from "INT-07", "int_7", "INT 07 Inventory receipt"; else the name as given, upper case. */
    integKey(v) {
      const s = String(v === undefined || v === null ? '' : v).trim();
      const m = /INT[-_ ]?(\d{1,2})\b/i.exec(s);
      if (m) return 'INT-' + pad(Number(m[1]));
      return s.toUpperCase();
    }

    integName(key) {
      if (INTEGRATIONS[key]) return key + ' ' + INTEGRATIONS[key];
      if (SYNCS[key]) return SYNCS[key].label;
      return key || 'Unnamed integration';
    }

    /** Normalised log row. */
    norm(row, source) {
      const r = row || {};
      const http = Number(pick(r, FIELDS.http)) || (/^\d{3}$/.test(String(r.statusCode || '')) ? Number(r.statusCode) : null);
      const job = pick(r, FIELDS.job);
      const integ = pick(r, FIELDS.integ);
      const entity = pick(r, FIELDS.entity);
      const record = pick(r, FIELDS.record);
      return {
        source,
        id: pick(r, FIELDS.id),
        key: source === 'job' ? String(job || '').toUpperCase() : this.integKey(integ || job || ''),
        job: job ? String(job) : '',
        status: pick(r, FIELDS.status),
        cls: this.statusClass(pick(r, FIELDS.status)),
        when: timeOf(pick(r, FIELDS.when)),
        ended: timeOf(pick(r, FIELDS.ended)),
        message: String(pick(r, FIELDS.message) || ''),
        code: String(pick(r, FIELDS.code) || ''),
        http,
        severity: String(pick(r, FIELDS.severity) || '').toUpperCase(),
        record: record !== undefined ? (entity ? entity + ' ' : '') + record : '',
        retries: pick(r, FIELDS.retries),
        durationMs: Number(pick(r, FIELDS.duration)) || null,
        resolved: this.isResolved(r),
      };
    }

    isResolved(r) {
      const v = pick(r, FIELDS.resolved);
      if (v === true || v === 'Y' || v === 'y' || v === 'true') return true;
      if (v !== undefined && v !== false && v !== 'N' && v !== 'n' && v !== 'false' && timeOf(v) !== null) return true;
      const s = String(pick(r, FIELDS.status) || '').toUpperCase();
      return /RESOLVED|CLOSED|REPROCESSED|IGNORED|DISCARDED/.test(s);
    }

    // ── Health rules (FDD 9.4.1: healthy / degraded / down) ────────────

    /**
     * stats: { calls24, ok24, fail24, recent: ['ok'|'fail'|'run'|'other', newest first], avgMs, openErrors, running }
     * kind:  'events' (a stream of calls) or 'job' (discrete runs)
     * Rules, first match wins:
     *   running                                   -> running
     *   job: the last finished run failed         -> down
     *   events: the last 3 calls all failed, or
     *           calls in 24 h and none succeeded  -> down
     *   nothing in 24 h and no open error         -> idle
     *   success under 99.5%, an open error, or
     *   average response over 3 s                 -> degraded
     *   otherwise                                 -> healthy
     */
    health(stats, kind) {
      const s = stats || {};
      const recent = (s.recent || []).filter((c) => c === 'ok' || c === 'fail');
      if (s.running) return { key: 'running', label: 'Running', reason: 'Running now' };
      if (kind === 'job') {
        if (recent[0] === 'fail') return { key: 'down', label: 'Down', reason: 'The last run failed' };
        if (!recent.length) return { key: 'idle', label: 'No runs', reason: 'No run recorded' };
      } else {
        if (recent.length >= 3 && recent.slice(0, 3).every((c) => c === 'fail')) {
          return { key: 'down', label: 'Down', reason: 'The last 3 calls failed' };
        }
        if ((s.calls24 || 0) > 0 && !(s.ok24 > 0) && (s.fail24 || 0) > 0) {
          return { key: 'down', label: 'Down', reason: 'No call succeeded in 24 h' };
        }
        if (!(s.calls24 > 0) && !(s.openErrors > 0)) return { key: 'idle', label: 'Quiet', reason: 'No calls in 24 h' };
      }
      const done = (s.ok24 || 0) + (s.fail24 || 0);
      const rate = done ? (s.ok24 || 0) / done : 1;
      if (done && rate < TARGET_RATE) return { key: 'degraded', label: 'Degraded', reason: `${this.pct(rate)} succeeded (target 99.5%)` };
      if (s.openErrors > 0) return { key: 'degraded', label: 'Degraded', reason: `${s.openErrors} open error${s.openErrors === 1 ? '' : 's'}` };
      if (s.avgMs > SLOW_MS) return { key: 'degraded', label: 'Slow', reason: `Average ${(s.avgMs / 1000).toFixed(1)} s (limit 3 s)` };
      return { key: 'healthy', label: 'Healthy', reason: done ? `${this.pct(rate)} succeeded` : 'Last run succeeded' };
    }

    pct(rate) {
      const p = Math.round(rate * 1000) / 10;
      return (p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)) + '%';
    }

    // ── Plain language ─────────────────────────────────────────────────

    /** { what, fix } for one failure, from the FDD 9.1 error codes, the HTTP status and the message. */
    explain(e) {
      const x = e || {};
      const code = String(x.code || '').toUpperCase();
      const http = Number(x.http) || null;
      const msg = String(x.message || '');
      const tail = msg ? ` Fusion said: "${msg.length > 160 ? msg.slice(0, 157) + '…' : msg}"` : '';
      if (code === 'EQR-API-002' || http === 401 || http === 403 || /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid credential/i.test(msg)) {
        return { what: 'Fusion refused EquipRite\'s sign-in.', fix: 'Update the stored Fusion credential for this connection, then reprocess. Until then every call of this integration fails the same way.' };
      }
      if (code === 'EQR-API-006' || http === 408 || http === 504 || /timed? ?out|timeout/i.test(msg)) {
        return { what: 'Fusion did not answer in time.', fix: 'Usually temporary: reprocess in a few minutes. If it keeps timing out, check that Fusion is up.' };
      }
      if (code === 'EQR-API-005' || http === 409 || /\block(ed)?\b/i.test(msg)) {
        return { what: 'Another process had the record locked.', fix: 'It is retried automatically. Reprocess if it is still here in an hour.' };
      }
      if (/closed for charges|not chargeable|task is closed|project is closed/i.test(msg)) {
        return { what: 'The project or task is closed for charges.' + tail, fix: 'Reopen the task for charges in Fusion Projects, or move the cost to an open task, then reprocess.' };
      }
      if (code === 'EQR-API-003' || http === 404 || /not found|does not exist/i.test(msg)) {
        return { what: 'Fusion could not find the record this call refers to.' + tail, fix: 'Check that the project, item or organization still exists in Fusion and is active, then reprocess.' };
      }
      if (code === 'EQR-API-004' || (http >= 500 && http < 600)) {
        return { what: `Fusion had an internal error${http ? ' (HTTP ' + http + ')' : ''}.`, fix: 'Usually temporary: reprocess later. If it repeats, give the Fusion administrator the time shown here.' };
      }
      if (code === 'EQR-OIC-001') return { what: 'The transfer order could not be created in Fusion.' + tail, fix: 'Start picking for the request again; if it fails again, check the transfer order flow in Integration Cloud.' };
      if (code === 'EQR-OIC-002') return { what: 'Intercompany billing failed in Integration Cloud.' + tail, fix: 'Check the IC billing flow in Integration Cloud; its next scheduled run retries it.' };
      if (code === 'EQR-OIC-003') return { what: 'The shipment could not be confirmed in Fusion.' + tail, fix: 'Confirm the shipment in Fusion, then reprocess.' };
      if (code === 'EQR-SCH-001') return { what: 'The intercompany billing job failed.' + tail, fix: 'See its last run in the job monitor below; it retries on its next schedule.' };
      if (code === 'EQR-SCH-002') return { what: 'A sync left records that no longer match Fusion.' + tail, fix: 'Run Sync from Fusion on the Equipment page to bring them back in line.' };
      if (code === 'EQR-BIZ-002' || /budget/i.test(msg)) return { what: 'The project budget does not cover this cost.' + tail, fix: 'Ask the project manager to raise the budget, then post again.' };
      if (code === 'EQR-BIZ-003' || /agreement.*expired/i.test(msg)) return { what: 'The rental agreement has expired.' + tail, fix: 'Extend or renew the agreement, then reprocess.' };
      if (code === 'EQR-BIZ-004' || /no rate/i.test(msg)) return { what: 'No rate schedule covers this equipment.' + tail, fix: 'Add a rate line for its class in Rate schedules, then reprocess.' };
      if (code === 'EQR-BIZ-001') return { what: 'The equipment is not available for those dates.' + tail, fix: 'Pick another unit or change the dates on the request.' };
      if (code === 'EQR-BIZ-005') return { what: 'More than 24 hours were entered for one day.' + tail, fix: 'Correct the timesheet.' };
      if (code === 'EQR-BIZ-006') return { what: 'A timesheet for that week already exists.' + tail, fix: 'Change the existing timesheet instead.' };
      if (code === 'EQR-API-001' || http === 400) {
        return { what: 'Fusion rejected the data it was sent.' + tail, fix: 'Correct the record named in the message, then reprocess.' };
      }
      if (/^EQR-VAL/.test(code)) return { what: 'A required value was missing or invalid.' + tail, fix: 'Correct the record and save it again.' };
      return { what: msg ? msg : 'The call failed without a message.', fix: 'Open the record named here; reprocess once the cause is fixed. If the message means nothing to you, send it to the EquipRite administrator.' };
    }

    // ── Times ──────────────────────────────────────────────────────────

    /** "12 min ago", "3 h ago", "2 d ago". */
    ago(t, now) {
      if (t === null || t === undefined) return '';
      const m = Math.max(0, Math.round((now - t) / 60000));
      if (m < 1) return 'just now';
      if (m < 60) return m + ' min ago';
      const h = Math.round(m / 60);
      if (h < 48) return h + ' h ago';
      return Math.round(h / 24) + ' d ago';
    }

    /** "27 Oct 22:10" (local time). */
    stamp(t) {
      if (t === null || t === undefined) return '';
      const d = new Date(t);
      return `${d.getDate()} ${MON[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    ageHours(t, now) {
      return t === null || t === undefined ? null : (now - t) / 3600000;
    }

    // ── The whole page from the rows ───────────────────────────────────

    /**
     * raw: { events, errors, dlq, jobs, syncExceptions, lock } as loaded (row arrays, lock object)
     * now: ms
     * Returns { cards, silent, queue, kpis, counts, banner, jobs, lockText }.
     */
    model(raw, now) {
      const r = raw || {};
      const t = now || Date.now();
      const self = this;
      const events = (r.events || []).map((x) => self.norm(x, 'event')).filter((e) => e.key);
      const errors = (r.errors || []).map((x) => self.norm(x, 'error'));
      const dlq = (r.dlq || []).map((x) => self.norm(x, 'dlq'));
      const jobs = (r.jobs || []).map((x) => self.norm(x, 'job')).filter((j) => j.key);
      jobs.sort((a, b) => (b.when || 0) - (a.when || 0));
      const lock = this.lockState(r.lock);

      // Open errors per integration (CRITICAL / ERROR / unknown; FDD 9.1.3: WARNING is in-app only, INFO audit only).
      const openErrors = errors.filter((e) => !e.resolved && e.severity !== 'INFO' && e.severity !== 'WARNING');
      const openByKey = {};
      openErrors.forEach((e) => { if (e.key) openByKey[e.key] = (openByKey[e.key] || 0) + 1; });

      // Cards for integrations that log calls.
      const byKey = {};
      events.forEach((e) => { (byKey[e.key] = byKey[e.key] || []).push(e); });
      Object.keys(openByKey).forEach((k) => { byKey[k] = byKey[k] || []; });
      const cards = Object.keys(byKey).filter((k) => !SYNCS[k]).map((k) => {
        const list = byKey[k].slice().sort((a, b) => (b.when || 0) - (a.when || 0));
        const day = list.filter((e) => e.when !== null && t - e.when <= DAY_MS);
        const ok24 = day.filter((e) => e.cls === 'ok').length;
        const fail24 = day.filter((e) => e.cls === 'fail').length;
        const durs = day.map((e) => e.durationMs).filter((d) => d);
        const lastOk = list.find((e) => e.cls === 'ok');
        const h = self.health({ calls24: day.length, ok24, fail24, recent: list.map((e) => e.cls), openErrors: openByKey[k] || 0,
          avgMs: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0 }, 'events');
        return {
          key: k, name: self.integName(k), kind: 'events', health: h,
          detail: (lastOk ? 'Last success ' + self.ago(lastOk.when, t) : 'No success logged')
            + (day.length ? ` · ${ok24} of ${ok24 + fail24} ok today` : ''),
          effect: '', action: null, lastFailure: list.find((e) => e.cls === 'fail') || null,
        };
      });

      // Cards for the Fusion syncs: every known sync, plus any other job the run log names.
      const jobKeys = SYNC_ORDER.slice();
      jobs.forEach((j) => { if (jobKeys.indexOf(j.key) === -1) jobKeys.push(j.key); });
      jobKeys.forEach((k) => {
        const runs = jobs.filter((j) => j.key === k);
        const last = runs[0];
        const sync = SYNCS[k] || null;
        const running = (last && last.cls === 'run') || (lock.running && lock.syncCode === k);
        const h = self.health({ recent: runs.map((j) => j.cls), running }, 'job');
        const lastOk = runs.find((j) => j.cls === 'ok');
        cards.push({
          key: k, name: sync ? sync.label : k, kind: 'job', health: h,
          detail: last ? `Last run ${self.ago(last.when, t)}: ${self.statusWord(last.cls, last.status)}` + (lastOk && lastOk !== last ? ` · last success ${self.ago(lastOk.when, t)}` : '')
            : 'No run recorded in the job log',
          effect: sync ? sync.effect : '',
          action: sync && sync.run ? { type: 'run', syncCode: k, label: 'Run now' } : (sync && sync.refresh ? { type: 'refresh', syncCode: k, label: 'Apply staged stock' } : null),
          lastFailure: last && last.cls === 'fail' ? last : null,
        });
      });
      cards.sort((a, b) => (HEALTH_ORDER[a.health.key] - HEALTH_ORDER[b.health.key]) || (a.kind === b.kind ? 0 : (a.kind === 'events' ? -1 : 1)));

      const seen = {};
      cards.forEach((c) => { seen[c.key] = true; });
      const silent = Object.keys(INTEGRATIONS).filter((k) => !seen[k] && k !== 'INT-01').map((k) => k + ' ' + INTEGRATIONS[k]);

      const queue = this.queue(openErrors, dlq.filter((d) => !d.resolved), jobs, r.syncExceptions || [], t);

      const day = events.filter((e) => e.when !== null && t - e.when <= DAY_MS);
      const ok = day.filter((e) => e.cls === 'ok').length;
      const fail = day.filter((e) => e.cls === 'fail').length;
      const syncRuns = jobs.filter((j) => SYNCS[j.key]);
      const lastSync = syncRuns[0];
      const counts = { healthy: 0, attention: 0, down: 0, running: 0, idle: 0 };
      cards.forEach((c) => {
        if (c.health.key === 'healthy') counts.healthy++;
        else if (c.health.key === 'degraded') counts.attention++;
        else if (c.health.key === 'down') counts.down++;
        else if (c.health.key === 'running') counts.running++;
        else counts.idle++;
      });
      const worst = cards.find((c) => c.health.key === 'down');
      const worstWhy = worst && worst.lastFailure ? this.explain(worst.lastFailure) : null;

      return {
        cards,
        silent,
        queue,
        counts,
        kpis: {
          rate: ok + fail ? this.pct(ok / (ok + fail)) : '–',
          rateHint: ok + fail ? `${ok + fail} calls · target 99.5%` : 'No calls logged in 24 h',
          rateLow: ok + fail > 0 && ok / (ok + fail) < TARGET_RATE,
          waiting: queue.length,
          waitingHint: (() => { const n = queue.filter((q) => q.old).length; return n ? `${n} older than 48 h` : 'None older than 48 h'; })(),
          dlq: dlq.filter((d) => !d.resolved).length,
          dlqHint: 'Target under 5 at month end',
          lastSync: lastSync ? this.ago(lastSync.when, t) : '–',
          lastSyncHint: lastSync ? `${(SYNCS[lastSync.key] || {}).label || lastSync.key}: ${this.statusWord(lastSync.cls, lastSync.status)}` : 'No sync in the job log',
        },
        banner: worst ? {
          key: worst.key, name: worst.name, reason: worst.health.reason,
          what: worstWhy ? worstWhy.what : '', fix: worstWhy ? worstWhy.fix : (worst.kind === 'job' ? 'Run it again; if it fails the same way, check the stored Fusion sign-in and the Fusion report it reads.' : ''),
          action: worst.action,
        } : null,
        jobs: jobs.slice(0, 25).map((j) => ({
          key: String(j.id || '') + ':' + j.key + ':' + (j.when || ''), name: (SYNCS[j.key] || {}).label || j.key, code: j.key,
          cls: j.cls, statusText: this.statusWord(j.cls, j.status), started: this.stamp(j.when),
          took: j.when && j.ended ? this.duration(j.ended - j.when) : '', notes: j.message,
        })),
        lockText: lock.running ? `${lock.label} started ${this.stamp(lock.since)} is running now. Syncs wait until it finishes.` : '',
      };
    }

    statusWord(cls, raw) {
      if (cls === 'ok') return 'Succeeded';
      if (cls === 'fail') return 'Failed';
      if (cls === 'run') return 'Running';
      return raw ? String(raw).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : 'Unknown';
    }

    duration(ms) {
      const s = Math.round(ms / 1000);
      if (s < 60) return s + ' s';
      const m = Math.round(s / 60);
      return m < 60 ? m + ' min' : (Math.round(m / 6) / 10) + ' h';
    }

    /**
     * The old RunInProgressChain's reading of GET /fusion-sync/lock: held and not idle past its stale limit =
     * running. { running, label, syncCode, since }.
     */
    lockState(b) {
      if (!b || !b.held) return { running: false };
      if (Number(b.idleSeconds) > Number(b.staleAfterSeconds)) return { running: false };
      return { running: true, label: LOCK_LABELS[b.runLabel] || 'Another import or sync', syncCode: b.syncCode || '', since: timeOf(b.acquiredAt || b.startTime) };
    }

    /** Exception queue: open errors, the dead letter queue, failed last runs and held sync items; oldest first. */
    queue(openErrors, dlq, jobs, syncExceptions, now) {
      const out = [];
      const self = this;
      (openErrors || []).forEach((e, i) => {
        const why = self.explain(e);
        out.push(self.entry('error', 'e' + (e.id !== undefined ? e.id : i), e, why, now, null,
          e.severity === 'CRITICAL' ? 'Critical' : 'Error'));
      });
      (dlq || []).forEach((d, i) => {
        const why = self.explain(d);
        const what = /[.!?"]$/.test(why.what) ? why.what : why.what + '.';
        out.push(self.entry('dlq', 'd' + (d.id !== undefined ? d.id : i), d,
          { what: what + ' Automatic retries gave up.', fix: why.fix }, now, null, 'Dead letter'));
      });
      // The LATEST run per job only: an older failure already followed by a success is history, not an exception.
      const latest = {};
      (jobs || []).forEach((j) => { if (!latest[j.key]) latest[j.key] = j; });
      Object.keys(latest).forEach((k) => {
        const j = latest[k];
        if (j.cls !== 'fail') return;
        const sync = SYNCS[k];
        const why = j.message ? self.explain(j) : { what: '', fix: '' };
        const action = sync && sync.run ? { type: 'run', syncCode: k, label: 'Run again' }
          : (sync && sync.refresh ? { type: 'refresh', syncCode: k, label: 'Apply again' } : null);
        out.push(self.entry('job', 'j' + k, j, {
          what: `${sync ? sync.label : k} failed.` + (why.what ? ' ' + why.what : ''),
          fix: action ? (action.type === 'refresh'
            ? 'Apply the staged stock again. Units Fusion no longer has are cleared only by a complete Sync from Fusion on the Equipment page.'
            : 'Run it again. If it fails the same way, check the stored Fusion sign-in and the Fusion report it reads.')
            : (why.fix || 'Check the job\'s notes; it runs again on its next schedule.'),
        }, now, action, 'Job'));
      });
      (syncExceptions || []).forEach((x, i) => {
        if (x.resolvedDate) return;
        const changed = [];
        if ((x.eqrSerialControlled || '') !== (x.fusionSerialControlled || '')) changed.push('serial');
        if ((x.eqrLotControlled || '') !== (x.fusionLotControlled || '')) changed.push('lot');
        const item = x.equipmentNumber || ('Fusion item ' + (x.fusionInventoryItemId || ''));
        const e = { key: 'INT-01', when: timeOf(x.detectedDate), record: item, retries: null };
        out.push(self.entry('sync-exception', 's' + (x.fusionSyncExceptionId !== undefined ? x.fusionSyncExceptionId : i), e, {
          what: `Fusion changed the ${changed.length ? changed.join(' and ') : 'serial or lot'} control of ${item} while it has units in EquipRite, so EquipRite kept its own setting.`
            + (x.detail ? ' ' + x.detail : ''),
          fix: 'Decide which is right: change it back in Fusion, or retire and re-add its units in EquipRite. The next Sync from Fusion clears this once the two agree.',
        }, now, null, 'Held item'));
      });
      out.sort((a, b) => (b.ageHours || 0) - (a.ageHours || 0));
      return out;
    }

    entry(source, key, e, why, now, action, kind) {
      const age = this.ageHours(e.when, now);
      return {
        key, source, kind,
        integ: e.key || '', integName: this.integName(e.key || ''),
        when: this.stamp(e.when), age: e.when === null || e.when === undefined ? '' : this.ago(e.when, now).replace(' ago', ''),
        ageHours: age, old: age !== null && age > OLD_HOURS,
        record: e.record || '', tries: e.retries === undefined || e.retries === null ? '' : String(e.retries),
        what: why.what, fix: why.fix, action,
      };
    }

    /** Integration chips for the queue: [{ key, label, count }], All first. */
    queueChips(queue) {
      const q = queue || [];
      const counts = {};
      q.forEach((x) => { counts[x.integ || ''] = (counts[x.integ || ''] || 0) + 1; });
      return [{ key: '', label: 'All', count: q.length }].concat(Object.keys(counts).filter((k) => k).sort()
        .map((k) => ({ key: k, label: SYNCS[k] ? SYNCS[k].label : k, count: counts[k] })));
    }

    filterQueue(queue, integ) {
      return (queue || []).filter((x) => !integ || x.integ === integ);
    }

    syncLabel(code) {
      return (SYNCS[code] || {}).label || code || '';
    }

    syncEffect(code) {
      return (SYNCS[code] || {}).effect || '';
    }

    /** What a Run / Apply click will do, said before it is confirmed. */
    confirmText(action) {
      const a = action || {};
      if (a.type === 'refresh') {
        return 'Apply staged stock now? ' + this.syncEffect(a.syncCode);
      }
      return `Run ${this.syncLabel(a.syncCode)} now? ${this.syncEffect(a.syncCode)} It runs in the background and can take several minutes.`;
    }

    /** Plain result of POST /int-configs/{syncCode}/run. { type, summary, message } */
    runResult(res, code) {
      const label = this.syncLabel(code);
      if (res && res.ok) {
        const id = res.body && res.body.jobRunId;
        return { type: 'confirmation', summary: `${label} started`,
          message: `It runs in the background${id ? ' (job run ' + id + ')' : ''}. Check again in a few minutes to see the result here.` };
      }
      const status = res ? res.status : 0;
      if (status === 409) return { type: 'warning', summary: 'Already running', message: `${label} is already running. Check again when it finishes.` };
      if (status === 401 || status === 403) return { type: 'error', summary: 'Not started', message: `You are not allowed to start ${label} (HTTP ${status}).` };
      if (status === 404) return { type: 'error', summary: 'Not started', message: `The backend has no sync called ${code} (HTTP 404). Check its row in EQR_INT_CONFIG.` };
      return { type: 'error', summary: 'Not started', message: `${label} could not be started${status ? ' (HTTP ' + status + ')' : ''}. Try again in a minute; if it keeps failing, the sync service may be down.` };
    }

    /** Plain result of POST /fusion-sync/refresh-units. */
    refreshResult(res) {
      if (res && res.ok) {
        const b = res.body || {};
        const n = (v) => Number(v) || 0;
        return { type: 'confirmation', summary: 'Staged stock applied',
          message: `${n(b.serials)} serials, ${n(b.lots)} lots and ${n(b.onhand)} on-hand records are on the units.`
            + (n(b.itemsHeld) ? ` ${n(b.itemsHeld)} items were held (see the exception queue).` : '')
            + (n(b.stockWaiting) ? ` ${n(b.stockWaiting)} stock rows wait for their item to be imported.` : '') };
      }
      const status = res ? res.status : 0;
      if (status === 409) return { type: 'warning', summary: 'Busy', message: 'An import or sync took over first. Try again when it finishes.' };
      return { type: 'error', summary: 'Not applied', message: `The staged stock could not be applied${status ? ' (HTTP ' + status + ')' : ''}. Nothing was changed; try again in a minute.` };
    }

    /** Plain text for reads that failed: [{ what, status }]. */
    loadNote(failed) {
      const f = Array.isArray(failed) ? failed : [];
      if (!f.length) return '';
      return f.map((x) => `${x.what} could not be read${x.status ? ' (HTTP ' + x.status + ')' : ''}`).join('; ')
        + '. What is shown may be incomplete; check again in a minute.';
    }
  }

  return PageModule;
});
