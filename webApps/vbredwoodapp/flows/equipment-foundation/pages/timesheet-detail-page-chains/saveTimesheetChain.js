define([
  'vb/action/actionChain',
  'vb/action/actions',
  'ojs/ojarraydataprovider',
  'resources/js/timesheetRows',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, ArrayDataProvider,
  timesheetRows, lineBody, cu) => {
  'use strict';

  function toISODate(d) {
    if (!d || isNaN(d.getTime())) return null;
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  class saveTimesheetChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      
      console.log('[saveTimesheetChain] Started');

      $page.variables.isSaving  = true;
      $page.variables.saveError = '';

      try {
        console.log('[save] selectedWeekStart:', $page.variables.selectedWeekStart);
        console.log('[save] requestId:', $page.variables.requestId);
        console.log('[save] _modifiedIds:', JSON.stringify($page.functions.getModifiedIds()));

        // Force-commit any active cell edit so the grid fires ojBeforeEditEnd
        // before we read _modifiedIds. Clicking Save steals focus which would
        // otherwise trigger the cancel path, leaving _modifiedIds empty.
        $page.functions.commitActiveEdit();
        await new Promise(resolve => setTimeout(resolve, 150));

        console.log('[saveTimesheetChain] Step 1: Preparing change sets');
        const prepared = $page.functions.prepareChangeSets();
        const equipPrepared = $page.functions.prepareEquipChangeSets();
        console.log('[saveTimesheetChain] prepareChangeSets result:', prepared, 'equipPrepared:', equipPrepared);
        
        if (!prepared && !equipPrepared) {
          console.warn('[saveTimesheetChain] prepareChangeSets returned false for both, aborting');
          return;
        }

        const weekStart = $page.variables.selectedWeekStart;
        const requestId = $page.variables.requestId;
        console.log('[saveTimesheetChain] Context - weekStart:', weekStart, 'requestId:', requestId);

        // Build the seven day dates for the current week
        const dayDates = [];
        if (weekStart) {
          const base = new Date(weekStart + 'T00:00:00');
          for (let d = 0; d < 7; d++) {
            let day = new Date(base);
            day.setDate(base.getDate() + d);
            const iso = toISODate(day);
            if (iso) dayDates.push(iso);
          }
        }
        console.log('[saveTimesheetChain] Calculated day dates:', dayDates);

        let failedCount = 0;
        let skippedEmptyCount = 0;

        // ─── Step 2: Process updates ──────────────────────────────────────────
        console.log('[saveTimesheetChain] Step 2: Processing UPDATE loop');
        let update;
        let updateIdx = 0;
        while ((update = $page.functions.getNextUpdate()) !== null) {
          updateIdx++;
          console.log(`[saveTimesheetChain] UPDATE row #${updateIdx}:`, update);
          const entryId = update.id;
          const body    = update.body;

          if (!entryId) {
            console.warn('[saveTimesheetChain] Missing entryId for update row, skipping');
            failedCount++;
            continue;
          }

          const dayHours = [
            Number(body.hours_day1) || 0,
            Number(body.hours_day2) || 0,
            Number(body.hours_day3) || 0,
            Number(body.hours_day4) || 0,
            Number(body.hours_day5) || 0,
            Number(body.hours_day6) || 0,
            Number(body.hours_day7) || 0
          ];
          const totalHours = dayHours.reduce((s, h) => s + h, 0);

          console.log(`[saveTimesheetChain] PATCHing header [${entryId}] totalHours: ${totalHours}`);
          try {
            const patchResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchTimeEntry',
              uriParams: { id: entryId },
              body: {
                totalHours:    totalHours,
                billableHours: totalHours,
                entryType:     body.hours_type || 'USAGE',
                status:        'DRAFT'
              }
            });
            console.log(`[saveTimesheetChain] PATCH header [${entryId}] status:`, patchResp.status);

            if (!patchResp || !patchResp.ok) {
              console.warn(`[saveTimesheetChain] PATCH header [${entryId}] failed`);
              failedCount++;
              continue;
            }

            for (let i = 0; i < 7; i++) {
              const dayDate = dayDates[i];
              if (!dayDate) continue;
              console.log(`[saveTimesheetChain] Upserting day: ${dayDate} hours: ${dayHours[i]}`);
              await Actions.callRest(context, {
                endpoint: 'eqp-v1/createTimeEntryDay',
                body: { timeEntryId: entryId, workDate: dayDate + 'T00:00:00Z', hoursWorked: dayHours[i] }
              });
            }
          } catch (restErr) {
            console.error('[saveTimesheetChain] REST error in UPDATE loop:', restErr);
            failedCount++;
          }
        }

        // ─── Step 2b: Process creates ─────────────────────────────────────────
        console.log('[saveTimesheetChain] Step 2b: Processing CREATE loop');
        let create;
        let createIdx = 0;
        while ((create = $page.functions.getNextCreate()) !== null) {
          createIdx++;
          console.log(`[saveTimesheetChain] CREATE row #${createIdx}:`, create);
          console.log('[save] CREATE body:', JSON.stringify(create.body));
          const body          = create.body;
          const requestLineId = Number(body.request_line_id);

          if (!requestLineId) {
            console.warn('[saveTimesheetChain] request_line_id missing for CREATE row, skipping');
            continue;
          }

          const dayHours = [
            Number(body.hours_day1) || 0,
            Number(body.hours_day2) || 0,
            Number(body.hours_day3) || 0,
            Number(body.hours_day4) || 0,
            Number(body.hours_day5) || 0,
            Number(body.hours_day6) || 0,
            Number(body.hours_day7) || 0
          ];
          const totalHours = dayHours.reduce((s, h) => s + h, 0);

          if (totalHours <= 0) {
            // A new row with no hours is dropped, and the post-save re-fetch then
            // wipes it from the grid. Silently losing a row the user just added
            // reads as a bug, so count it and tell them.
            skippedEmptyCount++;
            console.log('[saveTimesheetChain] Skipping empty new row (totalHours is 0)');
            continue;
          }

          console.log(`[saveTimesheetChain] POSTing new header for requestLineId: ${requestLineId} totalHours: ${totalHours}`);
          try {
            const createResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createTimeEntry',
              body: {
                requestLineId: requestLineId,
                entryDate:     weekStart + 'T00:00:00Z',
                entryType:     body.hours_type || 'USAGE',
                totalHours:    totalHours,
                billableHours: totalHours,
                status:        'DRAFT'
              }
            });
            console.log(`[saveTimesheetChain] POST header status: ${createResp.status}`);

            if (!createResp || !createResp.ok || !createResp.body) {
              console.warn('[saveTimesheetChain] POST header failed');
              failedCount++;
              continue;
            }

            const newEntryId = createResp.body.id;
            console.log(`[saveTimesheetChain] New entry created id: ${newEntryId}`);

            for (let j = 0; j < 7; j++) {
              const dayDate = dayDates[j];
              if (!dayDate) continue;
              await Actions.callRest(context, {
                endpoint: 'eqp-v1/createTimeEntryDay',
                body: { timeEntryId: newEntryId, workDate: dayDate + 'T00:00:00Z', hoursWorked: dayHours[j] }
              });
            }
          } catch (restErr) {
            console.error('[saveTimesheetChain] REST error in CREATE loop:', restErr);
            failedCount++;
          }
        }

        // ─── Step 2c: Process equipment updates ───────────────────────────────
        console.log('[saveTimesheetChain] Step 2c: Processing EQUIP UPDATE loop');
        let equipUpdate;
        let equipUpdateIdx = 0;
        while ((equipUpdate = $page.functions.getNextEquipUpdate()) !== null) {
          equipUpdateIdx++;
          console.log(`[saveTimesheetChain] EQUIP UPDATE row #${equipUpdateIdx}:`, equipUpdate);
          const entryId = equipUpdate.id;
          const body    = equipUpdate.body;

          if (!entryId) {
            console.warn('[saveTimesheetChain] Missing entryId for equip update row, skipping');
            failedCount++;
            continue;
          }

          const dayHours = [
            Number(body.hours_day1) || 0,
            Number(body.hours_day2) || 0,
            Number(body.hours_day3) || 0,
            Number(body.hours_day4) || 0,
            Number(body.hours_day5) || 0,
            Number(body.hours_day6) || 0,
            Number(body.hours_day7) || 0
          ];
          const totalHours = dayHours.reduce((s, h) => s + h, 0);

          console.log(`[saveTimesheetChain] PATCHing equip header [${entryId}] totalHours: ${totalHours}`);
          try {
            const patchResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchTimeEntry',
              uriParams: { id: entryId },
              body: {
                totalHours:    totalHours,
                billableHours: totalHours,
                entryType:     body.hours_type || 'USAGE',
                status:        'DRAFT'
              }
            });
            console.log(`[saveTimesheetChain] PATCH equip header [${entryId}] status:`, patchResp.status);

            if (!patchResp || !patchResp.ok) {
              console.warn(`[saveTimesheetChain] PATCH equip header [${entryId}] failed`);
              failedCount++;
              continue;
            }

            for (let i = 0; i < 7; i++) {
              const dayDate = dayDates[i];
              if (!dayDate) continue;
              console.log(`[saveTimesheetChain] Upserting equip day: ${dayDate} hours: ${dayHours[i]}`);
              await Actions.callRest(context, {
                endpoint: 'eqp-v1/createTimeEntryDay',
                body: { timeEntryId: entryId, workDate: dayDate + 'T00:00:00Z', hoursWorked: dayHours[i] }
              });
            }
          } catch (restErr) {
            console.error('[saveTimesheetChain] REST error in EQUIP UPDATE loop:', restErr);
            failedCount++;
          }
        }

        // ─── Step 2d: Process equipment creates ───────────────────────────────
        console.log('[saveTimesheetChain] Step 2d: Processing EQUIP CREATE loop');
        let equipCreate;
        let equipCreateIdx = 0;
        while ((equipCreate = $page.functions.getNextEquipCreate()) !== null) {
          equipCreateIdx++;
          console.log(`[saveTimesheetChain] EQUIP CREATE row #${equipCreateIdx}:`, equipCreate);
          const body          = equipCreate.body;
          const requestLineId = Number(body.request_line_id);

          if (!requestLineId) {
            console.warn('[saveTimesheetChain] request_line_id missing for EQUIP CREATE row, skipping');
            continue;
          }

          const dayHours = [
            Number(body.hours_day1) || 0,
            Number(body.hours_day2) || 0,
            Number(body.hours_day3) || 0,
            Number(body.hours_day4) || 0,
            Number(body.hours_day5) || 0,
            Number(body.hours_day6) || 0,
            Number(body.hours_day7) || 0
          ];
          const totalHours = dayHours.reduce((s, h) => s + h, 0);

          if (totalHours <= 0) {
            skippedEmptyCount++;
            console.log('[saveTimesheetChain] Skipping empty new equip row (totalHours is 0)');
            continue;
          }

          console.log(`[saveTimesheetChain] POSTing new equip header for requestLineId: ${requestLineId} totalHours: ${totalHours}`);
          try {
            const createResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createTimeEntry',
              body: {
                requestLineId: requestLineId,
                entryDate:     weekStart + 'T00:00:00Z',
                entryType:     body.hours_type || 'USAGE',
                totalHours:    totalHours,
                billableHours: totalHours,
                status:        'DRAFT'
              }
            });
            console.log(`[saveTimesheetChain] POST equip header status: ${createResp.status}`);

            if (!createResp || !createResp.ok || !createResp.body) {
              console.warn('[saveTimesheetChain] POST equip header failed');
              failedCount++;
              continue;
            }

            const newEntryId = createResp.body.id;
            console.log(`[saveTimesheetChain] New equip entry created id: ${newEntryId}`);

            for (let j = 0; j < 7; j++) {
              const dayDate = dayDates[j];
              if (!dayDate) continue;
              await Actions.callRest(context, {
                endpoint: 'eqp-v1/createTimeEntryDay',
                body: { timeEntryId: newEntryId, workDate: dayDate + 'T00:00:00Z', hoursWorked: dayHours[j] }
              });
            }
          } catch (restErr) {
            console.error('[saveTimesheetChain] REST error in EQUIP CREATE loop:', restErr);
            failedCount++;
          }
        }


        // ─── Step 2e: per-LINE expenditure type ───────────────────────────────
        // Writes to EQR_REQUEST_LINE, not EQR_TIME_ENTRY: the value is per equipment
        // and applies to every week, so it is deliberately excluded from the
        // time-entry body via COLS_SKIP_SAVE.
        //
        // Its own loop, not folded into the update/create loops above: those drain
        // queues keyed by time_entry_line_id, and a line with no time entry never
        // enters either. Setting a type on a line with no hours booked is a
        // legitimate edit -- and the common one, since only 45 of 545 cost rows
        // carry a time entry at all.
        //
        // One PATCH per DISTINCT request line, so editing four week rows of the same
        // equipment is one call.
        console.log('[saveTimesheetChain] Step 2e: per-line expenditure types');
        let expFailed = 0;
        const expChanges = $page.functions.prepareExpTypeChanges($page.variables);
        const expReqId = Number($page.variables.internalRequestId) || null;

        if (expChanges.length && !expReqId) {
          // patchRequestLine is PATCH /equipment-requests/{requestId}/lines/{id} and
          // needs BOTH ids. This page only receives the request NUMBER, so
          // vbEnterChain resolves the internal id; if that has not landed we cannot
          // address the endpoint and must say so rather than 404 silently.
          expFailed = expChanges.length;
          console.warn('[saveTimesheetChain] no internalRequestId - cannot save expenditure types');
        } else {
          // ONE batch PATCH for every changed line (one transaction, all or
          // nothing), replacing a sequential per-line loop. Still verified per
          // line against the ECHO, not just ok: the service tolerates unknown
          // fields, so a 200 alone does not prove the value was stored. The
          // batch returns the lines in the order sent.
          const expBatch = await lineBody.updateLines(context, Actions, {
            requestId: expReqId,
            headers:   cu.auditHeaders(context),
            updates:   expChanges.map(ch => ({ id: Number(ch.requestLineId), expenditureType: ch.expenditureType }))
          });
          expChanges.forEach((ch, i) => {
            const saved = expBatch.ok && expBatch.lines[i] && expBatch.lines[i].expenditureType;
            if (saved === ch.expenditureType) {
              $page.functions.commitExpTypeBaseline(ch.requestLineId, ch.expenditureType);
            } else {
              expFailed++;
              console.warn('[saveTimesheetChain] line %s expenditure type NOT saved (%s, echoed %o)',
                ch.requestLineId, expBatch.message || 'batch ok', saved);
            }
          });
        }

        // ─── Step 3: Re-fetch from DB to repopulate time_entry_line_id ────────
        // After new rows are created, the returned IDs must be written back into
        // _rowMetaAll so that a subsequent Submit routes those rows to
        // _pendingUpdates (not _pendingCreates), preventing duplicate POSTs.
        console.log('[saveTimesheetChain] Step 3: Re-fetching grid from DB after save');
        $page.functions.clearChangeSets();
        $page.functions.clearEquipChangeSets();

        try {
          const refreshResp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
            uriParams: {
              weekStartDate: weekStart  || 'ALL',
              requestNumber: requestId  || 'ALL'
            }
          });

          if (refreshResp && refreshResp.ok && refreshResp.body && refreshResp.body.data) {
            // Non-rentable lines never appear as timesheet rows (they post cost directly).
            // Exclude only confirmed non-rentables; keep rentable + unflagged rows.
            const refreshedRows = refreshResp.body.data.filter(r => r.isRentable !== 'N');
            const lines = timesheetRows.toGridRows(refreshedRows);
            const provider = $page.functions.initProviderFromLines(lines, weekStart);
            $page.variables.dataGridProvider = provider;
            $page.variables.totalHours = refreshedRows.reduce((s, r) => s + (r.totalHours || 0), 0);
            console.log('[saveTimesheetChain] Grid repopulated from DB — time_entry_line_id values refreshed');
          } else {
            console.warn('[saveTimesheetChain] Re-fetch after save returned no data — falling back to in-memory rebuild');
            const provider = $page.functions.rebuildProviderAfterSave(weekStart);
            if (provider) $page.variables.dataGridProvider = provider;
          }
        } catch (refreshErr) {
          console.warn('[saveTimesheetChain] Re-fetch after save failed — falling back to in-memory rebuild:', refreshErr);
          const provider = $page.functions.rebuildProviderAfterSave(weekStart);
          if (provider) $page.variables.dataGridProvider = provider;
        }

        if (expFailed > 0 && failedCount === 0) {
          // Distinct wording on purpose: the hours saved fine, so "row(s) failed to
          // save" would send someone looking in the wrong place.
          $page.variables.saveError = expFailed + ' equipment expenditure type(s) failed to save. '
            + 'The hours were saved. Check console.';
          console.warn('[saveTimesheetChain] ' + expFailed + ' expenditure type(s) failed.');
        } else if (failedCount > 0) {
          $page.variables.saveError = failedCount + ' row(s) failed to save. Check console.';
          console.warn(`[saveTimesheetChain] Completed with ${failedCount} failures.`);
        } else if (skippedEmptyCount > 0) {
          $page.variables.saveError = skippedEmptyCount + ' new row(s) had no hours and were not saved. '
            + 'Enter hours on the day(s) the row applies to, then save again.';
          console.warn(`[saveTimesheetChain] ${skippedEmptyCount} new row(s) skipped for having no hours.`);
        }

        console.log('[saveTimesheetChain] Chain execution finished successfully');

      } catch (e) {
        console.error('[saveTimesheetChain] Fatal error caught in chain:', e);
        $page.variables.saveError = 'A fatal error occurred during save. Check console.';
      } finally {
        $page.variables.isSaving = false;
        console.log('[saveTimesheetChain] Finally: isSaving set to false');
      }

    }

  }

  return saveTimesheetChain;
});
