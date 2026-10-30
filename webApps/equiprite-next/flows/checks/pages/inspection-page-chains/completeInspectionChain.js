define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/requestLineBody',
  'resources/js/requestData',
  'resources/js/shellBus',
], (ActionChain, Actions, cu, lineBody, requestData, bus) => {
  'use strict';

  // Complete inspection: New EquipRite's completeInspectionChain, the same calls in the same order with the same
  // guards (services/eqp-v1 and commonService):
  //   1 POST  inspections                 the inspection, IN_PROGRESS (skipped when continuing an open one)
  //   2 POST  inspection-responses        one per answered question (PATCH when the answer is already saved)
  //   3 POST  inspection-defects          one per defect, then its photo:
  //     POST  commonService documents     multipart, on entity EQR_INSPECTION_DEFECT / the defect id
  //   4 PATCH inspections/{id}            COMPLETED, overallResult PASS / CONDITIONAL / FAIL
  //   5 PATCH equipment-requests/{id}/lines/batch   yard ship-out only: EQP_INSPECTION_COMPLETE or INSPECTION_FAILED
  // A failure stops the save and says what is already saved; what each step wrote is kept in `saved`, so the next click
  // continues where it stopped instead of creating a second inspection or duplicate answers. Then the result is read
  // back (GET inspections?requestLineId) and the shared request data is refreshed for the other tabs.
  // A failed unit's maintenance work order (INT-13) is Fusion and has no endpoint in services/: it is raised in Oracle
  // Maintenance, and the screen says so instead of pretending.
  async function call(context, opts) {
    try {
      const res = await Actions.callRest(context, opts);
      return res || { ok: false, status: 0 };
    } catch (e) {
      console.error('[completeInspectionChain] ' + opts.endpoint + ' threw', e);
      return { ok: false, status: 0, body: { message: String((e && e.message) || e) } };
    }
  }
  const http = (res) => (res && res.status ? 'HTTP ' + res.status : 'no answer');

  class completeInspectionChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      // Checked and set before any await, so a double tap cannot start two saves.
      if ($page.variables.isSaving) {
        return;
      }
      $page.variables.isSaving = true;
      try {
        await this.save(context);
      } catch (e) {
        console.error('[completeInspectionChain] unexpected error', e);
        $page.variables.saveError = 'Saving was interrupted (' + ((e && e.message) || e) + '). What was saved is kept: try again.';
      } finally {
        try { $page.variables.isSaving = false; } catch (e2) { /* page already left */ }
      }
    }

    async save(context) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const line = v.current;
      if (!line) {
        return;
      }
      const items = v.checklist || [];
      const answers = v.answers || {};
      const defects = v.defects || [];
      v.saveError = '';
      const blocked = fns.blockers(items, answers, defects, v.ack);
      if (blocked.length) {
        v.blocked = blocked;
        return;
      }
      v.blocked = [];
      const result = fns.result(items, answers, defects);
      const headers = cu.auditHeaders(context);
      const nowIso = new Date().toISOString();
      const saved = {
        inspectionId: (v.saved || {}).inspectionId || null,
        responses: Object.assign({}, (v.saved || {}).responses || {}),
        defects: Object.assign({}, (v.saved || {}).defects || {}),
        photos: Object.assign({}, (v.saved || {}).photos || {}),
      };
      const keep = () => {
        v.saved = {
          inspectionId: saved.inspectionId,
          responses: Object.assign({}, saved.responses),
          defects: Object.assign({}, saved.defects),
          photos: Object.assign({}, saved.photos),
        };
      };

      // 1 the inspection
      if (!saved.inspectionId) {
        const res = await call(context, {
          endpoint: 'eqp-v1/createInspection',
          headers,
          body: fns.inspectionBody(line, line.point, nowIso),
        });
        const id = res.ok && res.body ? res.body.id : null;
        if (id == null) {
          v.saveError = 'The inspection could not be started (' + http(res) + '). Nothing was saved; try again.';
          return;
        }
        saved.inspectionId = Number(id);
        keep();
      }
      const inspectionId = saved.inspectionId;

      // 2 the answers
      const answered = items.filter((it) => fns.answerState(it, answers[it.id]) !== 'open');
      let count = 0;
      for (const it of answered) {
        const body = fns.responseBody(inspectionId, it, answers[it.id]);
        const prev = saved.responses[it.id];
        if (prev && prev.value === body.responseValue && (prev.note || '') === (body.notes || '')) {
          count++;
          continue;
        }
        const res = prev && prev.id != null
          ? await call(context, { endpoint: 'eqp-v1/patchInspectionResponse', uriParams: { id: Number(prev.id) }, headers, body })
          : await call(context, { endpoint: 'eqp-v1/createInspectionResponse', headers, body });
        if (!res.ok) {
          v.saveError = 'The answer to "' + it.text + '" could not be saved (' + http(res) + '). ' + count + ' of '
            + answered.length + ' answers are saved; try again to save the rest.';
          return;
        }
        saved.responses[it.id] = {
          id: prev && prev.id != null ? prev.id : (res.body && res.body.id != null ? res.body.id : null),
          value: body.responseValue,
          note: body.notes || '',
        };
        count++;
        keep();
      }

      // 3 the defects, each with its photo
      for (const d of defects) {
        if (d.saved) {
          continue;
        }
        const name = d.description || 'a defect';
        if (!saved.defects[d.key]) {
          const res = await call(context, {
            endpoint: 'eqp-v1/createInspectionDefect',
            headers,
            body: fns.defectBody(inspectionId, d),
          });
          const id = res.ok && res.body ? res.body.id : null;
          if (id == null) {
            v.saveError = 'The defect "' + name + '" could not be saved (' + http(res) + '). The answers are saved; try again.';
            return;
          }
          saved.defects[d.key] = Number(id);
          keep();
        }
        if (!saved.photos[d.key]) {
          const file = fns.heldFile(d.key);
          if (!file) {
            v.saveError = 'The photo of "' + name + '" is no longer here; take it again.';
            return;
          }
          const meta = fns.photoMetadata(inspectionId, saved.defects[d.key], file.name, d.description, Date.now());
          const res = await call(context, {
            endpoint: 'commonService/uploadCommonDocument',
            body: { metadata: new Blob([JSON.stringify(meta)], { type: 'application/json' }), file },
            contentType: 'multipart/form-data',
          });
          if (!res.ok) {
            v.saveError = 'The photo of "' + name + '" did not upload (' + http(res) + '). The defect is saved; try again to upload the photo.';
            return;
          }
          saved.photos[d.key] = (res.body && (res.body.doc_id || res.body.id)) || true;
          keep();
        }
      }

      // 4 completed, with the result
      const actor = cu.displayName(context) || cu.auditActor(context);
      const done = await call(context, {
        endpoint: 'eqp-v1/patchInspection',
        uriParams: { id: inspectionId },
        headers,
        body: fns.completionBody(result.code, v.notes, v.ack, actor, nowIso),
      });
      if (!done.ok) {
        v.saveError = 'The inspection could not be completed (' + http(done) + '). Everything else is saved; try again.';
        return;
      }

      // 5 the line status (yard ship-out only)
      const status = fns.lineStatusAfter(line.point, result.code, v.ack);
      let statusError = '';
      let statusNow = '';
      if (status) {
        const r = await lineBody.updateLines(context, Actions, {
          requestId: Number(line.requestId),
          headers,
          updates: [{ id: Number(line.lineId), lineStatus: status }],
          labels: [fns.unitText(line)],
        });
        if (!r.ok) {
          statusError = r.message;
        } else {
          statusNow = String(((r.lines || [])[0] || {}).lineStatus || status).toUpperCase();
        }
      }

      // read back: what is stored for this line now
      let recorded = null;
      const back = await call(context, { endpoint: 'eqp-v1/getInspections', uriParams: { requestLineId: Number(line.lineId) } });
      if (back.ok) {
        const rows = Array.isArray(back.body) ? back.body : ((back.body && Array.isArray(back.body.data)) ? back.body.data : []);
        const mine = rows.find((x) => x && Number(x.id) === Number(inspectionId));
        if (mine) {
          recorded = {
            id: Number(mine.id),
            status: String(mine.inspectionStatus || '').toUpperCase(),
            result: String(mine.overallResult || '').toUpperCase(),
            date: String(mine.completedDate || '').slice(0, 10),
          };
        }
      }
      requestData.invalidate();

      // 6 hand over to the next unit in the queue as shown
      const next = fns.nextInQueue(v.shown, line.lineId);
      const unit = fns.unitText(line);
      const text = fns.resultText(result.code, line.point, true);
      fns.dropFiles();
      v.lines = (v.lines || []).filter((l) => String(l.lineId) !== String(line.lineId));
      v.done = {
        unit,
        code: result.code,
        text,
        point: line.point,
        pointLabel: line.pointLabel,
        inspectionId,
        lineStatus: status && !statusError ? statusNow : '',
        pendingStatus: statusError ? status : '',
        statusError,
        recorded,
        line: {
          lineId: line.lineId, requestId: line.requestId, requestNumber: line.requestNumber,
          equipmentMasterId: line.equipmentMasterId, equipmentName: line.equipmentName,
        },
        nextLineId: next ? String(next.lineId) : '',
        nextUnit: next ? fns.unitText(next) : '',
      };
      v.current = null;
      v.saved = {};
      v.answers = {};
      v.defects = [];
      v.checklist = [];
      v.history = [];
      v.notes = '';
      v.ack = false;
      await Actions.callChain(context, { chain: 'applyChain' });
      bus.toast(unit + ': ' + text + '.', result.code === 'FAIL' ? 'warning' : 'info');
    }
  }

  return completeInspectionChain;
});
