define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rateRules',
  'resources/js/shellBus',
], (ActionChain, Actions, R, bus) => {
  'use strict';

  // Save schedule: New EquipRite's saveScheduleChain (the old create-rate-schedule saveScheduleChain), call for call
  // and body for body:
  //   0 FULL access to EQR_RATE_SCHEDULE and not already saving
  //   1 validation: name and start date
  //   2 the header body (rateRules.scheduleBody: the code made from the name when empty; calcBasis / calcMethod NOT
  //     on the header), PUT /rate-schedules/{id} or POST /rate-schedules
  //   3 every line in turn, PUT /rate-period-lines/{id} or POST /rate-period-lines, with the full body (rateRules.
  //     lineBody: PUT is a destructive full merge; the period coerced to what its method / basis can carry); new lines
  //     numbered above the highest periodSeq; a failed line is said and the next one still saved
  //   4 the list and this schedule are read again.
  // What happened stays on the page in words, and a toast says it too.
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
      const v = $page.variables;
      const formData = v.formData;
      const scheduleId = v.selectedId === 'new' ? null : Number(v.selectedId) || null;

      if (!formData.scheduleName || !formData.startDate) {
        v.headerOpen = true;
        this.say(v, 'Not saved: a schedule needs a name and a start date.', 'error');
        return;
      }

      // ── 1. the header ─────────────────────────────────────────────
      const scheduleBody = R.scheduleBody(formData);
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

      if (!schedResp || !schedResp.ok) {
        this.say(v, 'The rate schedule could not be saved (HTTP ' + (schedResp && schedResp.status) + '). Nothing was written.', 'error');
        return;
      }

      const savedId = (schedResp.body && schedResp.body.id) || scheduleId;

      // ── 2. the lines, one after another ───────────────────────────
      const lines = v.lines || [];
      let nextPeriodSeq = R.maxPeriodSeq(lines);
      const failed = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const periodSeq = line.periodSeq != null ? line.periodSeq : ++nextPeriodSeq;
        const lineBody = R.lineBody(line, savedId, periodSeq);

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

        if (!lineResp || !lineResp.ok) {
          failed.push('line ' + (i + 1) + ' (' + R.groupTitle(line) + ', ' + R.periodLabel(line.period) + ': HTTP ' + (lineResp && lineResp.status) + ')');
        }
      }

      // ── 3. read it back ───────────────────────────────────────────
      // (Page variables read live: what was saved is counted before the schedule is read again.)
      const name = String(formData.scheduleName);
      const count = lines.length;
      v.dirty = false;
      await Actions.callChain(context, { chain: 'loadSchedulesChain' });
      await Actions.callChain(context, { chain: 'applyChain' });
      await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: savedId, confirmed: true } });
      if (failed.length) {
        this.say(v, name + ' was saved, but ' + failed.length + (failed.length === 1 ? ' rate' : ' rates') + ' could not be: ' + failed.join('; ') + '.', 'error');
      } else {
        this.say(v, name + ' was saved: the details and ' + (count === 1 ? 'its rate' : 'all ' + count + ' rates') + '.', 'info');
      }
    }

    say(v, message, tone) {
      v.saveNote = message;
      v.saveTone = tone;
      bus.toast(message, tone);
    }
  }

  return saveScheduleChain;
});
