define([], () => {
  'use strict';

  // What the redesign brings to each screen not rebuilt yet, from the approved wireframes (docs/redesign). Shown on
  // the later page so a demo can say what is coming while the old screen is one click away.
  const PLANNED = {
    'new-request': ['One cart for project and customer requests (today three separate pages)',
      'Catalog with availability, templates and agreement items in one click', 'Review step with line overrides and estimated cost'],
    'my-requests': ['One list for project and customer requests with a source badge (today two pages titled My Requests)',
      'Status chips with soft and hard reserve colours', 'Request detail with a status tracker and the quote as a tab'],
    workbench: ['Stage tabs: To approve, To pick, Outbound, Deployed, Inbound, Procurement',
      'Approve & allocate opens from here with the schedule embedded', 'Bulk approve and reject across project and customer requests'],
    schedule: ['Same Bryntum Gantt and Mapbox map', 'Conflicts outlined in red, maintenance windows hatched', 'Soft reserve light blue, hard reserve dark blue'],
    picking: ['Transfer order, reservation and pick release in one action', 'Line-by-line picking and clear exceptions with Re-allocate'],
    inspection: ['Checklists per class and subclass with photos and defects', 'Pass, conditional or fail, with a maintenance work order on fail'],
    receipt: ['Receipt per line with partial receipts and discrepancies', 'Barcode/QR scanner and Direct Return kept'],
    transfer: ['Move equipment between projects without returning it to the yard', 'Transfer history on both requests'],
    'time-entry': ['Weekly grid with hours types, notes and downtime reasons', 'Copy last week; rate filled in from the schedule'],
    'timesheet-approval': ['Variance colours, week-over-week compare and budget impact', 'Adjust hours with an audit trail instead of rejecting'],
    'post-costs': ['One Post costs page (today four pages, two with test names)', 'Preview, re-tier, split across projects, misc charges'],
    'project-costs': ['Direct cost and inventory consumption posted to Oracle Projects for real (today a mock page)'],
    equipment: ['Grid and map that both work (today Map View does nothing)', 'Certificates, maintenance light, last synced, selective sync',
      'Create and edit equipment (today Save does nothing)'],
    rates: ['Spreadsheet grid of the six rate periods with margin check', 'A simulator: what would 80 hours cost?'],
    agreements: ['Agreement lines on their own page, Excel import', 'Create a request from selected lines'],
    analytics: ['One report library; each role sees its reports', 'Utilization vs revenue and downtime views'],
    configuration: ['Ten searchable sections instead of one 2,578-line page', 'Each switch shows what it depends on and what it affects'],
    'page-access': ['Same page access matrix', 'Preview the app as a role'],
    'integration-health': ['A card per integration, exception queue with reprocess', 'Plain-language errors with the fix'],
    'customer-portal': ['Customer home with requests on site and invoices', 'Parcel-style tracking per request; act on behalf of a customer'],
  };

  class PageModule {
    /** Bullet points for what the redesign changes on this screen, or []. */
    planned(navId) {
      return PLANNED[navId] || [];
    }
  }

  return PageModule;
});
