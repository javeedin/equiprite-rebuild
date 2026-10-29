define([], function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════
  // Call the EQP_POST_COST_FLOW_TEST OIC flow, on whichever URL this OIC serves.
  // ════════════════════════════════════════════════════════════════════════
  //
  // OIC Gen3 serves an integration that lives inside a PROJECT only at
  //   /ic/api/integration/v2/flows/rest/project/EQUIPRITE_DEV/EQP_POST_COST_FLOW_TEST/1.0/eqp/post-cost
  // and one outside a project only at
  //   /ic/api/integration/v1/flows/rest/EQP_POST_COST_FLOW_TEST/1.0/eqp/post-cost
  // and the two instances we post through differ. Probed 2026-10-11 with an
  // unauthenticated GET (401 = served, 404 = "no currently active integrations"):
  //
  //   riteoicdev-idjm2yj32zav-ia (dev20)        v1 401   project 404
  //   oicdev-axjuvjkpckuf-px     (dev6, OII)    v1 404   project 401
  //
  // So: try the project URL, and on a 404 try v1. The fallback cannot post
  // twice -- each instance serves exactly ONE of the two URLs, so the call that
  // 404s ran nothing. (A 404 from Fusion inside a running flow would come back
  // from the URL that IS served; the retry then hits the unserved one and 404s
  // harmlessly.)
  //
  // Returns the callRest response of the call that reached the flow (or the
  // final 404). Same contract as calling ics/postCostToFusion directly.
  async function post(context, Actions, requestNumber) {
    const body = { requestNumber: String(requestNumber) };
    const project = await Actions.callRest(context, {
      endpoint: 'ics/postCostToFusionProject',
      body: body
    });
    if (!project || project.status !== 404) { return project; }
    console.log('[postCostToFusion] project URL not served on this OIC (404) - using the v1 URL');
    return Actions.callRest(context, {
      endpoint: 'ics/postCostToFusion',
      body: body
    });
  }

  return { post: post };
});
