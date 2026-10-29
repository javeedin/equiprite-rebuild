define([], () => {
  'use strict';

  // Post Cost Test list page — identical column/format logic to the live
  // post-cost-page.js. Kept as its own module so the sandbox never depends on
  // (or breaks) the live page.
  class PageModule {
    formatCurrency(value) {
      if (value == null) return '$0';
      return '$' + Number(value).toLocaleString();
    }

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
