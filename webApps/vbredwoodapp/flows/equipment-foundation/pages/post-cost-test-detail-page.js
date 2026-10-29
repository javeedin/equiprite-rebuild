define(['ojs/ojarraydataprovider'], (ArrayDataProvider) => {
  'use strict';

  /*
   * Post Cost Test — detail page module.
   *
   * IMPORTANT (learned from this app's own pages, e.g. equipment-returns /
   * line-detail): page-module functions CANNOT reliably read or WRITE
   * $page.variables. So all state mutation happens in ACTION CHAINS (which get
   * $page via context); the module holds only pure, stateless helpers used by
   * templates (stopEvent, formatting). The interaction pattern mirrors
   * equipment-returns-page: raw checkbox with on-click=stopEvent +
   * on-change=$listeners.xxx, and the chain reads the id off event.target.
   */
  class PageModule {
    // Stop the table from hijacking the checkbox/chevron click (proven pattern).
    stopEvent(event) {
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
    }

    /**
     * THE single visibility rule for the row tree. Pure: takes the full row set,
     * returns what should render.
     *
     *   group     → always
     *   week      → its group is expanded
     *   split     → its group is expanded (same rule as its week)
     *   miscGroup → its group is expanded (the "Misc charges (N)" header)
     *   misc      → its group AND its miscGroup are expanded
     *   day       → its group AND its own week are expanded
     *
     * A split row follows the WEEK rule, not the day rule, on purpose. Gating it
     * on weekExpanded would put it behind the same expander the blackout day
     * rows use, so opening "Exclude days" would reveal days AND slices together
     * and a split would be invisible until someone thought to expand. The whole
     * point of the slice rows is that a re-pointed week is visible at a glance.
     *
     * Misc charges sit behind their own expander rather than intermixing with the
     * weeks: an equipment's weeks are a period breakdown, its charges are not, and
     * a long rental would otherwise bury them at the bottom of a 20-row list.
     *
     * Extracted here because this filter was previously inlined in SEVEN chains,
     * in TWO different versions — four handled day rows, three stopped at
     * `g && g.expanded`, which made day rows appear whenever a week checkbox was
     * ticked even with the week collapsed. Adding a fifth row kind to seven
     * copies is how the list/detail views drifted; one function cannot drift.
     */
    visibleRows(all) {
      const rows = all || [];
      return rows.filter(function (row) {
        if (row.kind === 'group') return true;
        const g = rows.find(function (x) { return x.kind === 'group' && x.groupKey === row.groupKey; });
        if (!g || !g.expanded) return false;
        if (row.kind === 'week' || row.kind === 'split' || row.kind === 'miscGroup') return true;
        if (row.kind === 'misc') {
          const mg = rows.find(function (x) { return x.kind === 'miscGroup' && x.rowKey === row.miscGroupKey; });
          return !!(mg && mg.miscExpanded);
        }
        const w = rows.find(function (x) { return x.kind === 'week' && x.rowKey === row.weekKey; });
        return !!(w && w.weekExpanded);
      });
    }

    /**
     * Re-stamp every group row's rollup state after any change to its children.
     * Also pure. `cost` on a group row is rental weeks PLUS its misc charges, so
     * the equipment total stays truthful the moment a charge is added.
     */
    restampGroups(all) {
      const rows = all || [];
      return rows.map(function (r) {
        // The "Misc charges (N)" header owns a count and a total of its own. Restamp
        // it here too, or deleting a charge leaves the collapsed header advertising
        // money that is no longer underneath it.
        if (r.kind === 'miscGroup') {
          const mine = rows.filter(function (x) { return x.kind === 'misc' && x.miscGroupKey === r.rowKey; });
          return Object.assign({}, r, {
            miscCount: mine.length,
            cost: Math.round(mine.reduce(function (s, x) { return s + Number(x.cost || 0); }, 0) * 100) / 100
          });
        }
        if (r.kind !== 'group') return r;
        const wk = rows.filter(function (x) {
          return x.kind === 'week' && x.groupKey === r.groupKey && x.postable && !x.posted && !x.reversed;
        });
        const misc = rows.filter(function (x) { return x.kind === 'misc' && x.groupKey === r.groupKey; });
        const weekCost = rows
          .filter(function (x) { return x.kind === 'week' && x.groupKey === r.groupKey && !x.reversed; })
          .reduce(function (s, x) { return s + Number(x.cost || 0); }, 0);
        const miscCost = misc.reduce(function (s, x) { return s + Number(x.cost || 0); }, 0);
        const hasP = wk.length > 0;
        return Object.assign({}, r, {
          hasPostable: hasP,
          allSelected: hasP && wk.every(function (x) { return x.selected; }),
          miscCount: misc.length,
          cost: Math.round((weekCost + miscCost) * 100) / 100
        });
      });
    }

    // Label for a saved misc charge. The comment is what a human actually wrote,
    // so it leads; expenditure type is already shown as the badge in its own column.
    miscLabel(m) {
      if (!m) return 'Miscellaneous charge';
      const parts = [];
      // Lead with what the person actually typed. The expenditure type is ALREADY the
      // badge in the Rate Type column, so repeating it here printed the same word twice
      // on one row ("EQUIPMENT | Equipment · Applications and Services"). When there is
      // no comment, say so plainly rather than padding the row with the type again —
      // Comments travels to Fusion, so an empty one is worth noticing.
      parts.push(m.comments ? String(m.comments).slice(0, 60) : 'No description');
      if (Number(m.quantity) > 1) parts.push('qty ' + Number(m.quantity));
      if (m.expenditureOrg) parts.push(m.expenditureOrg);
      return parts.join('  ·  ');
    }

    /**
     * Build the provider for the two expenditure-type pickers from the plain array
     * vbEnterChain loads. Same shape and same reason as the PR flow's getExpTypeLOV
     * (request-detail-page.js:946): this is THE supported way to back an
     * oj-select-single with a list fetched at runtime. A vb/ArrayDataProvider2 page
     * variable cannot just be swapped for a fresh list -- VBCS tracks it by
     * reference, so reassigning it breaks the binding. Rebuilds whenever the array
     * reference changes.
     */
    getExpTypeLOV(list) {
      var items = Array.isArray(list) ? list : [];
      return new ArrayDataProvider(items, { keyAttributes: 'value' });
    }

    /**
     * Post-cost detail table columns, built dynamically so:
     *  - P3: the "Total Hours" column is HIDDEN when timesheets are OFF
     *    (meaningless without time entry). `showHours` = the resolved flag.
     *  - P1: "When" is renamed to "Status" (cost-line status: Draft / In Progress
     *    / Future / Early Return / Posted).
     *  - P2: a "Days" column (actual billed rental days) shown ALWAYS.
     *  - P4: an "Expenditure Type" column — the PPM classification this
     *    equipment's cost posts under. Sits between the pricing cluster
     *    (Rate Type / Applicable Rate / Rate Tier) and the lifecycle/money
     *    cluster (Status / Cost), because it is neither: it classifies the
     *    money rather than deriving it.
     * Called from the HTML with isFeatureEnabled(...,'TIMESHEETS_ENABLED'), which
     * is TRUE only when the flag is loaded AND === 'true'. So Total Hours shows
     * only when timesheets are explicitly ON; it is hidden when OFF (the demo
     * config) and also while flags are still loading (harmless — CP hours are 0,
     * and the column re-appears if the flag resolves to ON).
     */
    postCostDetailColumns(timesheetsEnabled) {
      const showHours = timesheetsEnabled === true;   // show only when explicitly ON
      const cols = [
        { headerText: 'Equipment / Week', field: 'label',      template: 'labelTpl',    minWidth: '380', weight: 4 },
        { headerText: 'Rate Type',        field: 'rateType',   template: 'rateTypeTpl', minWidth: '110', weight: 1 },
        { headerText: 'Applicable Rate',  field: 'rateText',   template: 'rateTextTpl', minWidth: '150', weight: 1 },
        { headerText: 'Rate Tier',        field: 'ratePeriod', template: 'periodTpl',   minWidth: '110', weight: 1 },
        { headerText: 'Days',             field: 'days',       template: 'daysTpl',     minWidth: '80',  weight: 1 }
      ];
      if (showHours) {
        cols.push({ headerText: 'Total Hours', field: 'hours', template: 'hoursTpl', minWidth: '100', weight: 1 });
      }
      cols.push(
        // Where the money actually GOES. Sits next to Expenditure Type because the
        // two together are the whole PPM classification of a row.
        //
        // Needs no backend column: every row that is not split posts to the
        // REQUEST's own project (the queue view resolves
        // NVL(pw.project_number, eer.project_number)), and the page already holds
        // that from its fromUrl variables. Only a split week differs, and it
        // carries its own slices.
        { headerText: 'Project / Task', field: 'projectLabel', template: 'projectTpl', minWidth: '200', weight: 1 },
        { headerText: 'Expenditure Type', field: 'expenditureType', template: 'expTypeTpl', minWidth: '150', weight: 1 },
        { headerText: 'Status', field: 'whenTag', template: 'whenTpl', minWidth: '100', weight: 1 },
        { headerText: 'Cost',   field: 'cost',    template: 'costTpl', minWidth: '110', weight: 1 }
      );
      return cols;
    }

    /**
     * Label for the Expenditure Type cell on an equipment row.
     *
     * Deliberately NOT "Equipment" when unset. The queue view's backstop does
     * default an unset line to 'Equipment' at post time, so showing that word
     * here would be truthful about the outcome but would hide the fact that
     * nobody has chosen — and the whole point of this column is to make the
     * unchosen ones visible. "Set type" is the call to action; the drawer shows
     * what the fallback will be if you leave it.
     */
    expTypeLabel(row) {
      if (!row) return '';
      // A group is keyed by equipment NAME and can span two request lines. If they
      // carry different authored types, say so rather than showing one of them --
      // the drawer patches every line in the group, so opening it IS the fix.
      if (row.expenditureTypeMixed) return 'Mixed — set one';
      return row.expenditureType ? String(row.expenditureType) : 'Set type';
    }

    // ── project split ────────────────────────────────────────────────────────
    //
    // A split divides ONE equipment's cost across 2+ projects by percentage. It
    // is authored on the request LINE and inherited by every not-yet-posted
    // week; each week freezes its own copy into EQR_POSTED_WEEK at post time,
    // exactly as EXPENDITURE_TYPE does. So the control lives on the equipment
    // (group) row, and these helpers describe a group.
    //
    // Everything here is PURE. The percentage arithmetic is deliberately done in
    // BASIS POINTS (see splitPctTotal) and there is deliberately no dollar math
    // anywhere in this module -- the server apportions (largest remainder) so
    // that the slice amounts are guaranteed to sum to the week amount by the
    // same transaction that inserts them. Doing it here would put cost math in
    // the client, which this page's write path forbids, and would disagree with
    // the server by a cent on exactly the splits people scrutinise.

    /**
     * Percentage total of a slice list, in BASIS POINTS (100% -> 10000).
     *
     * Integer arithmetic, on purpose. `slices.reduce((s,x) => s + x.pct, 0) === 100`
     * is WRONG, and wrong often: of the 49,985,001 three-slice combinations that
     * sum to exactly 100.00, **8.55% do not compare equal to 100 as floats** —
     * e.g. 5 + 63.02 + 31.98 is 100.00000000000001, and 5 + 63.01 + 31.99 is
     * 99.99999999999999. So a naive check refuses roughly one correct three-way
     * split in twelve, unreproducibly from the user's point of view. (Two slices
     * never drift, which is exactly why this would survive testing and then bite.)
     * Rounding each slice to basis points first and comparing integers cannot do
     * that. Measured with a full scan, not assumed.
     *
     * One function owns this so the drawer's live "N% short" banner and the save
     * chain's guard can never disagree about what adds up to 100.
     */
    splitPctTotal(slices) {
      const list = Array.isArray(slices) ? slices : [];
      return list.reduce(function (sum, s) {
        const pct = s && s.pct != null ? Number(s.pct) : 0;
        return sum + (isFinite(pct) ? Math.round(pct * 100) : 0);
      }, 0);
    }

    /**
     * THE validation rule for a split, as a single message (or '' when valid).
     *
     * Called from BOTH the drawer's error banner and saveSplitChain's guard, so
     * "the Apply button is enabled" and "the save is allowed" are literally the
     * same expression. First failure wins -- showing seven problems at once for
     * a five-field form reads as noise.
     */
    splitFormError(slices, minSlices, maxSlices) {
      const list = Array.isArray(slices) ? slices : [];
      const min = minSlices || 2;
      const max = maxSlices || 5;

      // One slice is whole-equipment reallocation, which is out of scope -- and
      // the queue view's NVL would silently honour it, moving ALL of this
      // equipment's cost to that project. Refuse it here rather than let the
      // backend's own guard be the only thing standing in the way.
      if (list.length < min) {
        return 'A split needs at least ' + min + ' projects. Add another, or close '
             + "without saving to leave this equipment on the request's project.";
      }
      if (list.length > max) {
        return 'A split can cover at most ' + max + ' projects.';
      }
      for (let i = 0; i < list.length; i++) {
        const s = list[i] || {};
        if (!s.projectRefId) return 'Every line in the split needs a project.';
        // A project without a task cannot post: PPM rejects the pair at cost
        // import, days later and three systems from the cause.
        if (!s.taskId) {
          return 'Every line in the split needs a task. PPM can only take cost on a '
               + 'lowest-level task.';
        }
        if (s.pct == null || !(Number(s.pct) > 0)) {
          return 'Every project needs a percentage greater than zero.';
        }
      }
      // (projectRefId, taskId) is the ledger's slice identity -- it is what the
      // deterministic REVERSAL_REF is built from and what the unique index keys
      // on -- so two slices sharing it would collide on insert, and Fusion would
      // net them anyway.
      const seen = {};
      for (let i = 0; i < list.length; i++) {
        const s = list[i] || {};
        const key = String(s.projectRefId) + ':' + String(s.taskId);
        if (seen[key]) {
          return 'Project ' + (s.projectNumber || s.projectRefId) + ' / task '
               + (s.taskNumber || s.taskId) + ' appears twice. Combine them into one '
               + 'percentage.';
        }
        seen[key] = 1;
      }
      const bp = this.splitPctTotal(list);
      if (bp !== 10000) {
        const shown = (bp / 100).toFixed(2).replace(/\.00$/, '');
        const gap = Math.abs(10000 - bp) / 100;
        const gapShown = gap.toFixed(2).replace(/\.00$/, '');
        return 'Percentages must add up to 100%. They currently total ' + shown + '% — '
             + gapShown + '% ' + (bp < 10000 ? 'short' : 'over') + '.';
      }
      return '';
    }

    /** Group-row text: '' when unsplit (the caller renders the call to action). */
    splitLabel(row) {
      if (!row || !row.splitCount) return '';
      if (row.splitMixed) return 'Split — mixed, set one';
      const pcts = Array.isArray(row.splitPcts) ? row.splitPcts : [];
      // Beyond three the badge stops being readable in a table cell and the
      // title attribute carries the detail instead.
      if (pcts.length && pcts.length <= 3) {
        return 'Split ' + pcts.map(function (p) {
          return String(Number(p)).replace(/\.0+$/, '');
        }).join(' / ');
      }
      return 'Split across ' + row.splitCount + ' projects';
    }

    /** Hover detail for a WEEK badge: one line per slice. */
    splitTitle(row) {
      if (!row) return '';
      // Group row: summarise which weeks are split rather than which projects,
      // because two weeks of the same equipment can be split differently.
      if (row.kind === 'group') {
        const weeks = Array.isArray(row.splitWeekLabels) ? row.splitWeekLabels : [];
        return weeks.length ? ('Split: ' + weeks.join('\n       ')) : '';
      }
      if (!Array.isArray(row.splits) || !row.splits.length) return '';
      const lines = row.splits.map(function (s) {
        return (s.projectNumber || s.projectRefId || '?')
             + ' — ' + String(Number(s.splitPct != null ? s.splitPct : s.pct)) + '%'
             + (s.taskNumber ? ('  ·  task ' + s.taskNumber) : '');
      });
      return lines.join('\n');
    }

    /**
     * The Project / Task cell, as a list of lines to render.
     *
     * One line per destination. A split week has one per slice; everything else
     * has exactly one -- the REQUEST's own project, which is where any row
     * without a split posts (the queue view resolves NVL(pw.project_number,
     * eer.project_number)). That is why this column needs no new backend field.
     *
     * `inherited: true` marks the request's own project, so the template can
     * render it muted: it is the default destination, not a decision anybody
     * made about this row. A split's slices are choices, and render normally.
     *
     * Nothing here says whether a split is persisted. That distinction lives on
     * the ROW as splitPersisted, where postSelectedChain reads it; it is
     * deliberately not surfaced in the UI, which is demoed.
     *
     * Each line carries BOTH the name and the number. The template shows the
     * NAMES, because that is what a person reads -- but the NUMBERS are what
     * actually post to Fusion (`_PROJECT_ID_Display` / `_TASK_ID_Display`), so
     * they are kept and surfaced in the cell's tooltip rather than dropped.
     *
     * The header values are passed IN as one object rather than read from
     * $page.variables -- page-module functions cannot reliably read them (see
     * the module header) -- and as an object rather than four positional
     * arguments, which would be easy to transpose silently.
     */
    projectCells(row, hdr) {
      if (!row) return [];
      const h = hdr || {};
      // Day rows sit under a week and share its destination; repeating it on
      // every day would triple the noise for no new information.
      if (row.kind === 'day') return [];

      // A SPLIT row is one destination -- its own.
      if (row.kind === 'split') {
        const p = Number(row.splitPct);
        return [{
          project: row.projectNumber || String(row.projectRefId || ''),
          projectName: row.projectName || '',
          task: row.taskNumber || '',
          taskName: row.taskName || '',
          pct: isFinite(p) ? p : null,
          inherited: false,
        }];
      }

      // An EQUIPMENT whose weeks are split must not name one project.
      //
      // Its cost cell is the sum of its weeks, and once any week is split that
      // sum spans projects -- so printing the request's own project there is a
      // false claim about where the money goes. Seen live: an equipment showing
      // $3,180 against "EPC_ MO_Operations" when only $1,590 of it went there
      // and $1,590 went to another project entirely.
      //
      // "Multiple projects" is true whether every week is split or only one, and
      // the per-week rows below give the detail.
      if (row.kind === 'group' && Number(row.splitWeekCount || 0) > 0) {
        return [{ project: '', projectName: 'Multiple projects', task: '', taskName: '',
                  pct: null, inherited: true, multiple: true }];
      }

      // A split WEEK says nothing here: its slice rows underneath carry the
      // destinations. Listing them on the week as well would put the same two
      // projects on screen twice, three rows apart -- the duplication this
      // page's own comments call out ("two copies of the same number on one
      // screen is one copy too many").
      const splits = Array.isArray(row.splits) ? row.splits : [];
      if (row.kind === 'week' && splits.length >= 2) return [];

      const proj = h.projectNumber ? String(h.projectNumber) : '';
      if (!proj) return [];
      return [{
        project: proj,
        projectName: h.projectName ? String(h.projectName) : '',
        task: h.taskNumber ? String(h.taskNumber) : '',
        taskName: h.taskName ? String(h.taskName) : '',
        pct: null,
        inherited: true,
      }];
    }

    /**
     * Derive the visible SPLIT rows: one per slice, under each split week.
     *
     * A split week keeps its own row -- it is still the selectable, postable unit
     * and still carries the week's whole cost, which is what the group total sums
     * and what one post call sends. The slice rows beneath it are a BREAKDOWN,
     * deliberately subordinate: no checkbox, no status, and dashes in every column
     * that describes the rental rather than the allocation.
     *
     * Cost and hours are split; DAYS is not. The equipment was on site seven days
     * whichever project pays for it -- "4.2 days" would be a fabricated fact.
     * Cost and hours are the things actually being apportioned.
     *
     * Idempotent: existing split rows are stripped and rebuilt, so this can be
     * called after any mutation without accumulating duplicates.
     *
     * kind 'split' is safe to add because every other consumer filters on
     * kind === 'week' explicitly -- restampGroups sums weeks (so the group total
     * cannot double-count), and selectAllPast / toggleGroupSelect /
     * postSelectedChain all ignore anything that is not a week.
     */
    splitRows(all) {
      const rows = (all || []).filter(function (r) { return r.kind !== 'split'; });
      const out = [];
      rows.forEach(function (r) {
        out.push(r);
        if (r.kind !== 'week') return;
        const splits = Array.isArray(r.splits) ? r.splits : [];
        if (splits.length < 2) return;
        const weekCost = Number(r.cost || 0);
        const weekHours = Number(r.hours || 0);
        splits.forEach(function (s, i) {
          const pct = Number(s.splitPct != null ? s.splitPct : s.pct);
          const share = isFinite(pct) ? pct / 100 : 0;
          out.push({
            kind: 'split',
            // Unique, and derived from the week's key so it is stable across
            // rebuilds -- the table keys rows on this.
            rowKey: r.rowKey + ':S' + i,
            groupKey: r.groupKey,
            weekKey: r.rowKey,
            label: r.label,
            splitPct: isFinite(pct) ? pct : null,
            projectRefId: s.projectRefId,
            projectNumber: s.projectNumber,
            projectName: s.projectName,
            taskId: s.taskId,
            taskNumber: s.taskNumber,
            taskName: s.taskName,
            splitPersisted: r.splitPersisted,
            cost: Math.round(weekCost * share * 100) / 100,
            hours: Math.round(weekHours * share * 100) / 100,
            // Dashed in the UI. rateType '' is what the existing templates
            // already read as "nothing to say here".
            rateType: '',
            days: null,
            // Never independently selectable or postable: the week posts as one
            // call and the server apportions it.
            postable: false,
            posted: !!r.posted,
            reversed: !!r.reversed,
            selected: false,
            notStarted: !!r.notStarted,
          });
        });
      });
      return out;
    }

    /**
     * Everything derived from splits, in one call: the per-slice rows, each
     * group's "N weeks split" rollup, and the Project/Task sort key.
     *
     * ONE function because three chains (vbEnter, saveSplit, clearSplit) all need
     * the same three things after touching a split. Three call sites each doing
     * three steps in the right order is how the row tree drifts -- the same
     * reasoning that put visibleRows() here.
     */
    applySplitDerived(all, hdr) {
      const self = this;
      const withRows = this.splitRows(this.splitRollup(all));
      return withRows.map(function (r) {
        if (r.kind === 'day') return r;
        return Object.assign({}, r, { projectLabel: self.projectLabelOf(r, hdr) });
      });
    }

    /**
     * The single sortable string behind the Project / Task column.
     *
     * Derived from projectCells() rather than re-deriving the rule, so the sort
     * key can never disagree with what the cell actually shows -- the mistake
     * that would otherwise appear the moment a split is applied in place and
     * only one of the two was restamped. A split week sorts under its first
     * destination.
     */
    projectLabelOf(row, hdr) {
      const cells = this.projectCells(row, hdr);
      if (!cells.length) return '';
      const c = cells[0];
      // Sorts on what is DISPLAYED -- the names -- falling back to the numbers
      // when a name is missing, so the column never sorts on something invisible.
      const proj = c.projectName || c.project;
      const task = c.taskName || c.task;
      return proj + (task ? (' / ' + task) : '');
    }

    /**
     * Recompute every equipment row's "N weeks split" rollup from its week rows.
     *
     * Lives here, not in a chain, for the reason visibleRows() was extracted:
     * saveSplitChain and clearSplitChain both need it, and two copies of a
     * derivation like this drift. Pure -- takes rows, returns rows.
     *
     * Pass a groupKey to restamp one equipment, or omit it to restamp all (which
     * is what vbEnterChain wants after a fresh read).
     */
    splitRollup(rowsAll, groupKey) {
      const rows = Array.isArray(rowsAll) ? rowsAll : [];
      const byGroup = {};
      rows.forEach(function (r) {
        if (r.kind !== 'week') return;
        if (!Array.isArray(r.splits) || !r.splits.length) return;
        const pcts = r.splits.map(function (s) {
          return String(Number(s.splitPct != null ? s.splitPct : s.pct));
        });
        (byGroup[r.groupKey] = byGroup[r.groupKey] || [])
          .push((r.label || '') + '  —  ' + pcts.join(' / ') + '%');
      });
      return rows.map(function (r) {
        if (r.kind !== 'group') return r;
        if (groupKey != null && r.groupKey !== groupKey) return r;
        const labels = byGroup[r.groupKey] || [];
        return Object.assign({}, r, {
          splitWeekCount: labels.length,
          splitWeekLabels: labels
        });
      });
    }

    /**
     * Group-row rollup. A split is authored per WEEK, so the equipment row can
     * only say HOW MANY of its weeks are split -- naming projects there would be
     * wrong the moment two weeks are split differently, which is exactly the
     * case week-level authoring exists to allow.
     *
     * It earns its place because an equipment collapses: without it, "3 of these
     * weeks post somewhere else" is invisible until you expand.
     */
    splitWeeksLabel(row) {
      const n = row ? Number(row.splitWeekCount || 0) : 0;
      if (!n) return '';
      return n === 1 ? '1 week split' : (n + ' weeks split');
    }

    /**
     * Trailing-edge debounce for the drawer's project typeahead. Copied VERBATIM
     * from request-detail-page.js so every Project LOV in the app behaves
     * identically — deliberately not "improved", because one page's typeahead
     * behaving differently from the other two is worse than the wrinkle below.
     *
     * What it actually does (checked, because the shared doc comment on the
     * original overstates it): the most recent call under `key` resolves to
     * `value`. A call SUPERSEDED inside the delay window **never settles at
     * all** — the next call clears its timer before it can fire, so the
     * `: null` branch is unreachable. The awaiting chain simply stops there,
     * which is the intended "drop this keystroke", but it does leave one
     * dangling promise per superseded keystroke. So: never rely on a null
     * resolution, and never await this anywhere that must run cleanup after.
     */
    debounce(key, value, delay) {
      if (!this._debounceState) this._debounceState = {};
      const state = this._debounceState;
      if (!state[key]) state[key] = { count: 0 };
      state[key].count++;
      const myCount = state[key].count;
      return new Promise((resolve) => {
        if (state[key].timer) clearTimeout(state[key].timer);
        state[key].timer = setTimeout(() => {
          resolve(state[key].count === myCount ? value : null);
        }, delay || 200);
      });
    }
  }

  return PageModule;
});
