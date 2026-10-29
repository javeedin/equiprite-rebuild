define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // Runs the BIP report EQP_PROJECTS_LOV_RP for the text the Project
  // oj-select-single asked about, and delivers the rows back to the page module's
  // ProjectSuggestProvider via $page.functions.deliverProjects(text, rows).
  //
  // Triggered by the page event projectSearchRequested, which the PROVIDER fires
  // from fetchFirst — so the component is already awaiting this exact text, and
  // oj-input-search does its own typing debounce. No debounce here.
  //
  // Why a report and not Fusion REST projectsLOV: its `LIKE` is case-sensitive,
  // rejects UPPER()/finder and honours only the first term of an OR, so no REST
  // query can match "epc" against "EPC Gas Pipeline". The report does
  // UPPER(name|number) LIKE UPPER('%text%') — any casing, one call.
  // See docs/sql/EQP_PROJECTS_LOV_RP.sql and
  // docs/PROJECT_LOV_CASE_INSENSITIVE_SEARCH_2026-10-13.md.
  //
  // The Project field is an oj-select-single, which shows every row the
  // provider returns (oj-input-search used to cut them to 12). This is only a
  // guard against a very broad search flooding the dropdown — not a page size.
  const MAX_SUGGESTIONS = 500;

  // buildSoapBody splices values straight into XML, so a typed & or < would
  // break the envelope.
  function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  class ProjectTypeaheadChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const text = (params && params.searchValue != null) ? String(params.searchValue).trim() : '';
      // Blank text is allowed: it is the browse list shown when the field is
      // clicked, and the report returns the first rows by name for a blank search.

      let rows = [];
      try {
        const soapBody = bipLov.buildSoapBody(
          '/Custom/EquipRite/EQP_PROJECTS_LOV_RP.xdo',
          [
            { name: 'P_SEARCH',    value: xmlEscape(text) },
            { name: 'P_SEARCH_BY', value: 'ALL' },
          ]
        );

        const response = await Actions.callRest(context, {
          endpoint: 'bipService/runBIPReport',
          body: soapBody,
        });

        // BIP upper-cases the element names (PROJECTID...), unlike REST's
        // ProjectId. Rename them so the picked row matches what
        // CaptureProjectNameChain and the suggestion template read.
        const found = bipLov.decodeReportRows(response.body, 'G_1', 'PROJECTID', 'PROJECTNAME', 'PROJECTNUMBER');
        rows = found.slice(0, MAX_SUGGESTIONS).map((r) => ({
          ProjectId:     r.PROJECTID,
          ProjectNumber: r.PROJECTNUMBER,
          ProjectName:   r.PROJECTNAME,
        }));
        console.log('ProjectTypeaheadChain:', found.length, 'projects for', JSON.stringify(text));
      } catch (e) {
        console.error('ProjectTypeaheadChain error:', e);
      }
      $page.functions.deliverProjects(text, rows);
    }
  }

  return ProjectTypeaheadChain;
});
