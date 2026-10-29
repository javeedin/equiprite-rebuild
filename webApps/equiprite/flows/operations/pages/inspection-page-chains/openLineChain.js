define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens a line for inspection (empty lineId closes it). Loads, side by side:
  //   inspection-checklists?classId   the line's class checklist, narrowed to its subclass and the point
  //   inspections?requestLineId       earlier inspections of the line; one at this point that was never
  //                                   completed (an interrupted save) is CONTINUED: its id, answers and
  //                                   defects are taken over, so finishing it does not create a second one.
  // A token guards against a slow answer for a line the inspector has already left.
  async function get(context, endpoint, uriParams) {
    try {
      const res = await Actions.callRest(context, { endpoint, uriParams });
      if (!res || !res.ok) {
        return { ok: false, status: res && res.status, rows: [] };
      }
      const b = res.body;
      return { ok: true, rows: Array.isArray(b) ? b : ((b && Array.isArray(b.data)) ? b.data : []) };
    } catch (e) {
      console.warn('[openLineChain] ' + endpoint + ' failed', e);
      return { ok: false, status: 0, rows: [] };
    }
  }

  class openLineChain extends ActionChain {
    async run(context, { lineId }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      fns.dropFiles();
      v.answers = {};
      v.defects = [];
      v.step = 0;
      v.notes = '';
      v.ack = false;
      v.saved = {};
      v.saveError = '';
      v.blocked = [];
      v.photoError = '';
      v.history = [];
      v.checklist = [];
      v.checklistError = '';
      const token = (Number(v.openToken) || 0) + 1;
      v.openToken = token;

      if (!lineId) {
        v.current = null;
        return;
      }
      v.done = null;
      const line = (v.lines || []).find((l) => String(l.lineId) === String(lineId));
      const p = line ? (fns.pointForLine(line, v.mode) || fns.pointForLine(line)) : null;
      if (!line || !p) {
        v.current = null;
        v.loadError = 'That line is not waiting for an inspection any more.';
        return;
      }
      if (p.mode !== v.mode) {
        v.mode = p.mode;
        v.point = '';
      }
      v.current = Object.assign({}, line, {
        point: p.key, pointLabel: p.label, required: !!fns.matrixRule(v.matrix, line, p.key),
      });
      v.checklistLoading = true;
      try {
        const [checklist, inspections] = await Promise.all([
          get(context, 'eqp-v1/getInspectionChecklists', { classId: Number(line.equipmentClassId) }),
          get(context, 'eqp-v1/getInspections', { requestLineId: Number(line.lineId) }),
        ]);
        if (v.openToken !== token) {
          return;
        }
        if (!checklist.ok) {
          v.checklistError = 'The checklist for ' + (line.className || 'this class') + ' could not be loaded (HTTP '
            + (checklist.status || 0) + '). Try again before inspecting.';
          return;
        }
        const items = fns.checklistFor(checklist.rows, line, p.key);
        v.checklist = items;
        v.history = fns.historyRows(inspections.rows);

        const open = fns.openInspection(inspections.rows, p.key);
        if (open) {
          const [responses, defects] = await Promise.all([
            get(context, 'eqp-v1/getInspectionResponses', { inspectionId: Number(open.id) }),
            get(context, 'eqp-v1/getInspectionDefects', { inspectionId: Number(open.id) }),
          ]);
          if (v.openToken !== token) {
            return;
          }
          const prior = fns.savedAnswers(responses.rows, items);
          const priorDefects = fns.savedDefects(defects.rows, items);
          const savedDefects = {};
          priorDefects.forEach((d) => { savedDefects[d.key] = d.id; });
          v.answers = prior.answers;
          v.defects = priorDefects;
          v.saved = { inspectionId: Number(open.id), responses: prior.saved, defects: savedDefects, photos: {}, resumed: true };
        }
      } finally {
        if (v.openToken === token) {
          v.checklistLoading = false;
        }
      }
    }
  }

  return openLineChain;
});
