define([], () => {
  'use strict';

  const TIMESHEET_DATA = [
    {
      timesheet_id: "TSH-2026-015",
      request_id: "REQ-6001",
      type: "REQUEST",
      project: "Darwin Rail Expansion",
      week_label: "Apr 21 – Apr 27, 2026",
      week_start: "2026-04-21",
      equipment_count: 4,
      total_hours: 160,
      bill_amount: 480000,
      status: "APPROVED"
    },
    {
      timesheet_id: "TSH-2026-014",
      request_id: "REQ-7002",
      type: "REQUEST",
      project: "Port Hedland Loading Dock",
      week_label: "Apr 21 – Apr 27, 2026",
      week_start: "2026-04-21",
      equipment_count: 2,
      total_hours: 80,
      bill_amount: 125000,
      status: "SUBMITTED"
    },
    {
      timesheet_id: "TSH-2026-013",
      request_id: "REQ-2005",
      type: "REQUEST",
      project: "Coastal Desalination Plant",
      week_label: "Apr 14 – Apr 20, 2026",
      week_start: "2026-04-14",
      equipment_count: 3,
      total_hours: 120,
      bill_amount: 320000,
      status: "APPROVED"
    },
    {
      timesheet_id: "TSH-2026-012",
      request_id: "REQ-9009",
      type: "REQUEST",
      project: "Mining Site B",
      week_label: "Apr 14 – Apr 20, 2026",
      week_start: "2026-04-14",
      equipment_count: 1,
      total_hours: 40,
      bill_amount: 95000,
      status: "SUBMITTED"
    },
    {
      timesheet_id: "TSH-2026-011",
      request_id: "REQ-1001",
      type: "REQUEST",
      project: "Highway Expansion",
      week_label: "Apr 7 – Apr 13, 2026",
      week_start: "2026-04-07",
      equipment_count: 2,
      total_hours: 90,
      bill_amount: 240000,
      status: "APPROVED"
    },
    {
      timesheet_id: "TSH-2026-010",
      request_id: "REQ-4008",
      type: "REQUEST",
      project: "Bridge Construction — Perth",
      week_label: "Apr 7 – Apr 13, 2026",
      week_start: "2026-04-07",
      equipment_count: 1,
      total_hours: 40,
      bill_amount: 55000,
      status: "SUBMITTED"
    },
    {
      timesheet_id: "TSH-2026-009",
      request_id: "REQ-3002",
      type: "REQUEST",
      project: "Solar Farm — Pilbara",
      week_label: "Mar 30 – Apr 5, 2026",
      week_start: "2026-03-30",
      equipment_count: 5,
      total_hours: 200,
      bill_amount: 850000,
      status: "SUBMITTED"
    },
    {
      timesheet_id: "TSH-2026-002",
      request_id: "REQ-1001",
      type: "REQUEST",
      project: "Highway Expansion",
      week_label: "Mar 30 – Apr 5, 2026",
      week_start: "2026-03-30",
      equipment_count: 1,
      total_hours: 8,
      bill_amount: 72000,
      status: "SUBMITTED"
    },
    {
      timesheet_id: "TSH-2026-001",
      request_id: "REQ-1001",
      type: "REQUEST",
      project: "Highway Expansion",
      week_label: "Mar 23 – Mar 29, 2026",
      week_start: "2026-03-23",
      equipment_count: 2,
      total_hours: 18,
      bill_amount: 120000,
      status: "APPROVED"
    }
  ];

  class PageModule {
    /**
     * Returns the dataset for approvals.
     * Note: Drafts are excluded as this is an approvals workbench.
     */
    getTimesheetData() {
      return TIMESHEET_DATA;
    }

    formatCurrency(value) {
      if (value == null) return '—';
      return '$' + Number(value).toLocaleString();
    }
  }

  return PageModule;
});
