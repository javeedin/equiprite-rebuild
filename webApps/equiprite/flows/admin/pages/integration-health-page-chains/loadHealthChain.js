define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Reads everything Integration health shows, in parallel, from services/eqp-v1 only. A read that fails leaves
  // its part empty and is named on the page (loadNote); the rest still shows. The page module's model() turns the
  // rows into cards, the exception queue and the figures.
  const READS = [
    { key: 'events', what: 'Integration events', endpoint: 'eqp-v1/getIntegrationEvents' },
    { key: 'errors', what: 'Error logs', endpoint: 'eqp-v1/getErrorLogs' },
    { key: 'dlq', what: 'The dead letter queue', endpoint: 'eqp-v1/getDeadLetterQueue' },
    { key: 'jobs', what: 'Job runs', endpoint: 'eqp-v1/getJobRunLogs', uriParams: { orderBy: 'startedAt:desc', size: 200 } },
    { key: 'syncExceptions', what: 'Sync exceptions', endpoint: 'eqp-v1/getFusionSyncExceptions', uriParams: { status: 'OPEN' } },
    { key: 'lock', what: 'The sync lock', endpoint: 'eqp-v1/getFusionSyncLock', single: true },
  ];

  class loadHealthChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.isLoading = true;
      try {
        const failed = [];
        const results = await Promise.all(READS.map((r) => {
          const options = { endpoint: r.endpoint };
          if (r.uriParams) options.uriParams = Object.assign({}, r.uriParams);
          return Actions.callRest(context, options).catch(() => null);
        }));
        const raw = {};
        READS.forEach((r, i) => {
          const res = results[i];
          if (!res || !res.ok) {
            failed.push({ what: r.what, status: res ? res.status : 0 });
            raw[r.key] = r.single ? null : [];
            return;
          }
          raw[r.key] = r.single ? (res.body || null) : fns.rowsOf(res.body);
        });
        const now = Date.now();
        v.raw = raw;
        v.model = fns.model(raw, now);
        v.checkedAt = fns.stamp(now);
        v.loadNote = fns.loadNote(failed);
      } catch (e) {
        console.error('[loadHealthChain] unexpected error', e);
        v.loadNote = 'Integration health could not be read. Check again in a minute.';
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadHealthChain;
});
