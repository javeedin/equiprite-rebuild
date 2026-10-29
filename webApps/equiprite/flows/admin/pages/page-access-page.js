define([], () => {
  'use strict';

  // Page access (FDD 10.3; replaces setup/rbac-admin). The same page x role matrix, saved the same way (one PUT
  // /rbac/page-access per Save, dirty rows only, scoped to the selected role). New here: search, the consequence of
  // the pending changes in words, and a read-only preview of the menu the role gets, computed by the app's own
  // visibleNavGroups / getRoleHomeTarget from the matrix (nothing is written to try it).
  //
  // effectiveLevel, isRowDirty, dirtyCount, saveLabel, moduleLabel, isFirstOfModule and isRowLocked are the old
  // page module's (rbac-admin-page.js), unchanged.

  // Human labels for RBAC_PAGES.MODULE_CODE (the old page's map).
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

  const LEVELS = [
    { value: 'FULL', label: 'Full', hint: 'Open and change' },
    { value: 'READ_ONLY', label: 'Read only', hint: 'Open, no changes' },
    { value: 'HIDDEN', label: 'Hidden', hint: 'Not in the menu, not by link' },
  ];
  const LEVEL_LABEL = { FULL: 'Full', READ_ONLY: 'Read only', HIDDEN: 'Hidden' };

  class PageModule {
    /** Effective level for a row: the pending edit if there is one, else the value last loaded from the server. */
    effectiveLevel(dirtyMap, pageCode, serverLevel) {
      const d = dirtyMap || {};
      return d[pageCode] || serverLevel || 'HIDDEN';
    }

    /** True when this row differs from what the server holds. */
    isRowDirty(dirtyMap, pageCode) {
      return !!(dirtyMap || {})[pageCode];
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

    /** True when this row is the first of its module (rows ordered by sortOrder, as loadMatrixChain leaves them). */
    isFirstOfModule(matrixArray, index) {
      const rows = matrixArray || [];
      if (index <= 0) {
        return true;
      }
      const prev = rows[index - 1];
      const cur = rows[index];
      return !!(prev && cur && prev.moduleCode !== cur.moduleCode);
    }

    /** Row is not editable when the backend marked it locked. */
    isRowLocked(row) {
      return !!(row && row.isLocked === 'Y');
    }

    // ── New ───────────────────────────────────────────────────────────

    levels() {
      return LEVELS.slice();
    }

    levelLabel(level) {
      return LEVEL_LABEL[level] || level || '';
    }

    /** Rows matching the search (label or code), each with `first` = starts a module group in this list. */
    visibleRows(matrixArray, text) {
      const q = String(text || '').trim().toLowerCase();
      const rows = (matrixArray || []).filter((r) => !q
        || String(r.pageLabel || '').toLowerCase().includes(q) || String(r.pageCode || '').toLowerCase().includes(q)
        || this.moduleLabel(r.moduleCode).toLowerCase().includes(q));
      return rows.map((r, i) => Object.assign({}, r, { first: this.isFirstOfModule(rows, i) }));
    }

    /** { PAGE_CODE: level } for the role as saved. */
    savedMap(matrixArray) {
      const out = {};
      (matrixArray || []).forEach((r) => { if (r && r.pageCode) out[r.pageCode] = r.accessLevel || 'HIDDEN'; });
      return out;
    }

    /** { PAGE_CODE: level } for the role with the pending edits applied: what Save would leave. */
    effectiveMap(matrixArray, dirtyMap) {
      const out = this.savedMap(matrixArray);
      Object.keys(dirtyMap || {}).forEach((k) => { out[k] = dirtyMap[k]; });
      return out;
    }

    previewMap(matrixArray, dirtyMap, mode) {
      return mode === 'saved' ? this.savedMap(matrixArray) : this.effectiveMap(matrixArray, dirtyMap);
    }

    /** "8 full · 3 read only · 12 hidden" with the pending edits. */
    levelCounts(matrixArray, dirtyMap) {
      const map = this.effectiveMap(matrixArray, dirtyMap);
      const n = { FULL: 0, READ_ONLY: 0, HIDDEN: 0 };
      Object.keys(map).forEach((k) => { n[map[k]] = (n[map[k]] || 0) + 1; });
      return `${n.FULL} full · ${n.READ_ONLY} read only · ${n.HIDDEN} hidden`;
    }

    /** The pending edits in words: "Analytics: Full → Hidden". */
    changes(matrixArray, dirtyMap) {
      const byCode = {};
      (matrixArray || []).forEach((r) => { byCode[r.pageCode] = r; });
      return Object.keys(dirtyMap || {}).map((code) => {
        const r = byCode[code] || {};
        return { code, label: r.pageLabel || code, from: this.levelLabel(r.accessLevel || 'HIDDEN'), to: this.levelLabel(dirtyMap[code]) };
      });
    }

    /** Menu item labels of visibleNavGroups output, flattened. */
    menuItems(groups) {
      return [].concat(...(groups || []).map((g) => (g.items || []).map((i) => ({ id: i.id, label: i.label, pageCodes: i.pageCodes || [] }))));
    }

    /**
     * What Save changes in the role's New EquipRite menu: { added: [labels], removed: [labels] }, from the menu as
     * saved and the menu with the edits (both from the app's visibleNavGroups).
     */
    menuDiff(savedGroups, pendingGroups) {
      const before = this.menuItems(savedGroups);
      const after = this.menuItems(pendingGroups);
      const had = {};
      const has = {};
      before.forEach((i) => { had[i.id] = i.label; });
      after.forEach((i) => { has[i.id] = i.label; });
      return {
        added: after.filter((i) => !had[i.id]).map((i) => i.label),
        removed: before.filter((i) => !has[i.id]).map((i) => i.label),
      };
    }

    /** One sentence for the unsaved bar: what the role gains and loses in the menu. */
    consequence(roleName, savedGroups, pendingGroups) {
      const d = this.menuDiff(savedGroups, pendingGroups);
      const who = roleName || 'This role';
      const parts = [];
      if (d.added.length) parts.push(`gains ${d.added.join(', ')}`);
      if (d.removed.length) parts.push(`loses ${d.removed.join(', ')}`);
      if (!parts.length) return `${who}'s menu stays the same; only what can be changed on the pages differs.`;
      return `${who} ${parts.join(' and ')} in the menu.`;
    }

    /** An item is read only for the role when none of its page codes is FULL and at least one is READ_ONLY. */
    itemReadOnly(item, map) {
      const codes = (item && item.pageCodes) || [];
      const m = map || {};
      return !codes.some((c) => m[c] === 'FULL') && codes.some((c) => m[c] === 'READ_ONLY');
    }

    /** { PAGE_CODE: 'FULL' } for one code, to ask visibleNavGroups which items that code alone opens. */
    singleMap(pageCode) {
      const m = {};
      if (pageCode) m[pageCode] = 'FULL';
      return m;
    }

    /** "Analytics, Configuration" or "Not in New EquipRite's menu". */
    usedByText(groups) {
      const labels = this.menuItems(groups).map((i) => i.label);
      return labels.length ? 'New menu: ' + labels.join(', ') : 'Not in New EquipRite\'s menu (Old EquipRite only)';
    }

    /** Where the role lands after sign-in, in words, from getRoleHomeTarget's { flow, page, params }. */
    landingLabel(target, appFns) {
      const t = target || {};
      if (t.page === 'no-access') return 'the No access page (it can open nothing)';
      if (t.page === 'home') return 'Home';
      const navId = (t.params && t.params.navId) || (appFns && appFns.getNavIdForPage ? appFns.getNavIdForPage({ id: t.page }) : '');
      const it = navId && appFns && appFns.navItem ? appFns.navItem(navId) : null;
      return (it && it.label) || t.page || '';
    }

    roleName(rolesArray, roleId) {
      const r = (rolesArray || []).find((x) => Number(x.appRoleId) === Number(roleId));
      return (r && (r.roleName || r.roleCode)) || '';
    }
  }

  return PageModule;
});
