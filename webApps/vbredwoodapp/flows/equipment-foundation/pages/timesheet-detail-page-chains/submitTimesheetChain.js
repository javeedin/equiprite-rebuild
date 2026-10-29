define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/timesheetRows',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions,
  timesheetRows, lineBody, cu) => {
  'use strict';

  function toISODate(d) {
    if (!d || isNaN(d.getTime())) return null;
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  class submitTimesheetChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;

      $page.variables.isSubmitting = true;
      $page.variables.submitError  = '';

      const requestNumber = $page.variables.requestId;
      const weekStart     = $page.variables.selectedWeekStart;

      if (!requestNumber || !weekStart) {
        $page.variables.submitError  = 'Missing request or week information.';
        $page.variables.isSubmitting = false;
        return;
      }

      // ─── VALIDATION: Rate Type required on every row ──────────────────────
      const rateTypeError = $page.functions.validateRateTypes();
      if (rateTypeError) {
        $page.variables.submitError  = rateTypeError;
        $page.variables.isSubmitting = false;
        await Actions.fireNotificationEvent(context, {
          summary: 'Validation Error',
          message: rateTypeError,
          type: 'error',
          displayMode: 'transient'
        });
        return;
      }

      // ─── VALIDATION: Expenditure Type required under PPM rates ────────────
      // Under PPM the approved hours post to Fusion under the line's
      // expenditure type; without one Fusion refuses them, and only after
      // approval. isFeatureEnabled fails CLOSED (false while flags load), which
      // here would skip the check -- so refuse until the flags are in.
      // ⚠️ $application MUST be destructured (it is, above) or the lookup
      // silently reads as "flag off".
      if (!$application.variables.flagsLoaded) {
        $page.variables.submitError  = 'Settings are still loading. Please try again in a moment.';
        $page.variables.isSubmitting = false;
        return;
      }
      const ppmOn = $application.functions.isFeatureEnabled(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'PPM_RATES_ENABLED'
      );
      if (ppmOn) {
        $page.functions.commitActiveEdit();
        const expTypeError = $page.functions.validateExpenditureTypes($page.variables);
        if (expTypeError) {
          $page.variables.submitError  = expTypeError;
          $page.variables.isSubmitting = false;
          await Actions.fireNotificationEvent(context, {
            summary: 'Validation Error',
            message: expTypeError,
            type: 'error',
            displayMode: 'transient'
          });
          return;
        }
      }

      // ─── PHASE 1: Save all dirty rows first ───────────────────────────────
      console.log('[submitTimesheetChain] Phase 1: Saving dirty rows before submit');

      try {
        // Force-commit any active cell edit
        $page.functions.commitActiveEdit();
        await new Promise(resolve => setTimeout(resolve, 150));

        const prepared      = $page.functions.prepareChangeSets();
        const equipPrepared = $page.functions.prepareEquipChangeSets();
        console.log('[submitTimesheetChain] prepareChangeSets:', prepared, 'prepareEquipChangeSets:', equipPrepared);

        // Build the seven day-dates for the selected week
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

        let saveFailed = 0;

        // ── Updates ──────────────────────────────────────────────────────────
        let update;
        while ((update = $page.functions.getNextUpdate()) !== null) {
          const entryId  = update.id;
          const body     = update.body;
          if (!entryId) { saveFailed++; continue; }

          const dayHours   = [1,2,3,4,5,6,7].map(i => Number(body['hours_day' + i]) || 0);
          const totalHours = dayHours.reduce((s, h) => s + h, 0);

          try {
            const patchResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchTimeEntry',
              uriParams: { id: entryId },
              body: { totalHours, billableHours: totalHours, entryType: body.hours_type || 'USAGE', status: 'DRAFT' }
            });
            if (!patchResp || !patchResp.ok) { saveFailed++; continue; }

            for (let i = 0; i < 7; i++) {
              const dayDate = dayDates[i];
              if (!dayDate) continue;
              await Actions.callRest(context, {
                endpoint: 'eqp-v1/createTimeEntryDay',
                body: { timeEntryId: entryId, workDate: dayDate + 'T00:00:00Z', hoursWorked: dayHours[i] }
              });
            }
          } catch (e) {
            console.error('[submitTimesheetChain] UPDATE error:', e);
            saveFailed++;
          }
        }

        // ── Creates ──────────────────────────────────────────────────────────
        let create;
        while ((create = $page.functions.getNextCreate()) !== null) {
          const body          = create.body;
          const requestLineId = Number(body.request_line_id);
          if (!requestLineId) continue;

          const dayHours   = [1,2,3,4,5,6,7].map(i => Number(body['hours_day' + i]) || 0);
          const totalHours = dayHours.reduce((s, h) => s + h, 0);

          try {
            const createResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createTimeEntry',
              body: {
                requestLineId,
                entryDate:     weekStart + 'T00:00:00Z',
                entryType:     body.hours_type || 'USAGE',
                totalHours,
                billableHours: totalHours,
                status:        'DRAFT'
              }
            });
            if (!createResp || !createResp.ok || !createResp.body) { saveFailed++; continue; }

            const newEntryId = createResp.body.id;
            for (let j = 0; j < 7; j++) {
              const dayDate = dayDates[j];
              if (!dayDate) continue;
              await Actions.callRest(context, {
                endpoint: 'eqp-v1/createTimeEntryDay',
                body: { timeEntryId: newEntryId, workDate: dayDate + 'T00:00:00Z', hoursWorked: dayHours[j] }
              });
            }
          } catch (e) {
            console.error('[submitTimesheetChain] CREATE error:', e);
            saveFailed++;
          }
        }

        // ── Equip Updates ─────────────────────────────────────────────────────
        let equipUpdate;
        while ((equipUpdate = $page.functions.getNextEquipUpdate()) !== null) {
          const entryId = equipUpdate.id;
          const body    = equipUpdate.body;
          if (!entryId) { saveFailed++; continue; }

          const dayHours   = [1,2,3,4,5,6,7].map(i => Number(body['hours_day' + i]) || 0);
          const totalHours = dayHours.reduce((s, h) => s + h, 0);

          try {
            const patchResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchTimeEntry',
              uriParams: { id: entryId },
              body: { totalHours, billableHours: totalHours, entryType: body.hours_type || 'USAGE', status: 'DRAFT' }
            });
            if (!patchResp || !patchResp.ok) { saveFailed++; continue; }

            for (let i = 0; i < 7; i++) {
              const dayDate = dayDates[i];
              if (!dayDate) continue;
              await Actions.callRest(context, {
                endpoint: 'eqp-v1/createTimeEntryDay',
                body: { timeEntryId: entryId, workDate: dayDate + 'T00:00:00Z', hoursWorked: dayHours[i] }
              });
            }
          } catch (e) {
            console.error('[submitTimesheetChain] EQUIP UPDATE error:', e);
            saveFailed++;
          }
        }

        // ── Equip Creates ─────────────────────────────────────────────────────
        let equipCreate;
        while ((equipCreate = $page.functions.getNextEquipCreate()) !== null) {
          const body          = equipCreate.body;
          const requestLineId = Number(body.request_line_id);
          if (!requestLineId) continue;

          const dayHours   = [1,2,3,4,5,6,7].map(i => Number(body['hours_day' + i]) || 0);
          const totalHours = dayHours.reduce((s, h) => s + h, 0);

          try {
            const createResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createTimeEntry',
              body: {
                requestLineId,
                entryDate:     weekStart + 'T00:00:00Z',
                entryType:     body.hours_type || 'USAGE',
                totalHours,
                billableHours: totalHours,
                status:        'DRAFT'
              }
            });
            if (!createResp || !createResp.ok || !createResp.body) { saveFailed++; continue; }

            const newEntryId = createResp.body.id;
            for (let j = 0; j < 7; j++) {
              const dayDate = dayDates[j];
              if (!dayDate) continue;
              await Actions.callRest(context, {
                endpoint: 'eqp-v1/createTimeEntryDay',
                body: { timeEntryId: newEntryId, workDate: dayDate + 'T00:00:00Z', hoursWorked: dayHours[j] }
              });
            }
          } catch (e) {
            console.error('[submitTimesheetChain] EQUIP CREATE error:', e);
            saveFailed++;
          }
        }

        // Clear change sets after save pass
        // Per-LINE expenditure types. Submit duplicates Phase 1 of the save rather
        // than delegating to it, so this step has to exist here too -- otherwise
        // "set the type, press Submit" saves the hours and silently drops the type.
        // Same contract as saveTimesheetChain Step 2e: writes EQR_REQUEST_LINE, one
        // PATCH per distinct line, and verifies against the echoed DTO rather than
        // trusting a 200, because the service tolerates unknown fields.
        try {
          const expChanges = $page.functions.prepareExpTypeChanges($page.variables);
          const expReqId   = Number($page.variables.internalRequestId) || null;
          if (expChanges.length && !expReqId) {
            saveFailed += expChanges.length;
            console.warn('[submitTimesheetChain] no internalRequestId - cannot save expenditure types');
          } else {
            // ONE batch PATCH for every changed line (all or nothing),
            // verified per line against the echoed DTO, in the order sent.
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
                saveFailed++;
                console.warn('[submitTimesheetChain] line %s expenditure type NOT saved (%s, echoed %o)',
                  ch.requestLineId, expBatch.message || 'batch ok', saved);
              }
            });
          }
        } catch (expErr) {
          saveFailed++;
          console.error('[submitTimesheetChain] expenditure type phase failed:', expErr && expErr.message);
        }

        $page.functions.clearChangeSets();
        $page.functions.clearEquipChangeSets();

        if (saveFailed > 0) {
          $page.variables.submitError  = saveFailed + ' row(s) failed to save. Submit aborted.';
          $page.variables.isSubmitting = false;
          return;
        }

        console.log('[submitTimesheetChain] Phase 1 complete — all rows saved successfully');

      } catch (saveErr) {
        console.error('[submitTimesheetChain] Fatal error during save phase:', saveErr);
        $page.variables.submitError  = 'Save failed before submit. Please retry.';
        $page.variables.isSubmitting = false;
        return;
      }

      // ─── PHASE 2: Submit all saved DRAFT entries ───────────────────────────
      console.log('[submitTimesheetChain] Phase 2: Submitting entries');

      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
        uriParams: {
          weekStartDate: weekStart     || 'ALL',
          requestNumber: requestNumber || 'ALL'
        }
      });

      if (!response || !response.ok || !response.body || !response.body.data) {
        $page.variables.submitError  = 'Failed to load timesheet rows for submission.';
        $page.variables.isSubmitting = false;
        return;
      }

      const rows = response.body.data || [];

      // Which equipment rows did the user pick? Selection is preserved per-equipment.
      // Saved rows are identified by their time-entry id; rows that were pre-populated
      // (from the create-request flow) have no entry id at click time, so they are
      // identified by their request_line_id and matched to the entry just created in
      // Phase 1 via the re-fetched data below.
      const selectedIds      = new Set($page.functions.getSelectedTimeEntryIds());
      const selectedLineIds  = new Set($page.functions.getSelectedRequestLineIds());

      const entryIds = rows
        .filter(r => r.eqrTimeEntryId
                  && (selectedIds.has(r.eqrTimeEntryId) || selectedLineIds.has(r.requestLineId))
                  && r.entryStatus !== 'SUBMITTED'
                  && r.entryStatus !== 'APPROVED')
        .map(r => r.eqrTimeEntryId);

      if (!entryIds.length) {
        $page.variables.submitError  = 'No DRAFT entries found to submit.';
        $page.variables.isSubmitting = false;
        return;
      }

      let submitFailed = 0;
      for (const id of entryIds) {
        const patchResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchTimeEntry',
          uriParams: { id },
          body: { status: 'SUBMITTED' }
        });
        if (!patchResp || !patchResp.ok) {
          console.warn('[submitTimesheetChain] Failed to submit entry id:', id);
          submitFailed++;
        }
      }

      $page.variables.isSubmitting = false;

      if (submitFailed > 0) {
        $page.variables.submitError = submitFailed + ' entries failed to submit. Please retry.';
      } else {
        $page.functions.clearSelection($page.variables);
        // Refresh grid to reflect SUBMITTED status
        const refreshResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
          uriParams: {
            weekStartDate: weekStart     || 'ALL',
            requestNumber: requestNumber || 'ALL'
          }
        });
        if (refreshResp && refreshResp.ok && refreshResp.body && refreshResp.body.data) {
          // Non-rentable lines never appear as timesheet rows (they post cost directly).
          // Exclude only confirmed non-rentables; keep rentable + unflagged rows.
          const refreshedRows = refreshResp.body.data.filter(r => r.isRentable !== 'N');
          const allApproved  = refreshedRows.every(r => r.entryStatus === 'APPROVED');
          const anyDraft     = refreshedRows.some(r => r.entryStatus === 'DRAFT');
          const anySubmitted = refreshedRows.some(r => r.entryStatus === 'SUBMITTED');
          $page.variables.headerStatus = allApproved ? 'APPROVED'
            : anySubmitted               ? 'SUBMITTED'
            : anyDraft                   ? 'DRAFT'
            : 'SUBMITTED';

          const lines = timesheetRows.toGridRows(refreshedRows);
          const provider = $page.functions.initProviderFromLines(lines, weekStart);
          $page.variables.dataGridProvider = provider;
        }

        await Actions.fireNotificationEvent(context, {
          summary: 'Timesheet Submitted',
          message: 'Your timesheet has been saved and submitted successfully.',
          type: 'confirmation',
          displayMode: 'transient'
        });
      }
    }
  }

  return submitTimesheetChain;
});
