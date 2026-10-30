define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
  'resources/js/accessMatrix',
  'resources/js/shellBus',
], (ActionChain, Actions, rules, access, bus) => {
  'use strict';

  // Save. New EquipRite's saveMatrixChain, once per role with changes, in role order:
  //   - EQR_RBAC_ADMIN must be Full on the write path too; nothing to save says so; a save already running is not
  //     started twice;
  //   - PUT rbac/page-access (putRbacPageAccess), header X-User-Id from $application.user (userName, else login, else
  //     UNKNOWN; RBAC_ROLE_PAGE_ACCESS.MODIFIED_BY is filled from it), body { appRoleId, entries: [{ pageCode,
  //     accessLevel }] } with only that role's changed rows;
  //   - on success that role's edits are cleared and its rows read again (GET rbac/page-access-matrix?appRoleId=);
  //   - on failure the backend's message stays on the page in words and that role's edits are kept.
  // New saved one role per click; here a click saves every changed role, each exactly as New saves one.
  class saveChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      if (rules.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RBAC_ADMIN') !== 'FULL') {
        bus.toast('Not saved: you do not have permission to change access.', 'error');
        return;
      }
      const plan = access.savePlan(v.roles, v.dirty);
      if (!plan.length) {
        bus.toast('No changes to save.', 'info');
        return;
      }
      if (v.isSaving) return;
      v.isSaving = true;
      v.saveErrors = {};
      const user = $application.user;
      const userId = (user && (user.userName || user.login)) || 'UNKNOWN';
      const saved = [];
      const failed = [];
      try {
        for (const body of plan) {
          const id = String(body.appRoleId);
          const name = access.roleName(v.roles, id);
          let result = null;
          try {
            result = await Actions.callRest(context, {
              endpoint: 'eqp-v1/putRbacPageAccess',
              headers: { 'X-User-Id': String(userId) },
              body: { appRoleId: body.appRoleId, entries: body.entries },
            });
          } catch (e) {
            result = null;
          }
          if (!result || !result.ok) {
            console.error('[access saveChain] save failed', id, result && (result.status || result.statusCode), result && result.body);
            v.saveErrors = Object.assign({}, v.saveErrors, { [id]: name + ': ' + access.saveErrorText(result) });
            failed.push(name);
            continue;
          }
          saved.push({ name, n: body.entries.length });
          const dirty = Object.assign({}, v.dirty);
          delete dirty[id];
          v.dirty = dirty;
          const again = await Actions.callRest(context, { endpoint: 'eqp-v1/getRbacPageAccessMatrix', uriParams: { appRoleId: body.appRoleId } }).catch(() => null);
          if (again && again.ok) {
            v.rowsByRole = Object.assign({}, v.rowsByRole, { [id]: access.roleRows(again.body, id) });
          }
        }
      } finally {
        v.isSaving = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
      const n = saved.reduce((s, x) => s + x.n, 0);
      if (saved.length && !failed.length) {
        bus.toast('Saved ' + n + ' change' + (n === 1 ? '' : 's') + ' for ' + saved.map((x) => x.name).join(', ') + '. People with ' + (saved.length === 1 ? 'this role' : 'these roles')
          + ' see the change the next time they sign in.', 'info');
      } else if (saved.length) {
        bus.toast('Saved ' + saved.map((x) => x.name).join(', ') + '. Not saved: ' + failed.join(', ') + ' (the reason is on the page).', 'warning');
      } else {
        bus.toast('Access was not saved. The reason is on the page; the changes are still there.', 'error');
      }
    }
  }

  return saveChain;
});
