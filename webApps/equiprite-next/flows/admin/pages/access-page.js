define(['resources/js/exportKit', 'resources/js/accessMatrix'], (exportKit, access) => {
  'use strict';

  // Access: binding helpers. The logic is resources/js/accessMatrix.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }

    levels() { return access.LEVELS; }

    levelLabel(level) { return access.levelLabel(level); }

    /** A row of the matrix: the page column, then a column per role. */
    rowStyle(n) {
      return { gridTemplateColumns: 'minmax(230px, 2fr) repeat(' + Math.max(1, Number(n) || 0) + ', minmax(132px, 1fr))' };
    }

    gridStyle(n) {
      return { minWidth: (250 + Math.max(1, Number(n) || 0) * 144) + 'px' };
    }

    /** CSS class of a cell. */
    cellClass(c) {
      return 'nx-ac-cell nx-ac-lvl--' + (c && c.level ? c.level : 'none') + (c && c.dirty ? ' nx-ac-cell--dirty' : '') + (c && c.locked ? ' nx-ac-cell--locked' : '');
    }

    roleSub(role) { return role && role.roleName && role.roleCode && role.roleName !== role.roleCode ? role.roleCode : ''; }

    saveLabel(n, saving) {
      if (saving) return 'Saving…';
      return n ? 'Save ' + n + ' change' + (n === 1 ? '' : 's') : 'Save';
    }

    pendingText(n, roles) {
      return n + ' unsaved change' + (n === 1 ? '' : 's') + ' for ' + roles + (roles === 1 ? ' role' : ' roles') + '. Nothing is written until you save.';
    }

    errorList(errors) {
      return Object.keys(errors || {}).map((k) => errors[k]);
    }

    countChanged(rows) { return (rows || []).filter((r) => r.cells.some((c) => c.dirty)).length; }

    countLocked(rows) { return (rows || []).filter((r) => r.cells.some((c) => c.locked)).length; }

    pressed(on) { return on ? 'true' : 'false'; }

    // ── The Redwood view (your menu, Look): Oracle's general overview page as the header, its buttons the current
    //    look's (Save, Discard, Export). Arrays and objects for its bindings come from here; an action's display is on,
    //    off or disabled (oj-sp reads only that). ──

    /** Save N changes: disabled until a level is changed, or for a role that may not edit. */
    rwPrimary(n, saving, canEdit) {
      const label = saving ? 'Saving…' : (n ? 'Save ' + n + ' change' + (n === 1 ? '' : 's') : 'Save');
      return { label, icon: 'oj-ux-ico-save', display: !canEdit || !n || saving ? 'disabled' : 'on' };
    }

    /** Discard (while something is changed) and Export to Excel (the matrix as shown). */
    rwActions(n, saving, rows) {
      return [
        { id: 'discard', label: 'Discard', icon: 'oj-ux-ico-undo', display: n > 0 ? (saving ? 'disabled' : 'on') : 'off' },
        { id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: rows ? 'on' : 'disabled' },
      ];
    }
  }

  return PageModule;
});
