define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class ExportChain extends ActionChain {
    /**
     * Export the active tab to CSV.
     *
     * Reads the LIVE row variables (historyRows, projCostRows, …), which now hold
     * exactly what the grid shows: reportsData.loadTab fetches them already
     * filtered server-side by the smart-search criterion.
     *
     * These used to read `*FilteredRows`, written by the old client-side
     * FilterChain. That chain is now a no-op stub, so those variables are never
     * populated and the export silently produced empty CSVs.
     */
    async run(context) {
      const { $page } = context;
      const activeTab = $page.variables.reportsActiveTab;
      const data = {
        history:         $page.variables.historyRows,
        rentalReq:       $page.variables.rentalReqRows,
        projCost:        $page.variables.projCostRows,
        rateExc:         $page.variables.rateExcRows,
        rateSchedType:   $page.variables.rateSchedReportType,
        rateSched:       $page.variables.rateSchedRows,
        rateSchedExc:    $page.variables.rateSchedExcRows,
        agreementExpiry: $page.variables.agreementExpiryRows
      };
      $page.functions.exportCSV(activeTab, data);
    }
  }

  return ExportChain;
});
