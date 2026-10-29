define(['ojs/ojarraydataprovider'], (ArrayDataProvider) => {
  'use strict';

  // Human labels for RBAC_PAGES.MODULE_CODE, used as the grid's group headers.
  // Mirrors the nav group labels in app-flow.js so the Admin screen reads in
  // the same vocabulary as the drawer it controls.
  const MODULE_LABELS = {
    ADMINISTRATOR: 'Administrator',
    PROJECT_REQUESTOR: 'Project Requestor',
    EQUIP_MANAGER: 'Equipment Manager',
    TIME_KEEPER: 'Time Keeper',
    COSTING: 'Costing',
    AGREEMENT_MGR: 'Agreement Manager',
    ANALYTICS: 'Analytics',
    CUSTOMER: 'Customer'
  };

  const LEVELS = ['FULL', 'READ_ONLY', 'HIDDEN'];

  class PageModule {

    /**
     * Effective level for a row: the pending edit if there is one, else the
     * value last loaded from the server. Every level control binds to this, so
     * the grid shows edits immediately without matrixArray ever being mutated.
     * @returns {string} FULL | READ_ONLY | HIDDEN
     */
    effectiveLevel(dirtyMap, pageCode, serverLevel) {
      const d = dirtyMap || {};
      return d[pageCode] || serverLevel || 'HIDDEN';
    }

    /** True when this row differs from what the server holds. */
    isRowDirty(dirtyMap, pageCode) {
      return !!(dirtyMap || {})[pageCode];
    }

    /**
     * Row classes for one page row. Returned as a string rather than set in the
     * template because the dirty highlight has to be re-evaluated whenever
     * dirtyMap changes, and a :class binding on a computed string is the only
     * form that re-runs inside oj-bind-for-each.
     */
    rowClass(dirtyMap, pageCode) {
      return this.isRowDirty(dirtyMap, pageCode)
        ? 'rbac-row rbac-row-dirty'
        : 'rbac-row';
    }

    /** Count of pending changes — drives the Save button label and enablement. */
    dirtyCount(dirtyMap) {
      return Object.keys(dirtyMap || {}).length;
    }

    /** Save button label, so the user can see how much is pending. */
    saveLabel(dirtyMap) {
      const n = this.dirtyCount(dirtyMap);
      return n ? 'Save ' + n + ' change' + (n === 1 ? '' : 's') : 'Save';
    }

    /** Display label for a module code; falls back to the raw code. */
    moduleLabel(code) {
      return MODULE_LABELS[code] || code || 'Other';
    }

    /**
     * True when this row is the first of its module, so the template can emit
     * a group header. Relies on matrixArray being ordered by sortOrder, which
     * loadMatrixChain guarantees.
     */
    isFirstOfModule(matrixArray, index) {
      const rows = matrixArray || [];
      if (index <= 0) {
        return true;
      }
      const prev = rows[index - 1];
      const cur = rows[index];
      return !!(prev && cur && prev.moduleCode !== cur.moduleCode);
    }

    /** The three selectable levels, for the per-row control. */
    levelOptions() {
      return LEVELS.map(function (v) {
        return { value: v, label: v === 'READ_ONLY' ? 'Read only' : (v === 'FULL' ? 'Full' : 'Hidden') };
      });
    }

    /** Row is not editable when the backend marked it locked. */
    isRowLocked(row) {
      return !!(row && row.isLocked === 'Y');
    }

    /**
     * Wraps the role list for oj-select-single. Keyed by appRoleId, which is
     * what the picker's value binds to and what every save is scoped by.
     */
    rolesDP(rolesArray) {
      return new ArrayDataProvider(rolesArray || [], { keyAttributes: 'appRoleId' });
    }
  }

  return PageModule;
});
