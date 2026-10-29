define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Save schedule: the old create-rate-schedule-page-chains/saveScheduleChain.js, call for call and body for body:
  //   1 validation (name and start date), 2 the header body (code made from the name when empty; calcBasis /
  //   calcMethod deliberately NOT on the header), 3 PUT /rate-schedules/{id} or POST /rate-schedules,
  //   4 every line in turn, PUT /rate-period-lines/{id} or POST /rate-period-lines, with the full body (PUT is a
  //   destructive full merge), the period coerced to what its method / basis can carry, new lines numbered above
  //   the highest periodSeq; a failed line is reported and the next one still saved, 5 the success notice.
  // Changes: the schedule comes from this page's selection (selectedId) and lines (the old equipmentLines); FULL
  // access and a second click are checked first; afterwards the list and this schedule are read again instead of
  // going back to the old list page.
  class saveScheduleChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RATE_SCHEDULE') !== 'FULL') return;
      if ($page.variables.saving) return;
      $page.variables.saving = true;
      try {
        await this.save(context);
      } finally {
        $page.variables.saving = false;
      }
    }

    async save(context) {
      const { $page } = context;
      const formData = $page.variables.formData;
      const scheduleId = $page.variables.selectedId === 'new' ? null : Number($page.variables.selectedId) || null;

      if (!formData.scheduleName || !formData.startDate) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Validation Error',
          message: 'Schedule Name and Start Date are required fields.',
          displayMode: 'transient',
          type: 'warning',
        });
        return;
      }

      // ── 1. Build schedule header body ──────────────────────────────
      const autoCode = formData.scheduleCode ||
        'RS-' + (formData.scheduleName || 'SCHEDULE')
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .substring(0, 30);

      const scheduleBody = {
        scheduleName:     formData.scheduleName,
        scheduleCode:     autoCode,
        description:      formData.description,
        // calcBasis / calcMethod are LINE-LEVEL (set per rate period line), not on
        // the schedule header. Sending them here wrote stale "ghost" header values
        // that the cost engine must ignore — so they are intentionally omitted.
        currencyCode:     formData.currency,
        effectiveFrom:    formData.startDate
          ? formData.startDate + 'T00:00:00Z'
          : new Date().toISOString().split('T')[0] + 'T00:00:00Z',
        effectiveTo:      formData.endDate ? formData.endDate + 'T00:00:00Z' : null,
        isActiveFlag:     formData.activeStatus ? 'Y' : 'N',
        equipmentClassId: null,
        customerRefId:    formData.customerId  ? Number(formData.customerId)  : null,
        projectRefId:     formData.projectId   ? Number(formData.projectId)   : null,
        // The *Name fields are denormalized copies the Rate Management list reads
        // directly, so they must never outlive their id. Clearing a LOV nulls the
        // bound id but does not always deliver an itemContext to null the name —
        // gate each name on its id so a cleared field can't save a stale label.
        projectName:      formData.projectId   ? (formData.projectName || null) : null,
        taskRefId:        formData.taskId      ? Number(formData.taskId)      : null,
        taskName:         formData.taskId      ? (formData.taskName    || null) : null,
        // yardOrgId stores the mapping row's invOrgId — the FUSION org id, the
        // same key EQR_V_YARD_STOCK / EQR_V_YARD_UTILIZATION / EQR_V_ONHAND_QTY
        // join on. It used to store the local EQR_INV_ORG PK instead, which is
        // an id space nothing in the database reads. YARD_ORG_ID has no FK and
        // no check constraint, and no view or package uses it for behaviour
        // (the cost engine never reads it), so the switch is inert for pricing.
        yardOrgId:        formData.yardOrgId   ? Number(formData.yardOrgId)   : null,
        rateType:         'STANDARD',
        agreementHeaderId: null,
      };

      // ── 2. Create or update the schedule header ─────────────────────
      let schedResp;
      if (scheduleId) {
        schedResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/updateRateSchedule',
          uriParams: { id: Number(scheduleId) },
          body: scheduleBody,
        });
      } else {
        schedResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createRateSchedule',
          body: scheduleBody,
        });
      }

      if (!schedResp.ok) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Error',
          message: 'Failed to save rate schedule: ' + schedResp.status,
          displayMode: 'transient',
          type: 'error',
        });
        return;
      }

      const savedId = schedResp.body.id;

      // ── 3. Save lines sequentially ──────────────────────────────────
      const UOM_MAP = {
        'HOURLY': 'HOUR', 'HOUR': 'HOUR',
        'DAILY':  'DAY',  'DAY':  'DAY',
        'WEEKLY': 'WEEK', 'WEEK': 'WEEK',
        'MONTHLY':'MONTH','MONTH':'MONTH',
        'FLAT':   'FLAT',
      };

      const lines = $page.variables.lines || [];

      // PERIOD_SEQ is unique per schedule (UK_EQR_RATE_PL_SEQ). The grid is now
      // sorted Class -> Subclass -> Equipment, so a brand-new line can sit at any
      // position — its row index is no longer a safe sequence. Hand new lines
      // numbers above the highest seq already in use instead.
      let nextPeriodSeq = lines.reduce(
        (max, l) => (l.periodSeq != null && Number(l.periodSeq) > max ? Number(l.periodSeq) : max),
        0
      );

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Last line of defence on the period/basis pairing. The drawer greys the
        // illegal options out and the grid rejects them, but Calc Method is
        // grid-editable while Calc Basis is not a column at all — so a row can
        // still arrive here as UTILIZED_DURATION/HOURLY carrying a day-based
        // period (divides by 7 what the engine multiplies in hours), or as
        // COMPLETE_PERIOD carrying HOURLY (a label that can never be true, since
        // that branch bills whole calendar days). Coerce rather than reject:
        // Save must not fail on a row the user cannot see the problem in.
        const period = $page.functions.coercePeriod(line.period, line.calcMethod, line.calcBasis);

        const uom = UOM_MAP[period] || 'HOUR';
        const periodSeq = line.periodSeq != null ? line.periodSeq : ++nextPeriodSeq;

        const lineBody = {
          rateScheduleId:      savedId,
          periodType:          period,
          costRate:            Number(line.costRate) || 0,
          billRate:            Number(line.billRate) || 0,
          rateAmount:          Number(line.billRate) || 0,
          rateUom:             uom,
          rateType:            line.rateType,
          // CALC_BASIS is NOT NULL + CHECK IN ('HOURLY','DAILY','WEEKLY','MONTHLY')
          // in the DB, so null is rejected (400 data-integrity-violation).
          // COMPLETE_PERIOD ignores the basis in the cost engine, so we derive a
          // valid value from the period rather than blindly sending HOURLY.
          // UTILIZED_DURATION carries the user-picked basis (HOURLY default).
          // UTILIZED_DURATION branch: EQR_RESOLVE_RATE step 4 only knows HOURLY
          // (sum timesheet hours) and DAILY (count worked days). A basis of
          // WEEKLY or MONTHLY falls through to its ELSE and returns sentinel
          // -998, which clamps to $0 — so the line silently prices at nothing.
          // COMPLETE_PERIOD lines legitimately carry WEEKLY/MONTHLY (the engine
          // ignores basis there), and the Tier column can now be edited in the
          // grid without a matching Calc Basis field, so clamp on the way out.
          calcBasis:           (line.calcMethod || 'UTILIZED_DURATION') === 'COMPLETE_PERIOD'
                                 ? ({ HOURLY: 'HOURLY', DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' }[period] || 'DAILY')
                                 : (['HOURLY', 'DAILY'].indexOf(line.calcBasis) >= 0 ? line.calcBasis : 'DAILY'),
          calcMethod:          line.calcMethod || 'UTILIZED_DURATION',
          location:            line.location || null,
          effectiveFrom:       line.startDate ? line.startDate + 'T00:00:00Z' : null,
          effectiveTo:         line.endDate ? line.endDate + 'T00:00:00Z' : null,
          // Floored: fromUnit is an Integer on both the entity and the DTO, while
          // the DB column is an unconstrained NUMBER — so a fractional threshold
          // would be truncated somewhere in the Java layer rather than rejected.
          // Do it here, visibly, in one place. The grid editor already floors;
          // this covers the drawer too. A customer needing a fractional period
          // (a 7.5-hour week) sets the DIVISOR override instead, which is a
          // BigDecimal end to end and round-trips 37.5 intact.
          fromUnit:            Math.max(0, Math.floor(Number(line.threshold) || 0)),
          toUnit:              null,
          // Authoring provenance for the period-total model. The engine never
          // reads these — it bills days x costRate — they exist so reopening a
          // schedule shows the total that was actually contracted rather than a
          // figure re-inferred from a threshold that may have moved since.
          //
          // These MUST be sent on every save: PUT /rate-period-lines/{id} is a
          // destructive full merge (RatePeriodLineMapperImpl runs unconditional
          // setters, no null guards), so an omitted field is written as NULL.
          // Same reason fromUnit/rateAmount/periodType/calcBasis/calcMethod are
          // all present above — omitting any of those raises ORA-01407.
          periodAmount:        line.periodAmount != null ? Number(line.periodAmount) : null,
          // Always NULL — days-per-period is derived from periodType now, so the
          // column has nothing to store. Because PUT is a destructive full merge
          // this actively CLEARS the stale threshold-derived divisors (5, 25, 26)
          // that every existing row still carries, so re-saving a schedule
          // cleans up its own lines.
          periodDivisor:       null,
          periodSeq:           periodSeq,
          createdBy:           'VBCS',
          lastUpdatedBy:       'VBCS',
          equipmentClassId:    line.classId    ? Number(line.classId)    : null,
          equipmentSubclassId: line.subclassId ? Number(line.subclassId) : null,
          equipmentName:       line.equipmentName || null,
        };

        let lineResp;
        if (line.id != null) {
          lineResp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/updateRatePeriodLine',
            uriParams: { id: line.id },
            body: lineBody,
          });
        } else {
          lineResp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createRatePeriodLine',
            body: lineBody,
          });
        }

        if (!lineResp.ok) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Warning',
            message: 'Failed to save line ' + (i + 1) + ': ' + lineResp.status,
            displayMode: 'transient',
            type: 'warning',
          });
        }
      }

      // ── 4. Confirm and navigate ─────────────────────────────────────
      await Actions.fireNotificationEvent(context, {
        summary: 'Success',
        message: 'Rate schedule saved successfully.',
        displayMode: 'transient',
        type: 'confirmation',
      });

      $page.variables.dirty = false;
      await Actions.callChain(context, { chain: 'loadSchedulesChain' });
      await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: savedId, confirmed: true } });
    }
  }

  return saveScheduleChain;
});
