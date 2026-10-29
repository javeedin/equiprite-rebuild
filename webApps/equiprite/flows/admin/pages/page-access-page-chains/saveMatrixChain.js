define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // ONE save for the whole grid. The old saveMatrixChain (setup/rbac-admin), with the same call: PUT
  // /rbac/page-access (putRbacPageAccess), body { appRoleId, entries: [{ pageCode, accessLevel }] } holding only the
  // dirty rows, header X-User-Id from $application.user (userName, else login), after re-checking FULL access on
  // the write path. On success the edits are cleared and the matrix re-read; on failure the backend's message is
  // shown and the edits are kept.
  //
  // Differences, none in what is sent: messages go through the app's notification toast (Actions
  // .fireNotificationEvent) instead of spShowToast, and a failure also stays on the page (saveError) in words.
  class saveMatrixChain extends ActionChain {

    async run(context) {
      const { $page, $application } = context;

      const level = $application.functions.pageAccess(
        $application.variables.pageAccessMap,
        $application.variables.pageAccessLoaded,
        'EQR_RBAC_ADMIN');

      if (level !== 'FULL') {
        console.warn('[saveMatrixChain] refusing to save - EQR_RBAC_ADMIN is', level);
        await Actions.fireNotificationEvent(context, {
          summary: 'Not saved', message: 'You do not have permission to change page access.', type: 'error', displayMode: 'transient'
        });
        return;
      }

      const roleId = $page.variables.selectedRoleId;
      const dirty = $page.variables.dirtyMap || {};
      const codes = Object.keys(dirty);

      if (!roleId) {
        console.warn('[saveMatrixChain] no role selected');
        return;
      }

      if (!codes.length) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing to save', message: 'No changes to save.', type: 'info', displayMode: 'transient'
        });
        return;
      }

      if ($page.variables.isSaving) {
        return;
      }
      $page.variables.isSaving = true;
      $page.variables.saveError = '';

      try {
        const entries = codes.map(function (code) {
          return { pageCode: code, accessLevel: dirty[code] };
        });

        // RBAC_ROLE_PAGE_ACCESS.MODIFIED_BY is NOT NULL and the backend fills it from X-User-Id.
        const user = $application.user;
        const userId = (user && (user.userName || user.login)) || 'UNKNOWN';

        const result = await Actions.callRest(context, {
          endpoint: 'eqp-v1/putRbacPageAccess',
          headers: {
            'X-User-Id': String(userId)
          },
          body: {
            appRoleId: Number(roleId),
            entries: entries
          }
        });

        if (!result || !result.ok) {
          console.error('[saveMatrixChain] save failed',
            result && (result.status || result.statusCode), result && result.body);

          // The backend returns a usable 400 message for locked pages, unknown page codes, invalid levels,
          // duplicates, inactive roles and empty payloads.
          const b = (result && result.body) || {};
          const detail = b.message || b.detail || b.error
            || (Array.isArray(b.errors) && b.errors.join('; '))
            || '';
          const status = (result && (result.status || result.statusCode)) || 'no response';
          const text = detail
            ? ('Not saved: ' + detail + ' Your changes are still here; fix the row it names and save again.')
            : ('Not saved (' + status + '). Your changes are still here; try Save again in a minute.');

          $page.variables.saveError = text;
          await Actions.fireNotificationEvent(context, {
            summary: 'Page access not saved', message: text, type: 'error', displayMode: 'persist'
          });
          return; // keep dirtyMap so the user does not lose their edits
        }

        await Actions.fireNotificationEvent(context, {
          summary: 'Page access saved',
          message: 'Saved ' + entries.length + ' page' + (entries.length === 1 ? '' : 's') + '. People with this role see the change the next time they sign in.',
          type: 'confirmation', displayMode: 'transient'
        });

        // Clear on the confirmed 200, then re-read what was persisted.
        $page.variables.dirtyMap = {};

        await Actions.callChain(context, {
          chain: 'loadMatrixChain',
          params: { appRoleId: Number(roleId) }
        });
      } catch (e) {
        console.error('[saveMatrixChain] unexpected error', e);
        $page.variables.saveError = 'Unexpected error saving page access. Your changes are still here; try again.';
      } finally {
        $page.variables.isSaving = false;
      }
    }
  }

  return saveMatrixChain;
});
