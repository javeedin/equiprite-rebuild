/**
 * Project task hierarchy — shared by the two Task LOVs.
 *
 * Fusion's projects/{ProjectId}/child/Tasks returns a FLAT list. A WBS like
 *
 *    1        Project Management & Engineering     <- summary
 *    1.1      Project Management                   <- summary
 *    1.1.1    Planning & Scheduling                <- summary
 *    1.1.1.1  Baseline Schedule Development        <- LEAF, chargeable
 *
 * arrives as four sibling rows with nothing in the payload saying which are
 * selectable. That matters well beyond cosmetics: the task the user picks is
 * stamped on EQR_EQUIPMENT_REQUEST.TASK_NUMBER, copied to
 * EQP_POSTCOST.PPM_TASK_NUMBER, and sent as `taskNumber` in the OIC
 * EQP_POST_COST_FLOW payload. In PPM only lowest-level tasks are chargeable, so
 * picking a summary task produces a request that looks fine for weeks and then
 * fails at cost import — far from the cause, with no route back to the request.
 *
 * The pickers show ONLY the leaves. Summary rows are dropped from the list
 * rather than greyed: a row a user cannot choose is noise in a dropdown, and on
 * a typical 4-level WBS it is most of the list (35 of 50 rows on the reference
 * project). The selection chains still re-check with isSummaryTask, because the
 * list and the rule should not be the same mechanism.
 *
 * TWO SIGNALS, in priority order:
 *
 *  1. ParentTaskId (authoritative). A task is a summary iff some other row
 *     names it as ParentTaskId. Requires ParentTaskId in the `fields` uriParam —
 *     LoadTaskTreeChain and the openapi default both request it.
 *
 *  2. TaskNumber prefix (fallback). A task is a summary iff another row's
 *     TaskNumber starts with it plus a dot. Used ONLY when no row carries a
 *     ParentTaskId, i.e. when the field was stripped from the projection. Task
 *     numbers are free text in Fusion — a project numbering tasks 'A-100' or
 *     reusing numbers across branches would defeat this — which is exactly why
 *     it is the fallback and not the primary.
 *
 * FAILS OPEN by design. An empty/failed fetch yields no summary ids, every row
 * reads as a leaf, and the pickers list everything — the pre-existing behaviour.
 * A wrong tree must never be able to hide a legitimate task.
 *
 * NOT verified against this pod: ChargeableFlag / TaskLevel / TopTaskId. The
 * captured pod response for projectTasksLOV carries ParentTaskId, ElementType,
 * TaskStartDate/TaskFinishDate, TransactionStartDate/TransactionCompletionDate
 * and nothing else, and .env holds placeholder credentials so no live probe was
 * possible. If ChargeableFlag is later confirmed queryable it is strictly
 * better than leaf-detection — it is a real PPM attribute, it survives paging,
 * and it can be pushed into the q predicate. See buildTaskTree's paging note.
 */
define([], function () {
  'use strict';

  /** Rows arrive as `items`; tolerate the whole response body too. */
  function itemsOf(source) {
    if (!source) return [];
    if (Array.isArray(source)) return source;
    if (Array.isArray(source.items)) return source.items;
    return [];
  }

  function idOf(row) {
    if (!row) return null;
    var id = row.TaskId;
    return (id === undefined || id === null || id === '') ? null : String(id);
  }

  /**
   * Classify a flat task list.
   *
   * Returns { summaryIds: [String], basis: String }. Ids are stringified
   * because TaskId is a 15-digit Fusion number that JSON, page variables and
   * template comparisons will each happily hand back as either a number or a
   * string; one canonical form removes every === trap.
   *
   * PAGING LIMIT: leaf-detection is a whole-set property — "has no children"
   * cannot be expressed as a Fusion q predicate — so this is only correct when
   * the entire task list is in hand. LoadTaskTreeChain fetches with limit=500,
   * which covers every project we have. A project with more than 500 tasks
   * would page, and a task whose children fall on a later page would be misread
   * as a leaf. That is the failure this degrades to: a summary task appearing
   * in the list again, i.e. the old behaviour, never a leaf going missing.
   */
  function buildTaskTree(source) {
    var rows = itemsOf(source);
    var tree = { summaryIds: [], basis: 'none' };
    if (!rows.length) return tree;

    var summary = Object.create(null);
    var hasParentSignal = false;

    rows.forEach(function (row) {
      var parent = row && row.ParentTaskId;
      if (parent === undefined || parent === null || parent === '') return;
      var parentId = String(parent);
      // Fusion writes 0 (not null) for a top task on some resources; it is not
      // a real id, and treating it as one would mark a phantom parent.
      if (parentId === '0') return;
      hasParentSignal = true;
      summary[parentId] = true;
    });

    if (hasParentSignal) {
      tree.basis = 'ParentTaskId';
    } else {
      tree.basis = 'TaskNumber';
      var numbers = rows
        .map(function (row) { return row && row.TaskNumber ? String(row.TaskNumber) : ''; })
        .filter(Boolean);

      rows.forEach(function (row) {
        var self = idOf(row);
        var number = row && row.TaskNumber ? String(row.TaskNumber) : '';
        if (!self || !number) return;
        var prefix = number + '.';
        var isParent = numbers.some(function (other) {
          return other !== number && other.indexOf(prefix) === 0;
        });
        if (isParent) summary[self] = true;
      });
    }

    tree.summaryIds = Object.keys(summary);
    return tree;
  }

  /**
   * Is this row a summary (non-chargeable) task?
   *
   * Takes the ROW rather than a bare id so the callers — the list filter and
   * the selection chains — can pass exactly what they already hold.
   */
  function isSummaryTask(row, tree) {
    var id = idOf(row);
    if (!id || !tree || !Array.isArray(tree.summaryIds)) return false;
    return tree.summaryIds.indexOf(id) !== -1;
  }

  /**
   * The chargeable leaves of a task list, in the order Fusion returned them
   * (the endpoint is ordered by TaskNumber, so the result stays in WBS order).
   *
   * Classifies internally when no tree is supplied, so a caller that only wants
   * the list does not have to hold one.
   */
  function leafTasks(source, tree) {
    var rows = itemsOf(source);
    var t = tree || buildTaskTree(rows);
    return rows.filter(function (row) {
      return !isSummaryTask(row, t);
    });
  }

  return {
    buildTaskTree: buildTaskTree,
    isSummaryTask: isSummaryTask,
    leafTasks: leafTasks
  };
});
