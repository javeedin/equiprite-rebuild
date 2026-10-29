define([], () => {
  'use strict';

  class PageModule {
    formatCurrency(value) {
      if (value == null) return '$0';
      return '$' + Number(value).toLocaleString();
    }

    /**
     * Post-costs table columns. The "Agreement" column is included only when the
     * AGREEMENTS feature is enabled; when off it is omitted entirely (a static
     * oj-table column can't be oj-bind-if'd individually, so the columns array is
     * built here and bound via columns="[[ $page.functions.postCostColumns(...) ]]").
     * @param {boolean} agreementsEnabled - $application.functions.isFeatureEnabled(...)
     */
    postCostColumns(agreementsEnabled) {
      const cols = [
        // min-width is the floor that stops oj-table-stretch from shrinking the
        // column and clipping the trailing digits of the request number.
        { headerText: 'Request',     field: 'requestNumber',  template: 'reqTpl',     sortable: 'enabled', style: 'width:200px; min-width:200px;' },
        { headerText: 'Project',     field: 'projectName',    template: 'projectTpl', sortable: 'enabled' },
        { headerText: 'Task',        field: 'taskName',                               sortable: 'enabled' }
      ];
      if (agreementsEnabled) {
        cols.push({ headerText: 'Agreement', field: 'agreementNumber', sortable: 'enabled', style: 'width:160px;' });
      }
      cols.push(
        { headerText: 'Start Date',  field: 'startDate',                              sortable: 'enabled', style: 'width:110px;' },
        { headerText: 'End Date',    field: 'endDate',                                sortable: 'enabled', style: 'width:110px;' },
        { headerText: 'Timesheets',  field: 'timesheets',                             sortable: 'enabled', style: 'width:100px;' },
        { headerText: 'Total Hours', field: 'totalHours',                             sortable: 'enabled', style: 'width:100px;' },
        { headerText: 'Total Cost',  field: 'totalBillCost',  template: 'costTpl',    sortable: 'enabled', style: 'width:130px;' }
      );
      return cols;
    }
  }

  return PageModule;
});
