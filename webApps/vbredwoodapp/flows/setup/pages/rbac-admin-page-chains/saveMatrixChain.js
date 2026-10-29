define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // ONE save for the whole grid: collects every dirty row and sends a single
  // batch scoped to the selected appRoleId. Deliberately not one call per page
  // — that produces N toasts and can leave the matrix half-written if a call
  // in the middle fails.
  //
  // The payload carries appRoleId explicitly; the backend must scope all writes
  // to it and never touch another role's rows.
  class saveMatrixChain extends ActionChain {

    async run(context) {
      const { $page, $application } = context;

      // Re-check on the write path, not just on page entry: a stale tab left
      // open after an access change, or a stray event, must not be able to
      // save. Cheap, and the backend authorises independently regardless.
      const level = $application.functions.pageAccess(
        $application.variables.pageAccessMap,
        $application.variables.pageAccessLoaded,
        'EQR_RBAC_ADMIN');

      if (level !== 'FULL') {
        console.warn('[saveMatrixChain] refusing to save - EQR_RBAC_ADMIN is', level);
        $application.events.spShowToast.fireEvent(context, {
          message: 'You do not have permission to change page access.'
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
        $application.events.spShowToast.fireEvent(context, { message: 'No changes to save.' });
        return;
      }

      $page.variables.isSaving = true;

      try {
        const entries = codes.map(function (code) {
          return { pageCode: code, accessLevel: dirty[code] };
        });

        // RBAC_ROLE_PAGE_ACCESS.MODIFIED_BY is NOT NULL with no default, and the
        // backend populates it from X-User-Id (the convention its
        // RequestTraceFilter already established). Nothing else in this app sets
        // that header, so it is sent explicitly here — without it the audit
        // column cannot be attributed to the person who made the change.
        //
        // Identity comes from $application.user; providers differ on which
        // field is populated, so check both (same defensiveness as
        // loadPageAccessChain).
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
            result && result.statusCode, result && result.body);

          // The backend returns a usable 400 message for locked pages, unknown
          // page codes, invalid levels, duplicates, inactive roles and empty
          // payloads. Surface it — the status code alone tells the user nothing
          // about which page was rejected.
          const b = (result && result.body) || {};
          const detail = b.message || b.detail || b.error
            || (Array.isArray(b.errors) && b.errors.join('; '))
            || '';

          $application.events.spShowToast.fireEvent(context, {
            message: detail
              ? ('Could not save: ' + detail)
              : ('Could not save page access ('
                + ((result && result.statusCode) || 'no response') + ').')
          });
          return; // keep dirtyMap so the user does not lose their edits
        }

        $application.events.spShowToast.fireEvent(context, {
          message: 'Saved ' + entries.length + ' page'
            + (entries.length === 1 ? '' : 's') + '.'
        });

        // Clear pending edits HERE, on the confirmed 200 — do not rely on the
        // reload below to do it. The save owns this state, and delegating the
        // clear to a nested chain means any failure or early-return in that
        // chain leaves the grid stuck showing "Save N changes" for edits that
        // were already persisted.
        $page.variables.dirtyMap = {};

        // Then re-read, so the grid shows what was actually persisted rather
        // than what we assumed (and picks up anything the backend normalised).
        await Actions.callChain(context, {
          chain: 'loadMatrixChain',
          params: { appRoleId: Number(roleId) }
        });
      } catch (e) {
        console.error('[saveMatrixChain] unexpected error', e);
        $application.events.spShowToast.fireEvent(context, {
          message: 'Unexpected error saving page access.'
        });
      } finally {
        $page.variables.isSaving = false;
      }
    }
  }

  return saveMatrixChain;
});
