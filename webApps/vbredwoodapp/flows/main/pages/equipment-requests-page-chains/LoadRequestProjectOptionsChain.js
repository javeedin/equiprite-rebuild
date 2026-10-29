define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Populates the Project and Request # chips' dropdowns with distinct
   * project names / request numbers.
   *
   * No dedicated distinct-values endpoint exists for this view (confirmed
   * against openapi3.json — getEquipriteV1ViewsMyRequests only declares
   * page/size/q/requestStatus/sortBy/sortOrder), so this fetches a large
   * page of the SAME view the grid itself uses and derives both lists
   * client-side off the one fetch, once at page load — same shape of
   * workaround as the Analytics/Reports pages' buildChipOptions, just a
   * one-time upfront fetch instead of per-tab since this page has no
   * "already loaded rows" array to read from (it's server-paginated via
   * requestsDPV).
   *
   * SECURITY: replicates requestsSDP's OWN role-based origin scope
   * (myRequestsOriginFilter) on this fetch too — otherwise a non-manager's
   * Project/Request # dropdowns could leak values from EXTERNAL requests
   * they are not permitted to see via the grid itself.
   *
   * CAVEAT: requestNumber is unique per row, so past 500 open requests this
   * dropdown stops being exhaustive (same size cap as the Project list,
   * which degrades more gracefully since project names repeat). Picking an
   * entry still produces a correct, single-request filter — it just isn't
   * guaranteed to list every request number in the system.
   */
  class LoadRequestProjectOptionsChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;

      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsMyRequests',
          uriParams: {
            size:   500,
            filter: $application.functions.myRequestsOriginFilter($application.variables.fusionRoles)
          }
        });
      } catch (e) {
        console.error('[LoadRequestProjectOptionsChain] fetch threw:', e);
        resp = null;
      }

      const rows = (resp && resp.ok && resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];

      function distinct(getValue) {
        const seen = new Set();
        const options = [];
        rows.forEach((r) => {
          const v = r && getValue(r);
          if (!v || seen.has(v)) return;
          seen.add(v);
          options.push({ label: v, value: v });
        });
        options.sort((a, b) => a.label.localeCompare(b.label));
        return options;
      }

      $page.variables.ProjectOptionsArray = distinct((r) => r.projectName);
      $page.variables.RequestNumberOptionsArray = distinct((r) => r.requestNumber);
    }
  }

  return LoadRequestProjectOptionsChain;
});
