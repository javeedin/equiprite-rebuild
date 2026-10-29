define([], function () {
  'use strict';

  /**
   * Project & task assigned to one unit - PROOF OF CONCEPT storage.
   *
   * Set with "Edit Project & Task" on equipment-unit-detail-page, shown there
   * on Overview and read by equipment-record-cost-page (Equipment card, and
   * the project / task every cost is charged to).
   *
   * EQR_SERIAL_REF has no project / task columns and the serial DTO returns
   * none, so for now the values live in THIS BROWSER's localStorage, one key
   * per unit. Other users and other browsers do not see them. When the
   * backend adds projectNumber / taskNumber to the unit, Save should PATCH
   * the unit instead and this module goes away.
   *
   * Keyed by control type + id: the SERIAL, LOT and INVENTORY id spaces are
   * disjoint, so the id alone could collide. Same try/catch-and-stay-silent
   * rule as draftStorage.js - disabled storage must never break a page.
   */

  const PREFIX = 'eqr.unitProject.';

  function key(controlType, id) {
    return PREFIX + String(controlType || 'SERIAL').toUpperCase() + '.' + String(id || '');
  }

  function clean(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  // {projectNumber, taskNumber} saved for this unit, or null.
  function load(controlType, id) {
    if (!id) return null;
    try {
      const raw = localStorage.getItem(key(controlType, id));
      const v = raw ? JSON.parse(raw) : null;
      return v && (v.projectNumber || v.taskNumber) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Both blank clears the assignment.
  function save(controlType, id, projectNumber, taskNumber) {
    if (!id) return;
    const p = clean(projectNumber);
    const t = clean(taskNumber);
    try {
      if (!p && !t) {
        localStorage.removeItem(key(controlType, id));
      } else {
        localStorage.setItem(key(controlType, id), JSON.stringify({ projectNumber: p, taskNumber: t }));
      }
    } catch (e) { /* quota or disabled storage - silent */ }
  }

  // The unit with any saved project / task laid over what the server sent.
  // A saved value wins: it is the newer edit.
  function apply(unit, controlType, id) {
    const saved = load(controlType, id);
    if (!saved) return unit;
    return Object.assign({}, unit, {
      projectNumber: saved.projectNumber,
      taskNumber: saved.taskNumber
    });
  }

  return { load: load, save: save, apply: apply };
});
