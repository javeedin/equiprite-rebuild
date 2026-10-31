define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
  'resources/js/customerPortal',
  'resources/js/portalView',
  'resources/js/shellBus',
], (ActionChain, Actions, rules, portal, V, bus) => {
  'use strict';

  // One customer request: New's customer request page reads (initChain), in the same order:
  //   1 views/customer-request-details (page 0, size 10000): this request's row, by its number (or by its id when the
  //     tab has only the id): customer, contact, status, dates, delivery, contract
  //   2 views/request-detail-lines (requestId, size 10000): one row per line
  // Two differences, both Next's rules:
  //   - only a request the customer's own view returned is read: a tab restored for a request that is not (or no longer)
  //     the customer's says so and reads nothing else (New reads the lines of any id it is given)
  //   - nothing is written on entry: New's open-time reconcile (every line on site but the header not DEPLOYED: PATCH
  //     the header to DEPLOYED) is not done here; the page reads where the equipment is from the lines, and accepting a
  //     delivery in this tab still rolls the header up, as New's accept does
  const TRIES = 60;
  const GAP_MS = 50;

  class loadRecordChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      v.isLoading = true;
      v.error = '';
      v.exportOpen = false;
      if (!(params && params.keepBanner)) v.banner = { type: '', text: '', link: '' };
      for (let i = 0; i < TRIES && !app.flagsLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      v.quotingAllowed = !!rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, 'CUSTOMER');
      v.billingShown = !!rules.isFeatureFlagOff(app.featureFlags, app.flagsLoaded, 'EXTERNAL_PROJECT_ASSIGN_ENABLED');
      try {
        const number = String(v.number || '');
        const given = Number(v.id) || 0;
        if (!number && !given) {
          v.error = 'No request was given. Open one from the customer portal.';
          return;
        }
        const headerResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
          uriParams: { page: 0, size: 10000 },
        });
        const rows = headerResult && headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data) ? headerResult.body.data : null;
        if (!rows) {
          v.error = 'Your request could not be loaded (HTTP ' + (headerResult && headerResult.status) + ').';
          return;
        }
        const first = V.findOwn(rows, number, given);
        if (!first) {
          v.error = 'Request ' + (number || given) + ' could not be found among yours.';
          return;
        }
        const id = first.eqrEquipmentRequestId != null ? Number(first.eqrEquipmentRequestId) : given;
        if (!id) {
          v.error = 'This request could not be found among yours.';
          return;
        }
        v.requestId = id;

        const linesResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
          uriParams: { requestId: Number(id), size: 10000 },
        });
        if (!linesResult || !linesResult.ok || !linesResult.body || !Array.isArray(linesResult.body.data)) {
          v.error = 'The equipment on this request could not be loaded (HTTP ' + (linesResult && linesResult.status) + ').';
          return;
        }
        const lineRows = linesResult.body.data;
        const lines = V.linesOf(lineRows);
        const head = Object.assign(V.headerOf(first, number), { id });
        // deploymentLocation lives on each line row: taken from the first (New's rule).
        if (lineRows.length && lineRows[0].deploymentLocation) head.location = lineRows[0].deploymentLocation;
        const p = V.progressOf(head.status, lines, head.startDate, head.endDate);
        const nx = V.nextFor(head, lines, p, v.quotingAllowed);
        head.headline = V.headline(p, head.status);
        head.detail = V.detailFor(p, lines);
        head.next = nx.text;
        head.hasQuote = portal.hasQuote(head.status, v.quotingAllowed);
        const known = new Set(lines.map((l) => l.lineId));
        const ticks = {};
        Object.keys(v.ticks || {}).forEach((k) => { if (known.has(k)) ticks[k] = true; });

        v.lines = lines;
        v.ticks = ticks;
        v.p = p;
        v.step = V.nextStep(head, lines, v.quotingAllowed);
        v.head = head;
        bus.rename('customer-request:' + (v.id || v.number), head.requestNumber);
      } catch (e) {
        console.error('[customer loadRecordChain] failed', e);
        v.error = 'This request could not be loaded.';
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadRecordChain;
});
