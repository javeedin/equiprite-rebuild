define(['resources/js/nav'], function (nav) {
  'use strict';

  // Access in EquipRite Next: every role against every page in one matrix, saved exactly as New EquipRite's Page
  // access saves (flows/admin/pages/page-access-page-chains), one role at a time:
  //   GET  rbac/app-roles                         the roles; inactive ones (isActive 'N') left out
  //   GET  rbac/page-access-matrix?appRoleId=     one role's rows, kept to that role and ordered by sortOrder
  //   PUT  rbac/page-access                       { appRoleId, entries: [{ pageCode, accessLevel }] }, only the rows
  //                                               that changed, X-User-Id from the signed-in user
  // and New's rules for an edit (setLevelChain): FULL, READ_ONLY or HIDDEN only; a locked row (isLocked 'Y') never
  // changes; picking a row's saved level drops the pending edit. Pure: the chains call the services.
  //
  // What a change does is said before it is saved: per role, the levels from and to, and what that role gains and
  // loses in the menu (nav.visibleGroups on the levels as saved and as they would be, with the app's flags).

  var LEVELS = [
    { value: 'FULL', label: 'Full', hint: 'Open it and change things' },
    { value: 'READ_ONLY', label: 'Read only', hint: 'Open it, change nothing' },
    { value: 'HIDDEN', label: 'Hidden', hint: 'Not in the menu, not by link' }
  ];
  var VALID = { FULL: 1, READ_ONLY: 1, HIDDEN: 1 };
  var LEVEL_LABEL = { FULL: 'Full', READ_ONLY: 'Read only', HIDDEN: 'Hidden' };

  // RBAC_PAGES.MODULE_CODE in words (New's page-access page).
  var MODULE_LABELS = {
    ADMINISTRATOR: 'Administrator', PROJECT_REQUESTOR: 'Project Requestor', EQUIP_MANAGER: 'Equipment Manager', TIME_KEEPER: 'Time Keeper',
    COSTING: 'Costing', AGREEMENT_MGR: 'Agreement Manager', ANALYTICS: 'Analytics', CUSTOMER: 'Customer'
  };

  function rowsOf(body) { return Array.isArray(body) ? body : ((body && body.data) || []); }

  /** Active roles from GET rbac/app-roles (New's pageAccessInitChain). */
  function activeRoles(body) {
    return rowsOf(body).filter(function (r) { return r && r.isActive !== 'N'; });
  }

  /** One role's rows from GET rbac/page-access-matrix (New's loadMatrixChain): that role only, by sortOrder. */
  function roleRows(body, roleId) {
    var id = Number(roleId);
    return rowsOf(body).filter(function (r) { return r && Number(r.appRoleId) === id; })
      .sort(function (a, b) { return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0); });
  }

  function roleName(roles, roleId) {
    var r = (roles || []).filter(function (x) { return String(x.appRoleId) === String(roleId); })[0];
    return (r && (r.roleName || r.roleCode)) || String(roleId);
  }

  function levelLabel(level) { return LEVEL_LABEL[level] || level || ''; }
  function moduleLabel(code) { return MODULE_LABELS[code] || code || 'Other'; }

  /** { PAGE_CODE: level } for a role as saved. */
  function savedMap(rows) {
    var out = {};
    (rows || []).forEach(function (r) { if (r && r.pageCode) out[r.pageCode] = r.accessLevel || 'HIDDEN'; });
    return out;
  }

  /** { PAGE_CODE: level } with a role's pending edits: what Save would leave. */
  function effectiveMap(rows, dirty) {
    var out = savedMap(rows);
    Object.keys(dirty || {}).forEach(function (k) { out[k] = dirty[k]; });
    return out;
  }

  /**
   * New's setLevelChain for one role: the next pending edits, or the same object when the edit is refused.
   * rows: the role's rows as loaded; dirty: its pending edits { pageCode: level }.
   */
  function setLevel(rows, dirty, pageCode, level) {
    if (!pageCode || !level || !VALID[level]) return dirty || {};
    var row = (rows || []).filter(function (r) { return r && r.pageCode === pageCode; })[0];
    if (row && row.isLocked === 'Y') return dirty || {};
    var next = Object.assign({}, dirty || {});
    if (row && row.accessLevel === level) delete next[pageCode];
    else next[pageCode] = level;
    return next;
  }

  function count(dirtyByRole) {
    return Object.keys(dirtyByRole || {}).reduce(function (n, k) { return n + Object.keys(dirtyByRole[k] || {}).length; }, 0);
  }

  /** The Next menu items a page code opens on its own (whatever the flags), for "Opens in Next". */
  function opensInNext(pageCode) {
    var out = [];
    nav.GROUPS.forEach(function (g) {
      g.items.forEach(function (it) { if ((it.pageCodes || []).indexOf(pageCode) !== -1) out.push(it.label); });
    });
    return out;
  }

  /**
   * The matrix: one row per page (the order of the first role that lists it, then by sortOrder), a cell per role.
   * cell: { roleId, level (with the pending edit), saved, locked, dirty, missing }.
   */
  function matrix(roles, rowsByRole, dirtyByRole) {
    var pages = {};
    var order = [];
    (roles || []).forEach(function (role) {
      (rowsByRole[role.appRoleId] || []).forEach(function (r) {
        if (!r || !r.pageCode) return;
        if (!pages[r.pageCode]) {
          pages[r.pageCode] = { pageCode: r.pageCode, pageLabel: r.pageLabel || r.pageCode, moduleCode: r.moduleCode || '', sortOrder: Number(r.sortOrder) || 0 };
          order.push(r.pageCode);
        }
      });
    });
    var list = order.map(function (c) { return pages[c]; }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    return list.map(function (p) {
      var opens = opensInNext(p.pageCode);
      return Object.assign({}, p, {
        module: moduleLabel(p.moduleCode),
        opens: opens.length ? 'Opens ' + opens.join(', ') + ' in Next' : 'Not in Next\'s menu (Old and New only)',
        cells: (roles || []).map(function (role) {
          var row = (rowsByRole[role.appRoleId] || []).filter(function (r) { return r.pageCode === p.pageCode; })[0];
          var pending = ((dirtyByRole || {})[role.appRoleId] || {})[p.pageCode];
          var saved = row ? (row.accessLevel || 'HIDDEN') : '';
          return {
            key: role.appRoleId + ':' + p.pageCode, roleId: String(role.appRoleId), pageCode: p.pageCode, missing: !row,
            saved: saved, level: pending || saved, locked: !!row && row.isLocked === 'Y', dirty: !!pending,
            was: pending ? 'was ' + levelLabel(saved) : '',
            title: roleName(roles, role.appRoleId) + ' · ' + p.pageLabel + ': ' + (row ? levelLabel(pending || saved) + (pending ? ' (unsaved, was ' + levelLabel(saved) + ')' : '')
              + (row && row.isLocked === 'Y' ? '. Locked: it cannot be changed here.' : '') : 'not in this role\'s pages')
          };
        })
      });
    });
  }

  /** The rows to show: the search (page, code, module) and Changed only; each knows if it starts a module. */
  function visible(rows, text, only) {
    var q = String(text || '').trim().toLowerCase();
    var out = (rows || []).filter(function (r) {
      if (only === 'changed' && !r.cells.some(function (c) { return c.dirty; })) return false;
      if (only === 'locked' && !r.cells.some(function (c) { return c.locked; })) return false;
      return !q || [r.pageLabel, r.pageCode, r.module, r.opens].some(function (v) { return String(v || '').toLowerCase().indexOf(q) !== -1; });
    });
    return out.map(function (r, i) { return Object.assign({}, r, { first: i === 0 || out[i - 1].moduleCode !== r.moduleCode }); });
  }

  function menuItems(groups) {
    var out = {};
    // Items for everyone (no page code, e.g. EquipRite FDD) follow the role's other screens, so they are not a gain or loss.
    (groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { if (!it.everyone) out[it.id] = it.label; }); });
    return out;
  }

  /**
   * What Save would do, per role with pending edits (in role order):
   *   { roleId, roleName, changes: [{ code, label, from, to }], gains: [labels], loses: [labels], text, warnings: [text] }
   * env: { flags, flagsLoaded, buRateSources, sessionRoles } (the app's, so the menu is the one people would get).
   */
  function consequences(roles, rowsByRole, dirtyByRole, env) {
    var e = env || {};
    var mine = (e.sessionRoles || []).map(function (c) { return String(c).toUpperCase(); });
    return (roles || []).filter(function (r) { return Object.keys((dirtyByRole || {})[r.appRoleId] || {}).length; }).map(function (role) {
      var rows = rowsByRole[role.appRoleId] || [];
      var dirty = dirtyByRole[role.appRoleId] || {};
      var name = roleName(roles, role.appRoleId);
      var before = menuItems(nav.visibleGroups(savedMap(rows), true, e.flags, e.flagsLoaded, e.buRateSources));
      var afterGroups = nav.visibleGroups(effectiveMap(rows, dirty), true, e.flags, e.flagsLoaded, e.buRateSources);
      var after = menuItems(afterGroups);
      var gains = Object.keys(after).filter(function (k) { return !(k in before); }).map(function (k) { return after[k]; });
      var loses = Object.keys(before).filter(function (k) { return !(k in after); }).map(function (k) { return before[k]; });
      var byCode = {};
      rows.forEach(function (r) { byCode[r.pageCode] = r; });
      var changes = Object.keys(dirty).map(function (code) {
        var r = byCode[code] || {};
        return { code: code, label: r.pageLabel || code, from: levelLabel(r.accessLevel || 'HIDDEN'), to: levelLabel(dirty[code]) };
      });
      var parts = [];
      if (gains.length) parts.push('gains ' + gains.join(', '));
      if (loses.length) parts.push('loses ' + loses.join(', '));
      var text = parts.length ? name + ' ' + parts.join(' and ') + ' in the menu.'
        : name + '\'s menu stays the same; only what can be changed on those screens differs.';
      var warnings = [];
      var adminBefore = savedMap(rows).EQR_RBAC_ADMIN;
      var adminAfter = effectiveMap(rows, dirty).EQR_RBAC_ADMIN;
      if (adminBefore === 'FULL' && adminAfter && adminAfter !== 'FULL') {
        warnings.push(name + ' will no longer be able to change access.'
          + (mine.indexOf(String(role.roleCode || '').toUpperCase()) !== -1 ? ' That is your role: you would lose this screen yourself.' : ''));
      }
      if (!Object.keys(after).length) warnings.push(name + ' will see no screen at all; people with only this role land on No access.');
      return { roleId: String(role.appRoleId), roleName: name, changes: changes, gains: gains, loses: loses, text: text, warnings: warnings,
        changeText: changes.map(function (c) { return c.label + ': ' + c.from + ' → ' + c.to; }).join(' · ') };
    });
  }

  /** The PUT bodies, one per role with pending edits, in role order: [{ appRoleId, entries }]. */
  function savePlan(roles, dirtyByRole) {
    return (roles || []).map(function (role) {
      var dirty = (dirtyByRole || {})[role.appRoleId] || {};
      var codes = Object.keys(dirty);
      return codes.length ? { appRoleId: Number(role.appRoleId), entries: codes.map(function (code) { return { pageCode: code, accessLevel: dirty[code] }; }) } : null;
    }).filter(Boolean);
  }

  /** New's saveMatrixChain wording for a failed PUT. */
  function saveErrorText(result) {
    var b = (result && result.body) || {};
    var detail = b.message || b.detail || b.error || (Array.isArray(b.errors) && b.errors.join('; ')) || '';
    var status = (result && (result.status || result.statusCode)) || 'no response';
    return detail
      ? 'Not saved: ' + detail + ' The changes are still here; fix the row it names and save again.'
      : 'Not saved (' + status + '). The changes are still here; try Save again in a minute.';
  }

  /** The export: the matrix as shown, a column per role ("Full (unsaved)" for a pending edit). */
  function exportColumns(roles) {
    var cols = [
      { key: 'module', label: 'Module' }, { key: 'pageLabel', label: 'Page' }, { key: 'pageCode', label: 'Page code' }, { key: 'opens', label: 'In Next' }
    ];
    (roles || []).forEach(function (role, i) {
      cols.push({ key: 'role' + i, label: role.roleName || role.roleCode || String(role.appRoleId), value: function (r) {
        var c = r.cells[i];
        if (!c || c.missing) return '';
        return levelLabel(c.level) + (c.dirty ? ' (unsaved, was ' + levelLabel(c.saved) + ')' : '') + (c.locked ? ' (locked)' : '');
      } });
    });
    return cols;
  }

  return {
    LEVELS: LEVELS,
    MODULE_LABELS: MODULE_LABELS,
    activeRoles: activeRoles,
    roleRows: roleRows,
    roleName: roleName,
    levelLabel: levelLabel,
    moduleLabel: moduleLabel,
    savedMap: savedMap,
    effectiveMap: effectiveMap,
    setLevel: setLevel,
    count: count,
    opensInNext: opensInNext,
    matrix: matrix,
    visible: visible,
    consequences: consequences,
    savePlan: savePlan,
    saveErrorText: saveErrorText,
    exportColumns: exportColumns
  };
});
