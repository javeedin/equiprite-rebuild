define([], () => {
  'use strict';

  // ── Inspection points (FDD 7.12, 7.17.3, S16) ─────────────────────────────────────────────────────────────────
  // The inspection matrix ticks a class / subclass at up to four points. Each point is where a line waits at one
  // line status: a picked line waits for its ship-out inspection, a line on its way back waits to be received.
  // Check-out = equipment about to leave (yard or site); check-in = equipment arriving.
  // Only the yard ship-out sits inside the request lifecycle (PICK_RELEASED -> EQP_INSPECTION_COMPLETE -> SHIPPED,
  // or INSPECTION_FAILED), so only that point changes the line status; the other three record the inspection and
  // leave the receipt to Request detail and Receipt & returns. A failed line is offered again for re-inspection.
  const POINTS = [
    { key: 'SHIP_OUT_YARD', mode: 'out', label: 'Ship-out from yard', short: 'Yard', statuses: ['PICK_RELEASED', 'INSPECTION_FAILED'], setsStatus: true },
    { key: 'SHIP_OUT_SITE', mode: 'out', label: 'Ship-out from site', short: 'Site', statuses: ['RETURN_INITIATED'] },
    { key: 'RECEIVE_SITE',  mode: 'in',  label: 'Receive at site',    short: 'Site', statuses: ['SHIP_TO_SITE', 'SHIPPED'] },
    { key: 'RECEIVE_YARD',  mode: 'in',  label: 'Receive at yard',    short: 'Yard', statuses: ['SHIPPED_TO_YARD', 'RETURN_IN_PROCESS'] },
  ];
  const POINT = {};
  POINTS.forEach((p) => { POINT[p.key] = p; });
  const WAITING = {};
  POINTS.forEach((p) => p.statuses.forEach((s) => { WAITING[s] = true; }));

  // Defects are rated critical, major, minor or cosmetic (FDD S16). Critical and major stop the equipment.
  const SEVERITIES = [
    { value: 'CRITICAL', label: 'Critical', stops: true },
    { value: 'MAJOR',    label: 'Major',    stops: true },
    { value: 'MINOR',    label: 'Minor',    stops: false },
    { value: 'COSMETIC', label: 'Cosmetic', stops: false },
  ];
  const ACTIONS = [
    { value: 'REPAIR',  label: 'Repair' },
    { value: 'REPLACE', label: 'Replace' },
    { value: 'MONITOR', label: 'Monitor' },
  ];
  const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

  const up = (v) => String(v == null ? '' : v).trim().toUpperCase();
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  const flag = (v) => v === true || /^(Y|YES|TRUE|1)$/i.test(String(v == null ? '' : v).trim());
  const same = (a, b) => a !== null && a !== undefined && a !== '' && b !== null && b !== undefined && b !== ''
    && Number(a) === Number(b);

  class PageModule {
    constructor() {
      // Photos are File objects: held here, not in page variables (VB copies variable values), keyed by defect.
      this._files = {};
    }

    // ── Points and the queue ──────────────────────────────────────────────────────────────────────────────────

    /** The point key for an inspection type as stored (SHIP_OUT_YARD, 'Ship out of yard', RECEIVE_AT_SITE …), or ''. */
    pointKey(code) {
      const s = up(code).replace(/[^A-Z]/g, '');
      if (!s) {
        return '';
      }
      const exact = POINTS.find((p) => p.key.replace(/_/g, '') === s);
      if (exact) {
        return exact.key;
      }
      const where = s.indexOf('YARD') !== -1 ? 'YARD' : (s.indexOf('SITE') !== -1 ? 'SITE' : '');
      if (!where) {
        return '';
      }
      const receive = s.indexOf('RECEIV') !== -1 || s.indexOf('CHECKIN') !== -1 || s.indexOf('INBOUND') !== -1;
      const out = s.indexOf('OUT') !== -1 || s.indexOf('SHIP') !== -1;
      if (receive) {
        return where === 'YARD' ? 'RECEIVE_YARD' : 'RECEIVE_SITE';
      }
      return out ? (where === 'YARD' ? 'SHIP_OUT_YARD' : 'SHIP_OUT_SITE') : '';
    }

    point(key) {
      return POINT[key] || null;
    }

    pointLabel(key) {
      return (POINT[key] && POINT[key].label) || '';
    }

    /** True when a line status waits at one of the points (the queue loader keeps only these lines). */
    isWaiting(status) {
      return !!WAITING[up(status)];
    }

    /** The point a line waits at (optionally within one mode), or null. */
    pointForLine(line, mode) {
      const s = up(line && line.lineStatus);
      return POINTS.find((p) => (!mode || p.mode === mode) && p.statuses.indexOf(s) !== -1) || null;
    }

    /** The active inspection-matrix row that asks for this line at this point, or null (conf-inspection-details). */
    matrixRule(matrix, line, point) {
      return (Array.isArray(matrix) ? matrix : []).find((r) => r
        && String(r.isActiveFlag || 'Y').toUpperCase() !== 'N'
        && this.pointKey(r.inspectionType) === point
        && same(r.equipmentClassId, line.equipmentClassId)
        && (r.equipmentSubclassId == null || same(r.equipmentSubclassId, line.equipmentSubclassId))
        && (r.equipmentMasterId == null || same(r.equipmentMasterId, line.equipmentMasterId))) || null;
    }

    /**
     * The queue: lines waiting at a point of this mode (and this point, when one is picked). scope 'required' keeps
     * the lines the matrix asks to inspect; 'all' also lists the rest (an inspection nobody asked for is allowed).
     * Lines the matrix asks for come first, then the earliest needed.
     */
    queue(lines, matrix, mode, point, scope) {
      const out = [];
      (Array.isArray(lines) ? lines : []).forEach((l) => {
        const p = this.pointForLine(l, mode);
        if (!p || (point && p.key !== point)) {
          return;
        }
        const rule = this.matrixRule(matrix, l, p.key);
        if (scope === 'required' && !rule) {
          return;
        }
        out.push(Object.assign({}, l, { point: p.key, pointLabel: p.label, required: !!rule }));
      });
      return out.sort((a, b) => (Number(b.required) - Number(a.required))
        || String(a.startDate || '').localeCompare(String(b.startDate || ''))
        || String(a.requestNumber || '').localeCompare(String(b.requestNumber || ''))
        || (Number(a.lineId) - Number(b.lineId)));
    }

    /** Point chips for a mode: [{ key, label, count }], "All" first. */
    pointChips(lines, matrix, mode, scope) {
      const chips = [{ key: '', label: mode === 'in' ? 'All arriving' : 'All leaving', count: this.queue(lines, matrix, mode, '', scope).length }];
      POINTS.filter((p) => p.mode === mode).forEach((p) => {
        chips.push({ key: p.key, label: p.label, count: this.queue(lines, matrix, mode, p.key, scope).length });
      });
      return chips;
    }

    modeCount(lines, matrix, mode, scope) {
      return this.queue(lines, matrix, mode, '', scope).length;
    }

    /** The line a finished inspection hands over to: the first one still waiting in the same queue. */
    nextInQueue(queue, doneLineId) {
      return (Array.isArray(queue) ? queue : []).find((l) => String(l.lineId) !== String(doneLineId)) || null;
    }

    unitText(line) {
      if (!line) {
        return '';
      }
      return (line.equipmentName || 'Equipment') + (line.allocatedSerial ? ' · ' + line.allocatedSerial : '');
    }

    // ── Checklist ────────────────────────────────────────────────────────────────────────────────────────────

    /**
     * One inspection-checklists row as a question. The endpoint answers a generic object list, so the usual
     * spellings are accepted; anything missing gets a safe default (a required pass / fail question).
     */
    checklistItem(r, i) {
      const raw = up(r.responseType || r.answerType || r.questionType || r.itemType || r.checkType);
      let type = 'PASS_FAIL';
      if (/YES|BOOL/.test(raw)) {
        type = 'YES_NO';
      } else if (/NUM|MEASURE|READING/.test(raw)) {
        type = 'NUMERIC';
      } else if (/RAT|SCALE|SCORE/.test(raw)) {
        type = 'RATING';
      } else if (/TEXT|COMMENT|NOTE/.test(raw)) {
        type = 'TEXT';
      }
      const req = r.isMandatoryFlag !== undefined ? r.isMandatoryFlag
        : (r.isRequiredFlag !== undefined ? r.isRequiredFlag : (r.isRequired !== undefined ? r.isRequired : r.mandatory));
      const min = num(r.minValue !== undefined ? r.minValue : r.min);
      const max = num(r.maxValue !== undefined ? r.maxValue : r.max);
      const id = r.id != null ? r.id : (r.checklistId != null ? r.checklistId : r.inspectionChecklistId);
      return {
        id: id != null ? String(id) : 'item-' + i,
        checklistId: id != null && !isNaN(Number(id)) ? Number(id) : null,
        text: String(r.questionText || r.question || r.checklistItem || r.itemText || r.itemName || r.checkPoint || r.description || ('Check ' + (i + 1))),
        hint: String(r.guidance || r.helpText || r.instructions || ''),
        type,
        required: req === undefined || req === null || req === '' ? true : flag(req),
        min,
        max: type === 'RATING' ? (max || 5) : max,
        unit: String(r.uom || r.unitOfMeasure || r.unit || ''),
        expected: up(r.expectedValue || r.expectedAnswer || r.passValue) === 'NO' ? 'NO' : 'YES',
        subclassId: r.equipmentSubclassId != null ? r.equipmentSubclassId : (r.subclassId != null ? r.subclassId : null),
        point: this.pointKey(r.inspectionType || r.inspectionPoint),
        active: up(r.isActiveFlag || 'Y') !== 'N',
        seq: num(r.sequenceNumber !== undefined ? r.sequenceNumber : (r.displaySequence !== undefined ? r.displaySequence : (r.sortOrder !== undefined ? r.sortOrder : r.seq))),
        order: i,
      };
    }

    /** The questions for this line at this point: its class's checklist, narrowed to its subclass and the point. */
    checklistFor(rows, line, point) {
      return (Array.isArray(rows) ? rows : [])
        .map((r, i) => this.checklistItem(r || {}, i))
        .filter((it) => it.active
          && (it.subclassId == null || same(it.subclassId, line && line.equipmentSubclassId))
          && (!point || !it.point || it.point === point))
        .sort((a, b) => ((a.seq == null ? 1e9 : a.seq) - (b.seq == null ? 1e9 : b.seq)) || (a.order - b.order));
    }

    // ── Answers, score and result ───────────────────────────────────────────────────────────────────────────

    /** 'open' (no answer), 'ok', 'fault', 'marginal' (a low rating), 'info' (text, unranged number) or 'invalid'. */
    answerState(item, answer) {
      const v = answer && answer.value != null ? String(answer.value).trim() : '';
      if (!item || !v) {
        return 'open';
      }
      if (item.type === 'YES_NO') {
        return up(v) === item.expected ? 'ok' : 'fault';
      }
      if (item.type === 'PASS_FAIL') {
        return up(v) === 'PASS' ? 'ok' : 'fault';
      }
      if (item.type === 'NUMERIC') {
        const n = num(v);
        if (n === null) {
          return 'invalid';
        }
        if ((item.min != null && n < item.min) || (item.max != null && n > item.max)) {
          return 'fault';
        }
        return item.min == null && item.max == null ? 'info' : 'ok';
      }
      if (item.type === 'RATING') {
        const n = num(v);
        if (n === null) {
          return 'invalid';
        }
        return n <= Math.floor((item.max || 5) * 0.4) ? 'marginal' : 'ok';
      }
      return 'info';
    }

    /** The answer as a person reads it ("Yes", "Fail", "52 mm", "4 of 5"). */
    answerText(item, answer) {
      const v = answer && answer.value != null ? String(answer.value).trim() : '';
      if (!item || !v) {
        return '';
      }
      if (item.type === 'YES_NO') {
        return up(v) === 'YES' ? 'Yes' : 'No';
      }
      if (item.type === 'PASS_FAIL') {
        return up(v) === 'PASS' ? 'Pass' : 'Fail';
      }
      if (item.type === 'RATING') {
        return v + ' of ' + (item.max || 5);
      }
      if (item.type === 'NUMERIC') {
        return v + (item.unit ? ' ' + item.unit : '');
      }
      return v;
    }

    /** Big answer buttons for the item on screen: [{ value, label, on, tone }]. Numbers and text are typed instead. */
    choices(item, answer) {
      if (!item) {
        return [];
      }
      const cur = answer && answer.value != null ? up(answer.value) : '';
      let list = [];
      if (item.type === 'YES_NO') {
        list = [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }];
      } else if (item.type === 'PASS_FAIL') {
        list = [{ value: 'PASS', label: 'Pass' }, { value: 'FAIL', label: 'Fail' }];
      } else if (item.type === 'RATING') {
        for (let i = 1; i <= (item.max || 5); i++) {
          list.push({ value: String(i), label: String(i) });
        }
      }
      return list.map((c) => {
        const st = this.answerState(item, { value: c.value });
        return Object.assign(c, { on: cur === c.value, tone: st === 'fault' ? 'fault' : (st === 'marginal' ? 'marginal' : 'ok') });
      });
    }

    /** The typed answer of a question ('' when none), for the number and text inputs. */
    answerValue(answers, item) {
      const a = item && answers ? answers[item.id] : null;
      return a && a.value != null ? String(a.value) : '';
    }

    answerNote(answers, item) {
      const a = item && answers ? answers[item.id] : null;
      return a && a.note != null ? String(a.note) : '';
    }

    /** A failed, low or unreadable answer opens the note and "Log a defect" under the question. */
    needsNote(item, answers) {
      const st = this.answerState(item, item && answers ? answers[item.id] : null);
      return st === 'fault' || st === 'marginal' || st === 'invalid';
    }

    stateText(state) {
      return { fault: 'Failed', marginal: 'Low rating', invalid: 'Not a number', ok: 'Fine', info: 'Noted', open: 'Not answered' }[state] || '';
    }

    /** Non-empty texts joined by a space. */
    joinText(a, b) {
      return [a, b].filter((t) => !!t).join(' ');
    }

    /** Range text for a numeric question: "40–60 mm", "at least 40", or ''. */
    rangeText(item) {
      if (!item || item.type !== 'NUMERIC' || (item.min == null && item.max == null)) {
        return '';
      }
      const u = item.unit ? ' ' + item.unit : '';
      if (item.min != null && item.max != null) {
        return 'Allowed ' + item.min + '–' + item.max + u;
      }
      return item.min != null ? 'At least ' + item.min + u : 'At most ' + item.max + u;
    }

    /** Counts over the checklist: answered, still required, ok / fault / marginal, and the score (% of graded answers ok). */
    score(items, answers) {
      const a = answers || {};
      const s = { total: 0, answered: 0, requiredOpen: 0, ok: 0, fault: 0, marginal: 0, info: 0, invalid: 0, percent: null };
      (Array.isArray(items) ? items : []).forEach((it) => {
        s.total++;
        const st = this.answerState(it, a[it.id]);
        if (st === 'open') {
          if (it.required) {
            s.requiredOpen++;
          }
          return;
        }
        s.answered++;
        s[st]++;
      });
      const graded = s.ok + s.fault + s.marginal;
      s.percent = graded ? Math.round((100 * s.ok) / graded) : null;
      return s;
    }

    /**
     * The result rule (FDD 7.12.4):
     *   FAIL         a required question failed, or a critical or major defect
     *   CONDITIONAL  otherwise, an optional question failed, a low rating, or a minor or cosmetic defect
     *   PASS         nothing of the above
     * `finished` is false while a required question is open or a number is not a number. `reasons` say why.
     */
    result(items, answers, defects) {
      const a = answers || {};
      const reasons = [];
      (Array.isArray(items) ? items : []).forEach((it) => {
        const st = this.answerState(it, a[it.id]);
        if (st === 'fault') {
          reasons.push({ level: it.required ? 'fail' : 'cond', text: it.text + ': ' + this.answerText(it, a[it.id]) });
        } else if (st === 'marginal') {
          reasons.push({ level: 'cond', text: it.text + ': rated ' + this.answerText(it, a[it.id]) });
        }
      });
      (Array.isArray(defects) ? defects : []).forEach((d) => {
        const sev = SEVERITIES.find((s) => s.value === up(d.severity));
        if (sev) {
          reasons.push({ level: sev.stops ? 'fail' : 'cond', text: sev.label + ' defect: ' + (d.description || 'no description') });
        }
      });
      const sc = this.score(items, answers);
      const code = reasons.some((r) => r.level === 'fail') ? 'FAIL' : (reasons.some((r) => r.level === 'cond') ? 'CONDITIONAL' : 'PASS');
      return { code, finished: sc.requiredOpen === 0 && sc.invalid === 0, reasons, score: sc };
    }

    /** What the result means at this point, in words. */
    resultText(code, point, finished) {
      if (finished === false) {
        return 'Not finished';
      }
      const leaving = !!(POINT[point] && POINT[point].mode === 'out');
      if (code === 'FAIL') {
        return leaving ? 'Fail: cannot ship' : 'Fail: damaged on arrival';
      }
      if (code === 'CONDITIONAL') {
        return leaving ? 'Conditional: ships once acknowledged' : 'Conditional: received with remarks';
      }
      return leaving ? 'Pass: cleared to ship' : 'Pass: received in good order';
    }

    /** The line status the result moves the line to, or null (only the yard ship-out is in the lifecycle). */
    lineStatusAfter(point, code, ack) {
      if (!POINT[point] || !POINT[point].setsStatus) {
        return null;
      }
      if (code === 'FAIL') {
        return 'INSPECTION_FAILED';
      }
      if (code === 'PASS' || (code === 'CONDITIONAL' && ack)) {
        return 'EQP_INSPECTION_COMPLETE';
      }
      return null;
    }

    /**
     * What stops "Complete inspection": required answers, numbers, each defect's description, severity and photo,
     * and the acknowledgement a conditional result needs (FDD: CONDITIONAL -> the Equipment Manager acknowledges).
     * Defects saved by an earlier attempt are already on record and are not asked again.
     */
    blockers(items, answers, defects, ack) {
      const a = answers || {};
      const list = [];
      const open = [];
      (Array.isArray(items) ? items : []).forEach((it) => {
        const st = this.answerState(it, a[it.id]);
        if (st === 'open' && it.required) {
          open.push(it.text);
        } else if (st === 'invalid') {
          list.push(it.text + ': enter a number');
        }
      });
      if (open.length) {
        list.unshift(open.length === 1 ? 'Answer: ' + open[0] : 'Answer ' + open.length + ' required questions');
      }
      (Array.isArray(defects) ? defects : []).forEach((d, i) => {
        if (d.saved) {
          return;
        }
        const name = d.description ? '"' + d.description + '"' : 'defect ' + (i + 1);
        if (!String(d.description || '').trim()) {
          list.push('Describe defect ' + (i + 1));
        }
        if (!SEVERITIES.some((s) => s.value === up(d.severity))) {
          list.push('Severity of ' + name);
        }
        if (!d.photo) {
          list.push('Photo of ' + name);
        }
        if (d.cost !== undefined && d.cost !== null && String(d.cost).trim() !== '' && num(String(d.cost).replace(/[$,\s]/g, '')) === null) {
          list.push('Repair cost of ' + name + ' is not a number');
        }
      });
      const r = this.result(items, answers, defects);
      if (r.finished && r.code === 'CONDITIONAL' && !ack) {
        list.push('Acknowledge the conditional result');
      }
      return list;
    }

    // ── Steps: one question at a time, then review ──────────────────────────────────────────────────────────

    currentItem(items, step) {
      return (Array.isArray(items) ? items : [])[Number(step) || 0] || null;
    }

    isReview(items, step) {
      return (Number(step) || 0) >= (Array.isArray(items) ? items.length : 0);
    }

    /** Progress pips: one per question (tap to jump), coloured by its answer. */
    pips(items, answers, step) {
      const a = answers || {};
      return (Array.isArray(items) ? items : []).map((it, i) => ({
        index: i,
        label: String(i + 1),
        state: this.answerState(it, a[it.id]),
        current: i === (Number(step) || 0),
        title: it.text,
      }));
    }

    /** Defects shown under the step: on a question, the ones logged against it; on review, all of them. */
    defectsShown(defects, items, step) {
      const list = Array.isArray(defects) ? defects : [];
      if (this.isReview(items, step)) {
        return list;
      }
      const it = this.currentItem(items, step);
      return it ? list.filter((d) => d.itemId === it.id) : [];
    }

    severities() {
      return SEVERITIES.slice();
    }

    actions() {
      return ACTIONS.slice();
    }

    severityLabel(v) {
      const s = SEVERITIES.find((x) => x.value === up(v));
      return s ? s.label : '';
    }

    /** A new defect, optionally logged against a question (its text and note start the description). */
    newDefect(key, item, answer) {
      const note = answer && answer.note ? String(answer.note).trim() : '';
      return {
        key,
        itemId: item ? item.id : '',
        checklistId: item ? item.checklistId : null,
        description: item ? item.text + (note ? ': ' + note : '') : '',
        severity: item ? (item.required ? 'MAJOR' : 'MINOR') : '',
        action: 'REPAIR',
        cost: '',
        photo: null,
        saved: false,
      };
    }

    /** A photo the inspector picked: '' when fine, else why not. */
    photoProblem(file) {
      if (!file) {
        return 'No photo was taken.';
      }
      if (file.type && !/^image\//.test(file.type)) {
        return 'That file is not a photo.';
      }
      if (file.size > MAX_PHOTO_BYTES) {
        return 'The photo is larger than 20 MB.';
      }
      return '';
    }

    holdFile(key, file) {
      if (file) {
        this._files[key] = file;
      } else {
        delete this._files[key];
      }
    }

    heldFile(key) {
      return this._files[key] || null;
    }

    dropFiles() {
      this._files = {};
    }

    // ── Request bodies ──────────────────────────────────────────────────────────────────────────────────────

    /** POST /inspections: the inspection opens IN_PROGRESS and is completed by the last call of the save. */
    inspectionBody(line, point, nowIso) {
      return {
        requestLineId: Number(line.lineId),
        inspectionType: point,
        inspectionStatus: 'IN_PROGRESS',
        scheduledDate: String(nowIso || '').substring(0, 10) + 'T00:00:00Z',
      };
    }

    /** POST (or PATCH) /inspection-responses: the answer as given and how it scored. */
    responseBody(inspectionId, item, answer) {
      const st = this.answerState(item, answer);
      const RESULT = { ok: 'PASS', fault: 'FAIL', marginal: 'CONDITIONAL', info: 'INFO' };
      return {
        inspectionId: Number(inspectionId),
        checklistId: item.checklistId,
        responseValue: String(answer.value).trim(),
        responseResult: RESULT[st] || 'INFO',
        notes: answer.note ? String(answer.note).trim() : null,
      };
    }

    /** POST /inspection-defects. */
    defectBody(inspectionId, d) {
      const cost = d.cost === undefined || d.cost === null || String(d.cost).trim() === '' ? null : num(String(d.cost).replace(/[$,\s]/g, ''));
      return {
        inspectionId: Number(inspectionId),
        checklistId: d.checklistId != null ? Number(d.checklistId) : null,
        defectDescription: String(d.description || '').trim(),
        severity: up(d.severity),
        recommendedAction: d.action ? up(d.action) : null,
        estimatedRepairCost: cost,
        defectStatus: 'OPEN',
      };
    }

    /** PATCH /inspections/{id}: completed, with the result. A conditional result records who acknowledged it. */
    completionBody(code, notes, ack, actor, nowIso) {
      const parts = [];
      if (String(notes || '').trim()) {
        parts.push(String(notes).trim());
      }
      if (code === 'CONDITIONAL' && ack) {
        parts.push('Conditional result acknowledged' + (actor ? ' by ' + actor : '') + '.');
      }
      return {
        inspectionStatus: 'COMPLETED',
        overallResult: code,
        completedDate: nowIso,
        notes: parts.join(' ') || null,
      };
    }

    /**
     * Metadata part of the commonService upload for a defect photo. The document hangs off the defect row
     * (entity EQR_INSPECTION_DEFECT + its id; EquipRite uses table names as entity types), so listing the
     * defect's documents finds it. The path is made unique with the time: the service answers 409 on a repeat.
     */
    photoMetadata(inspectionId, defectId, fileName, description, stamp) {
      const safe = String(fileName || 'photo.jpg').replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
      return {
        application_code: 'EQUIP_RITE',
        doc_type: 'DOCUMENT',
        doc_name: String(fileName || 'Defect photo').substring(0, 200),
        path: 'inspections/' + inspectionId + '/defects/' + defectId + '/' + stamp + '-' + safe,
        entity_type: 'EQR_INSPECTION_DEFECT',
        entity_id: Number(defectId),
        description: String(description || '').substring(0, 500) || null,
      };
    }

    // ── What is already on record for the line ──────────────────────────────────────────────────────────────

    /** An earlier inspection of this line at this point that was never completed (an interrupted save), or null. */
    openInspection(rows, point) {
      return (Array.isArray(rows) ? rows : []).find((r) => r && r.id != null
        && up(r.inspectionStatus) !== 'COMPLETED' && this.pointKey(r.inspectionType) === point) || null;
    }

    /** Completed inspections of the line, newest first: [{ id, date, point, result }]. */
    historyRows(rows) {
      return (Array.isArray(rows) ? rows : [])
        .filter((r) => r && up(r.inspectionStatus) === 'COMPLETED')
        .map((r) => ({
          id: r.id,
          date: String(r.completedDate || r.lastUpdatedDate || r.createdDate || '').substring(0, 10),
          pointKey: this.pointKey(r.inspectionType),
          point: this.pointLabel(this.pointKey(r.inspectionType)) || String(r.inspectionType || ''),
          result: up(r.overallResult),
          notes: r.notes || '',
        }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }

    /** The latest completed inspection of the line at this point (it is being inspected again), or null. */
    doneHere(history, point) {
      return (Array.isArray(history) ? history : []).find((h) => h.pointKey === point) || null;
    }

    /** Saved responses of an open inspection -> { answers, saved } keyed by question id. */
    savedAnswers(rows, items) {
      const answers = {};
      const saved = {};
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        const cid = r.checklistId != null ? r.checklistId : r.inspectionChecklistId;
        const it = (items || []).find((i) => i.checklistId != null && same(i.checklistId, cid));
        if (!it || r.responseValue == null) {
          return;
        }
        answers[it.id] = { value: String(r.responseValue), note: r.notes || '' };
        saved[it.id] = { id: r.id, value: String(r.responseValue), note: r.notes || '' };
      });
      return { answers, saved };
    }

    /** Saved defects of an open inspection, as read-only defects. */
    savedDefects(rows, items) {
      return (Array.isArray(rows) ? rows : []).map((r) => {
        const it = (items || []).find((i) => i.checklistId != null && same(i.checklistId, r.checklistId));
        return {
          key: 'saved-' + r.id,
          id: r.id,
          itemId: it ? it.id : '',
          checklistId: r.checklistId != null ? r.checklistId : null,
          description: String(r.defectDescription || r.description || ''),
          severity: up(r.severity || r.defectSeverity),
          action: up(r.recommendedAction || r.action),
          cost: r.estimatedRepairCost != null ? String(r.estimatedRepairCost) : '',
          photo: null,
          saved: true,
        };
      });
    }

    // ── Links and dates ─────────────────────────────────────────────────────────────────────────────────────

    /** The line in Old EquipRite (Line detail: substitute the unit, cancel the line), or ''. */
    oldLineLink(oldAppUrl, line) {
      if (!oldAppUrl || !line || !line.lineId || !line.requestId) {
        return '';
      }
      const base = oldAppUrl.endsWith('/') ? oldAppUrl : oldAppUrl + '/';
      return base + 'vp/shell/equipment-foundation/line-detail?requestId=' + encodeURIComponent(line.requestId)
        + '&requestNumber=' + encodeURIComponent(line.requestNumber || '') + '&lineId=' + encodeURIComponent(line.lineId)
        + '&equipmentMasterId=' + encodeURIComponent(line.equipmentMasterId != null ? line.equipmentMasterId : '');
    }

    /** "29 Oct 2026" from an ISO date. */
    day(v) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : '';
    }

    /** Today, local, as YYYY-MM-DD. */
    today() {
      const n = new Date();
      return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    }
  }

  return PageModule;
});
