define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
  'resources/js/shellBus',
], (ActionChain, Actions, lineBody, cu, bus) => {
  'use strict';

  // New EquipRite's Time entry saveTimesheetChain: the same calls, bodies, order and guards. Next differs only in
  // where a message shows (the shell's toast for New's notification) and in reading the requests on site again after
  // the week is read back, so each request's state follows what was written. tests/next-usage.test.js runs both chains
  // against one fake backend and requires the same calls.
  //
  // ── New's description ──
  // Save, and Submit for approval. The old timesheet-detail saveTimesheetChain and submitTimesheetChain, call for
  // call (their equipment-grid loops were for a second grid that page never rendered, so they always ran empty):
  //
  //   for each changed row with a time entry   PATCH patchTimeEntry {totalHours, billableHours, entryType, status
  //                                            DRAFT}, then createTimeEntryDay for each of the 7 days (an upsert
  //                                            keyed on entry + date)
  //   for each row with no time entry          POST createTimeEntry {requestLineId, entryDate = week start,
  //                                            entryType, totalHours, billableHours, status DRAFT}, then the 7 days.
  //                                            Save skips a new row with no hours and says so; Submit creates it, as
  //                                            the old submit did
  //   expenditure types                        ONE patchRequestLinesBatch for the changed lines, checked line by line
  //                                            against the echo (requestLineBody.updateLines)
  //   re-read the week                         so new rows carry their entry id and are never created twice
  //   Submit only: re-read, then PATCH {status: SUBMITTED} for every ticked row's DRAFT / REJECTED entry
  //
  // Submit first checks, as the old one did: a rate type on every ticked row, the settings loaded, and under Fusion
  // PPM rates an expenditure type on every line with hours. Nothing is sent while the grid has a bad box.
  const DAYS = [0, 1, 2, 3, 4, 5, 6];

  class saveTimesheetChain extends ActionChain {
    async run(context, { mode }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const submit = mode === 'submit';
      // Set before any await, so a double click cannot save twice.
      if (v.isSaving || v.readOnly) {
        return;
      }
      v.isSaving = true;
      v.saveMode = submit ? 'submit' : 'save';
      v.saveError = '';
      try {
        const requestNumber = v.requestNumber;
        const weekStart = v.weekStart;
        if (!requestNumber || !weekStart) {
          v.saveError = 'Missing request or week information.';
          return;
        }
        const problems = fns.problems(v.rows, v.edits, v.weekDays, v.expTypeList);
        if (problems.length) {
          v.saveError = (problems.length === 1 ? '1 problem: ' : problems.length + ' problems: ') + problems.join(' ');
          return;
        }
        const pickedKeys = Object.keys(v.picked || {}).filter((k) => v.picked[k]);
        if (submit) {
          if (!pickedKeys.length) {
            v.saveError = 'Tick the rows to submit.';
            return;
          }
          const rateTypeError = fns.validateRateTypes(v.rows, v.edits, pickedKeys);
          if (rateTypeError) {
            v.saveError = rateTypeError;
            bus.toast(rateTypeError, 'error');
            return;
          }
          if (!$application.variables.flagsLoaded) {
            v.saveError = 'Settings are still loading. Please try again in a moment.';
            return;
          }
          if ($application.functions.isFeatureEnabled($application.variables.featureFlags, $application.variables.flagsLoaded, 'PPM_RATES_ENABLED')) {
            const expError = fns.validateExpenditureTypes(v.rows, v.edits, v.expTypeList);
            if (expError) {
              v.saveError = expError;
              bus.toast(expError, 'error');
              return;
            }
          }
        }

        // Picked rows, read BEFORE the save re-reads the week (a new row only has its line id until then).
        const pickedRows = (v.rows || []).filter((r) => pickedKeys.indexOf(r.key) >= 0);
        const pickedEntryIds = pickedRows.map((r) => r.entryId).filter(Boolean);
        const pickedLineIds = pickedRows.map((r) => r.lineId).filter(Boolean);

        const result = await this.saveAll(context, weekStart, !submit);
        if (submit && result.failed > 0) {
          v.saveError = result.failed + ' row(s) failed to save. Submit aborted.';
          await this.reload(context, requestNumber, weekStart);
          return;
        }
        if (!submit) {
          await this.reload(context, requestNumber, weekStart);
          if (result.expFailed > 0 && result.failed === 0) {
            v.saveError = result.expFailed + ' equipment expenditure type(s) failed to save. The hours were saved.';
          } else if (result.failed > 0) {
            v.saveError = result.failed + ' row(s) failed to save. The others were saved.';
          } else if (result.skipped > 0) {
            v.saveError = result.skipped + ' new row(s) had no hours and were not saved. '
              + 'Enter hours on the day(s) the row applies to, then save again.';
          } else {
            bus.toast('Week of ' + fns.weekLabel(weekStart) + ' saved as a draft.', 'info');
          }
          return;
        }

        // ── Phase 2: submit the saved DRAFT entries of the ticked rows ──
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
          uriParams: { weekStartDate: weekStart || 'ALL', requestNumber: requestNumber || 'ALL' },
        });
        if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) {
          v.saveError = 'Failed to load timesheet rows for submission.';
          return;
        }
        const ids = fns.submitIds(res.body.data, pickedEntryIds, pickedLineIds);
        if (!ids.length) {
          v.saveError = 'No DRAFT entries found to submit.';
          await this.reload(context, requestNumber, weekStart);
          return;
        }
        let submitFailed = 0;
        for (const id of ids) {
          const p = await Actions.callRest(context, { endpoint: 'eqp-v1/patchTimeEntry', uriParams: { id }, body: { status: 'SUBMITTED' } });
          if (!p || !p.ok) {
            console.warn('[saveTimesheetChain] failed to submit entry', id);
            submitFailed++;
          }
        }
        await this.reload(context, requestNumber, weekStart);
        if (submitFailed > 0) {
          v.saveError = submitFailed + ' entries failed to submit. Please retry.';
          return;
        }
        bus.toast(ids.length + (ids.length === 1 ? ' row' : ' rows') + ' of the week of ' + fns.weekLabel(weekStart) + ' sent for approval.', 'info');
      } catch (e) {
        console.error('[saveTimesheetChain] fatal', e);
        v.saveError = submit ? 'Save failed before submit. Please retry.' : 'A fatal error occurred during save.';
      } finally {
        try { v.isSaving = false; v.saveMode = ''; } catch (e2) { /* page already left */ }
      }
    }

    /** Phase 1, shared by Save and Submit. Returns { failed, skipped, expFailed }. */
    async saveAll(context, weekStart, skipEmpty) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const dayDates = (v.weekDays || []).map((d) => d.iso);
      const { updates, creates } = fns.changeSet(v.rows, v.edits);
      let failed = 0;
      let skipped = 0;
      let expFailed = 0;
      const hoursOf = (body) => DAYS.map((i) => Number(body['hours_day' + (i + 1)]) || 0);
      const writeDays = async (entryId, dayHours) => {
        for (let i = 0; i < 7; i++) {
          if (!dayDates[i]) continue;
          await Actions.callRest(context, {
            endpoint: 'eqp-v1/createTimeEntryDay',
            body: { timeEntryId: entryId, workDate: dayDates[i] + 'T00:00:00Z', hoursWorked: dayHours[i] },
          });
        }
      };

      for (const u of updates) {
        if (!u.id) { failed++; continue; }
        const dayHours = hoursOf(u.body);
        const totalHours = dayHours.reduce((s, h) => s + h, 0);
        try {
          const p = await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchTimeEntry',
            uriParams: { id: u.id },
            body: { totalHours, billableHours: totalHours, entryType: u.body.hours_type || 'USAGE', status: 'DRAFT' },
          });
          if (!p || !p.ok) { failed++; continue; }
          await writeDays(u.id, dayHours);
        } catch (e) {
          console.error('[saveTimesheetChain] update failed', e);
          failed++;
        }
      }

      for (const c of creates) {
        const requestLineId = Number(c.body.request_line_id);
        if (!requestLineId) continue;
        const dayHours = hoursOf(c.body);
        const totalHours = dayHours.reduce((s, h) => s + h, 0);
        if (skipEmpty && totalHours <= 0) { skipped++; continue; }
        try {
          const r = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createTimeEntry',
            body: {
              requestLineId,
              entryDate: weekStart + 'T00:00:00Z',
              entryType: c.body.hours_type || 'USAGE',
              totalHours,
              billableHours: totalHours,
              status: 'DRAFT',
            },
          });
          if (!r || !r.ok || !r.body) { failed++; continue; }
          await writeDays(r.body.id, dayHours);
        } catch (e) {
          console.error('[saveTimesheetChain] create failed', e);
          failed++;
        }
      }

      const expChanges = fns.expTypeChanges(v.rows, v.edits, v.expTypeList);
      const expReqId = Number(v.internalRequestId) || null;
      if (expChanges.length && !expReqId) {
        expFailed = expChanges.length;
      } else if (expChanges.length) {
        const batch = await lineBody.updateLines(context, Actions, {
          requestId: expReqId,
          headers: cu.auditHeaders(context),
          updates: expChanges.map((ch) => ({ id: Number(ch.requestLineId), expenditureType: ch.expenditureType })),
        });
        expChanges.forEach((ch, i) => {
          const saved = batch.ok && batch.lines[i] && batch.lines[i].expenditureType;
          if (saved !== ch.expenditureType) expFailed++;
        });
      }
      // Submit treats an expenditure type that did not save as a failed row, as the old submit did.
      return { failed: failed + (skipEmpty ? 0 : expFailed), skipped, expFailed };
    }

    async reload(context, requestNumber, weekStart) {
      await Actions.callChain(context, { chain: 'loadWeekChain', params: { requestNumber, weekStart, initial: false, keepMessages: true } });
      // Next: the requests on site, read again.
      await Actions.callChain(context, { chain: 'loadQueueChain' });
    }
  }

  return saveTimesheetChain;
});
