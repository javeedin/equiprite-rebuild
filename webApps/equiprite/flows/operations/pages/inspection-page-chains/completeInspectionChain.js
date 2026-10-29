define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/requestLineBody',
], (ActionChain, Actions, cu, lineBody) => {
  'use strict';

  // Complete inspection. No old chain to carry over (Old EquipRite has no inspection screen); the calls are the
  // inspection endpoints in services/eqp-v1, in this order:
  //   1 POST  inspections                 the inspection, IN_PROGRESS (skipped when continuing an open one)
  //   2 POST  inspection-responses        one per answered question (PATCH when the answer is already saved)
  //   3 POST  inspection-defects          one per defect, then its photo:
  //     POST  commonService documents     multipart, on entity EQR_INSPECTION_DEFECT / the defect id
  //   4 PATCH inspections/{id}            COMPLETED, overallResult PASS / CONDITIONAL / FAIL
  //   5 PATCH equipment-requests/{id}/lines/batch   yard ship-out only: EQP_INSPECTION_COMPLETE or INSPECTION_FAILED
  // A failure stops the save and says what is already saved. What each step wrote is kept in `saved`, so the next
  // click continues where it stopped instead of creating a second inspection or duplicate answers.
  // A failed unit's maintenance work order (INT-13) has no endpoint in services/: it is raised in Oracle Maintenance.
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
      if (status) {
        const r = await lineBody.updateLines(context, Actions, {
          requestId: Number(line.requestId),
          headers,
          updates: [{ id: Number(line.lineId), lineStatus: status }],
          labels: [fns.unitText(line)],
        });
        if (!r.ok) {
          statusError = r.message;
        }
      }

      // 6 hand over to the next unit in the queue
      const next = fns.nextInQueue(fns.queue(v.lines, v.matrix, v.mode, v.point, v.scope), line.lineId);
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
        lineStatus: status && !statusError ? status : '',
        pendingStatus: statusError ? status : '',
        statusError,
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
      v.step = 0;
      v.notes = '';
      v.ack = false;
      await Actions.fireNotificationEvent(context, {
        summary: 'Inspection completed',
        message: unit + ': ' + text + '.',
        type: result.code === 'FAIL' ? 'warning' : 'confirmation',
        displayMode: 'transient',
      });
    }
  }

  return completeInspectionChain;
});
