define([], function () {
  'use strict';

  /*
   * THE camelCase -> snake_case map between the timesheet-details API and the grid.
   *
   * The grid's row builder does COLUMN_KEYS.map(key => item[key]) on SNAKE_CASE keys
   * (timesheet-detail-page.js initProviderFromLines), but the API returns camelCase.
   * This function is the bridge, and it used to exist as four byte-identical copies:
   *
   *   timesheet-detail-page-chains/vbEnterChain.js
   *   timesheet-detail-page-chains/refreshGridByWeekChain.js
   *   timesheet-detail-page-chains/saveTimesheetChain.js
   *   timesheet-detail-page-chains/submitTimesheetChain.js
   *
   * Four copies is how a column silently stops working: the Expenditure Type column
   * shipped with a key in COLUMN_KEYS and in none of the four maps, so every cell
   * rendered blank and looked like a missing backend column. Worse, a key present in
   * three of four blanks the cell only after the one action whose copy lacks it --
   * miss saveTimesheetChain's and the value disappears immediately after the save
   * that persisted it, which is indistinguishable from a failed write.
   *
   * Add a field HERE and all four callers get it. This is the same reason
   * post-cost-test-detail-page.js pulled visibleRows() out of seven chains.
   */

  /**
   * Map one page of timesheet-details API rows onto grid rows.
   *
   * @param apiRows array from response.body.data (the eqpt envelope is `data`,
   *                not Fusion's `items`)
   * @returns array of snake_case grid rows
   */
  function toGridRows(apiRows) {
    return (Array.isArray(apiRows) ? apiRows : []).map(function (r) {
      return {
        request_number:     r.requestNumber      || '',
        class_name:         r.className          || '',
        equipment_name:     r.equipmentName      || '',
        hours_type:         r.hoursType          || '',
        status:             r.entryStatus        || '',
        task_name:          r.taskName           || '',
        start_date:         r.requestedStartDate ? r.requestedStartDate.slice(0, 10) : '',
        end_date:           r.requestedEndDate   ? r.requestedEndDate.slice(0, 10)   : '',
        non_labor_resource: r.nonLaborResource   || '',
        hours_day1:         r.day1Hours          || 0,
        hours_day2:         r.day2Hours          || 0,
        hours_day3:         r.day3Hours          || 0,
        hours_day4:         r.day4Hours          || 0,
        hours_day5:         r.day5Hours          || 0,
        hours_day6:         r.day6Hours          || 0,
        hours_day7:         r.day7Hours          || 0,
        time_entry_line_id: r.eqrTimeEntryId     || null,
        eqr_time_entry_id:  r.eqrTimeEntryId     || null,
        request_line_id:    r.requestLineId      || null,
        default_hours:      r.defaultHours       || null,
        // The equipment's PPM expenditure type. Per request LINE, so it is the same
        // on every week row of one equipment. null until the backend column ships;
        // the column then renders "Set type" rather than blank.
        //
        // Note defaultHours above is read by all four callers, drives the hours
        // pre-fill, and appears NOWHERE in services/eqp-v1/openapi3.json -- which is
        // the standing proof that response fields are not filtered by the schema. So
        // this arrives as soon as the API emits it, with no openapi change required.
        expenditure_type:   r.expenditureType    || null,
        // The equipment MASTER (model) this line is for, plus its subclass and
        // class. Added to the view by V344's backend change purely so the picker
        // can ask "which expenditure types were authored for this equipment" --
        // the row carried only equipmentName and className before, which are
        // display strings and cannot key a lookup.
        //
        // Same note as defaultHours above applies: these are not in
        // services/eqp-v1/openapi3.json's timesheet-details response schema and
        // do not need to be. Undeclared fields pass through on this endpoint.
        equipment_master_id:   r.eqrEquipmentMasterId   || null,
        equipment_subclass_id: r.eqrEquipmentSubclassId || null,
        equipment_class_id:    r.eqrEquipmentClassId    || null
      };
    });
  }

  return { toGridRows: toGridRows };
});
