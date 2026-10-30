define([], function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════
  // The project's Fusion BUSINESS UNIT, captured when the project is picked.
  // ════════════════════════════════════════════════════════════════════════
  //
  // WHY THIS EXISTS
  // When equipment cost posts to Fusion PPM, the OIC field map sends
  // `BusinessUnit` as a HARDCODED literal, 'US1 Business Unit'. That happens to
  // be right on our dev pod only by luck -- every project we have ever posted to
  // (10011, 4488, 100122, 100133, OCEANEERING-DEMO, O2C-MA-01) is in that BU,
  // while the pod itself holds 15. On the customer's pod there are SIX business
  // units -- BU-USA_FC-USD, BU-AUS_FC-AUD, BU-NOR_FC-NOK, BU-GBR_FC-GBP,
  // BU-VUT_FC-USD, BU-SUR_FC-USD -- and 'US1 Business Unit' does not exist at
  // all, so every posted row would be rejected.
  //
  // The business unit is a property of the PROJECT, so it is captured with the
  // project and stored on the request. EQR_EQUIPMENT_REQUEST.PROJECT_BU_ID /
  // PROJECT_BU_NAME already existed and were NULL on all 450 rows; the backend
  // confirmed both are mapped end to end on POST/PUT/PATCH and both GETs.
  //
  // ⚠️ It is the NAME that posts -- Fusion's cost interface takes the business
  // unit as a string. The id is carried alongside for joins and because it
  // survives a re-label.
  //
  // 🔴 WHY NOT projectsLOV
  // The LOV the pickers are bound to returns FIVE attributes and BusinessUnit is
  // not among them, so the picked row cannot answer this. `projects/{ProjectId}`
  // can -- it returns 149 attributes including BusinessUnitName and
  // BusinessUnitId -- and it is already registered as ProjectsById. That is why
  // this costs an extra round-trip rather than being read off the picked row
  // like ProjectName and ProjectNumber are.
  //
  // ⚠️ NOT THE SAME AS THE EXPENDITURE ORGANIZATION. The project also carries
  // OwningOrganizationName, and it is a different thing: the customer's posted
  // usage rows sit against operational orgs (SSR_P4_TOOL_Rental,
  // SSR_P4_ROV_Vessel Support) that are not their projects' owning orgs. The
  // expenditure org comes from projectOrganizationsLOV. Do not source it here.
  //
  // FAILURE BEHAVIOUR: never throws, never blocks. A failed lookup returns the
  // empty result and the request saves without a BU, exactly as it does today.
  // Losing the request because Fusion was slow would be far worse than posting
  // later with the literal that is already in the field map.

  var EMPTY = { id: null, name: '' };

  /**
   * Read a project's business unit from Fusion.
   *
   * @param context  the action chain's context
   * @param Actions  vb/action/actions, passed in by the caller (this module is
   *                 defined with no dependencies, like maintAssetLocation.js)
   * @param projectId  Fusion ProjectId
   * @returns {Promise<{id: ?number, name: string}>} never rejects
   */
  async function fetchForProject(context, Actions, projectId) {
    if (!projectId) { return EMPTY; }

    try {
      var resp = await Actions.callRest(context, {
        endpoint:  'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsById',
        // ProjectId is a PATH parameter and `fields` a query one; both go under
        // uriParams. A `parameters` key is silently dropped by callRest.
        uriParams: {
          ProjectId: projectId,
          fields:    'ProjectId,BusinessUnitId,BusinessUnitName'
        }
      });

      // projects/{id} returns the object itself, not an items[] envelope.
      var body = resp && resp.ok ? resp.body : null;
      if (!body || !body.BusinessUnitName) {
        console.warn('[PROJECTBU] no BusinessUnitName for project %s'
          + ' - the request will save without a business unit', projectId);
        return EMPTY;
      }

      console.log('[PROJECTBU] project %s -> %s (%s)',
        projectId, body.BusinessUnitName, body.BusinessUnitId);

      return {
        id:   body.BusinessUnitId != null ? Number(body.BusinessUnitId) : null,
        name: body.BusinessUnitName || ''
      };
    } catch (e) {
      console.warn('[PROJECTBU] lookup failed for project %s:', projectId,
        e && e.message);
      return EMPTY;
    }
  }

  return {
    EMPTY:           EMPTY,
    fetchForProject: fetchForProject
  };
});
