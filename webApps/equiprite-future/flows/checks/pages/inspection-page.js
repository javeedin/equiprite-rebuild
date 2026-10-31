define([
  'resources/js/inspectionRules',
  'resources/js/inspectionQueue',
  'resources/js/exportKit',
  'resources/js/fmt',
], (Rules, Q, exportKit, fmt) => {
  'use strict';

  // Inspections: binding helpers. The rules are New EquipRite's, unchanged: resources/js/inspectionRules.js is New's
  // flows/operations/pages/inspection-page.js copied as it is (points, the matrix, the checklist, answers, score,
  // PASS / CONDITIONAL / FAIL, what blocks Complete, the request bodies, the photo metadata, what is on record), and
  // tests/next-checks.test.js keeps the two identical. This class adds what this screen's design needs on top.
  class PageModule extends Rules {
    formats() { return exportKit.FORMATS; }

    pointWords(key) { return Q.pointWords(key).label; }
    pointHint(key) { return Q.pointWords(key).short; }
    lineWords(status) { return Q.lineWords(status); }

    /** The defects logged against one question ('' for damage the checklist does not ask about). */
    defectsFor(defects, itemId) {
      const id = itemId == null ? '' : String(itemId);
      return (Array.isArray(defects) ? defects : []).filter((d) => String(d.itemId || '') === id);
    }

    /** Defects of no question on screen (added for other damage, or saved earlier against a retired question). */
    otherDefects(defects, items) {
      const ids = (Array.isArray(items) ? items : []).map((it) => it.id);
      return (Array.isArray(defects) ? defects : []).filter((d) => !d.itemId || ids.indexOf(String(d.itemId)) === -1);
    }

    /** "3 of 4 answered · 1 failed · score 75%". */
    progressText(items, answers) {
      const s = this.score(items, answers);
      const parts = [s.answered + ' of ' + s.total + ' answered'];
      if (s.fault) parts.push(s.fault + ' failed');
      if (s.marginal) parts.push(s.marginal + ' low');
      if (s.percent !== null) parts.push('score ' + s.percent + '%');
      return parts.join(' · ');
    }

    /** The result as it stands, in words, and its colour. */
    verdictText(items, answers, defects, point) {
      const r = this.result(items, answers, defects);
      return this.resultText(r.code, point, r.finished);
    }

    verdictTone(items, answers, defects) {
      const r = this.result(items, answers, defects);
      return Q.tone(r.code, r.finished);
    }

    /** What Complete is about to write, in words. */
    willDo(current, items, answers, defects, ack, saved) {
      if (!current) return '';
      const r = this.result(items, answers, defects);
      if (!r.finished) return 'Answer the required questions first; then this says what Complete will save.';
      return Q.willDo(current.point, r.code, r.finished, ack, r.score.answered, defects, saved);
    }

    // The page keeps its DOM still while it is used: the answer buttons depend on the question only (their state is a
    // class bound in place), and a defect card is bound to its key, so a tap is never lost to a redraw.

    /** A question's answer buttons ([{ value, label, tone }]), the same for whatever is answered. */
    options(item) { return this.choices(item, null); }

    /** Whether this button is the answer given. */
    optionOn(answers, item, value) {
      const a = item && answers ? answers[item.id] : null;
      return !!(a && a.value != null && String(a.value).trim().toUpperCase() === String(value));
    }

    /** An answer button's class: its tone, and whether it is the answer given. */
    optionClass(answers, item, opt) {
      return 'nx-insp-ans nx-insp-ans--' + opt.tone + (this.optionOn(answers, item, opt.value) ? ' nx-insp-ans--on' : '');
    }

    /** The keys of the defects logged against one question. */
    defectKeys(defects, itemId) { return this.defectsFor(defects, itemId).map((d) => d.key); }

    /** The keys of the defects of no question on screen. */
    otherKeys(defects, items) { return this.otherDefects(defects, items).map((d) => d.key); }

    /** One defect by its key ({} once it is gone). */
    defectOf(defects, key) {
      return (Array.isArray(defects) ? defects : []).find((d) => d.key === key) || {};
    }

    /** A question's row class, by its answer. */
    questionClass(item, answers) {
      return 'nx-insp-q nx-insp-q--' + this.answerState(item, answers ? answers[item.id] : null);
    }

    segClass(on, stop) {
      return 'nx-seg-btn' + (stop ? ' nx-insp-sev--stop' : '') + (on ? ' nx-seg-btn--on' : '');
    }

    /** The result of an earlier inspection in words. */
    resultWord(code) {
      return { PASS: 'Pass', CONDITIONAL: 'Conditional', FAIL: 'Fail' }[String(code || '').toUpperCase()] || String(code || '');
    }

    resultTone(code) {
      return Q.tone(String(code || '').toUpperCase(), true);
    }

    /** "Inspector: Mia Ortiz · 30 Oct 2026". */
    inspectorText(name) {
      return (name ? name + ' · ' : '') + fmt.date(this.today());
    }

    /** Non-empty parts joined by " · ". */
    dots(a, b, c) { return [a, b, c].filter((x) => x !== undefined && x !== null && x !== '').join(' · '); }

    date(v) { return fmt.date(v); }
    range(a, b) { return fmt.range(String(a || '').slice(0, 10), String(b || '').slice(0, 10)); }

    /** The defects summary on the review: "1 defect" / "2 defects". */
    defectCount(defects) { return fmt.count((defects || []).length, 'defect'); }
  }

  return PageModule;
});
