define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions) => {
  'use strict';

  const STAGE_BY_TAB = { outbound: 'OUTBOUND', deployed: 'DEPLOYED', inbound: 'INBOUND' };

  // Coerce a possibly-string/null numeric field to a finite number.
  // The view columns come back as JSON numbers, but null/'' must not become
  // NaN — that is what produced blank and 'NaN%' allocation cells.
  const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  class WorkbenchInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const stage = STAGE_BY_TAB[$page.variables.workbenchActiveTab] || 'OUTBOUND';

      $page.variables.isLoading = true;

      let response;
      try {
        response = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
          uriParams: { size: 1000, stage }
        });
      } finally {
        $page.variables.isLoading = false;
      }

      if (!response || !response.ok) {
        console.warn('[WorkbenchInitChain] Failed to fetch workbench data');
        $page.variables.WorkbenchAllArray = [];
        await Actions.callChain(context, { chain: 'WorkbenchFilterChain' });
        $page.variables.pageSubtitle = 'Unable to load workbench data';
        return;
      }

      const raw = response.body.data || [];

      // workbench-requests is REQUEST-GRAIN — one row per request, no equipment
      // identity on the row at all (its only line-ish fields are
      // eqrEquipmentRequestId and totalLines).
      //
      // Probed live 2026-08-19 across every stage this page uses:
      //   OUTBOUND 205 rows / 205 distinct   DEPLOYED 32 / 32
      //   INBOUND   16 rows /  16 distinct   INITIATE 70 / 70
      // — zero duplicate request ids in any of them.
      //
      // A previous version of this comment claimed "ONE ROW PER LINE". That is
      // wrong, and it matters beyond this file: it is the reason the four
      // equipment tracking flags (isTransactable / isFixedAssetTracked / …)
      // CANNOT live on this view. They are columns on EQR_EQUIPMENT_MASTER, and
      // a request is a container of lines pointing at different equipment, so
      // any value here would have to be derived by an any/all aggregation over
      // the lines — ambiguous by construction. Read those flags at line grain
      // (views/request-detail-lines) or unit grain (views/line-detail-units)
      // instead. See docs/FIXED_ASSET_FM_PATHWAY_SPEC.md §3.0.
      //
      // The dedupe below is therefore a no-op against today's data. It is kept
      // as a cheap idempotence guard: it costs one Map pass, and if the view
      // ever regresses to line grain the page still renders one row per request
      // rather than silently repeating requests. totalLines / allocatedLines are
      // analytic counts computed OVER (PARTITION BY request) in
      // EQP_M_WORKBENCH_LINE, so they describe the WHOLE request and stay
      // correct even when `stage` filters rows — safe to take off the first row,
      // but only as long as we never recount rows ourselves.
      const byRequest = new Map();
      raw.forEach(r => {
        const id = r.eqrEquipmentRequestId;
        if (id == null) return;
        if (!byRequest.has(id)) byRequest.set(id, r);
      });

      // Origin test — 'EXTERNAL' | 'INTERNAL' (formerly 'CUSTOMER' | 'PROJECT'),
      // resolved through the app-flow owner so the vocabulary lives in one
      // place. Declared HERE, above the row mapping, because both the mapping
      // and the summary counts below use it.
      const isExt = (r) => context.$application.functions.isExternalSource(r.source);

      // Does this request actually carry a project?
      //
      // Internal rows always do. External rows do ONLY once a manager assigns
      // one (the Assign Project feature) — and distinguishing that from "no
      // project" is subtle, because the payload MIRRORS the customer's name
      // into projectName on unassigned external rows. Testing the name alone
      // would print the customer in the Project column for all of them.
      //
      // Two signals, in order of reliability:
      //  1. projectRefId — set only by a real assignment. Authoritative, but
      //     NOT declared in the openapi3 schema for workbench-requests, so it
      //     may or may not be present on the wire (that spec is known to lag
      //     the live API — `source` and projectInternalCustomer are missing
      //     from it too, yet both arrive). Used when present.
      //  2. projectName !== customerName — the fallback when the id is absent.
      //     A mirrored name is by definition EQUAL to the customer name, while
      //     a genuinely assigned project differs. Verified in paasdev: the two
      //     assigned external rows read "EPC_ MO_Operations" against customers
      //     "US Navy NAVFAC Northeast" / "Cianbro Industrial Services" — both
      //     DISTINCT — while unassigned rows mirror exactly.
      //
      // Either signal alone is enough, so the project shows up whichever way
      // the backend ends up shaping the payload.
      const hasProject = (r) => {
        if (r.projectRefId != null && String(r.projectRefId).trim() !== '') return true;
        if (!r.projectName) return false;
        if (!isExt(r)) return true;   // internal: name is always the real project
        return String(r.projectName).trim() !== String(r.customerName || '').trim();
      };

      const records = Array.from(byRequest.values())
        .map(r => {
          const lines     = num(r.totalLines);
          const allocated = num(r.allocatedLines);
          // Prefer a server-computed percentage when the payload carries one
          // (EQP_M_WORKBENCH exposes ALLOCATION_PCT); otherwise derive it.
          // Deriving is the normal path for workbench-requests, whose backing
          // view has no ALLOCATION_PCT column.
          const pct = r.allocationPct != null
            ? num(r.allocationPct)
            : (lines > 0 ? Math.round((allocated / lines) * 100) : 0);

          return {
            request_id:       r.eqrEquipmentRequestId,
            request_number:   r.requestNumber       || '-',
            source:           r.source              || '',
            // Project / Task / Customer are now THREE separate columns (they
            // used to be collapsed into one "Project / Customer" cell that
            // showed whichever of the two the row happened to have).
            //
            // Which side is populated can't be decided on ORIGIN alone, nor on
            // whether the name fields are non-null:
            //
            //  • On an EXTERNAL row with no project the payload MIRRORS the
            //    customer's name into projectName, so a plain
            //    `projectName || ''` prints the customer in the Project column.
            //  • But an EXTERNAL row CAN legitimately carry a project — that is
            //    exactly what Assign Project writes — and blanking every
            //    external row would hide the value the feature just saved.
            //
            // projectRefId is the signal that separates them: it is set only by
            // a real assignment and is absent on the mirrored name. Verified in
            // paasdev — the two external rows with a project have
            // PROJECT_REF_ID set and a project name genuinely DISTINCT from
            // their customer name ("EPC_ MO_Operations" vs "US Navy NAVFAC
            // Northeast"), while the other 45 have neither.
            //
            // hasProject therefore covers both origins with one rule: internal
            // rows always have it, external rows have it once assigned.
            project:          hasProject(r) ? (r.projectName || '') : '',
            task:             hasProject(r) ? (r.taskName    || '') : '',
            // Internal/External Customer — the counterparty. For an EXTERNAL
            // request that is the paying customer; for an INTERNAL one it is
            // the internal customer the project is charged to, when the backend
            // supplies it (projectInternalCustomer is present in the payload
            // but null throughout the current data, so internal rows normally
            // render blank here rather than a wrong value).
            customer:         isExt(r)
                                ? (r.customerName || r.projectName || '')
                                : (r.projectInternalCustomer || ''),
            project_sub:      '',
            requestor:        r.requestor           || r.contactName || '-',
            location:         r.location            || '-',
            start_date:       r.requestedStartDate ? r.requestedStartDate.slice(0, 10) : '-',
            end_date:         r.requestedEndDate   ? r.requestedEndDate.slice(0, 10)   : '-',
            status:           r.requestStatus       || '',
            lines:            lines,
            allocated_lines:  allocated,
            // Precomputed so the cell template is a plain read — previously the
            // template called getAllocationPct() three times per row.
            allocation_pct:   Math.max(0, Math.min(100, pct)),
            total_est_cost:   num(r.totalEstCost)
          };
        })
        .sort((a, b) => Number(b.request_id) - Number(a.request_id));

      $page.variables.WorkbenchAllArray = records;
      await Actions.callChain(context, { chain: 'WorkbenchFilterChain' });

      const total     = records.length;
      // In-flight = not-yet-deployed active requests. Includes the customer
      // quote states (QUOTE_GENERATED, QUOTE_ACCEPTED) alongside SUBMITTED /
      // IN_PROCESS. UNDER_PROCUREMENT is a LINE status only (header never
      // carries it), so it is intentionally not counted here.
      const ACTIVE = ['SUBMITTED', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'IN_PROCESS'];
      const inProcess = records.filter(r => ACTIVE.indexOf(r.status) !== -1).length;
      // Origin is 'EXTERNAL' | 'INTERNAL' (was 'CUSTOMER' | 'PROJECT'). Counted
      // through the app-flow owner, which accepts both spellings — the old
      // strict === 'PROJECT'/'CUSTOMER' tests silently reported 0 / 0 once the
      // backend switched vocabulary.
      const customer  = records.filter(isExt).length;
      // Internal = everything with an origin that isn't external. Rows with no
      // source at all are excluded from BOTH counts rather than defaulting into
      // internal, so the two numbers never overstate what the data says.
      const project   = records.filter(r => r.source && !isExt(r)).length;

      // Requests not yet fully allocated. Per-row allocation_pct drives this;
      // the stage-wide "N% Allocated (x/y lines)" coverage figure that used to
      // sit in the subtitle was removed, so no line-level totals are rolled up
      // here any more. Per-row allocation is still shown in the grid's
      // Allocation column.
      const unallocated = records.filter(r => r.allocation_pct < 100).length;

      $page.variables.pageSubtitle =
        total + ' Total  ·  ' +
        inProcess + ' In Process  ·  ' +
        project + ' Internal  ·  ' +
        customer + ' External  ·  ' +
        unallocated + ' Need Attention';
    }
  }

  return WorkbenchInitChain;
});
