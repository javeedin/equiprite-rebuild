define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Save the edit dialog: validate Name + Prefix, PATCH the agreement type,
  // reload the table, close the dialog.
  //
  // Prefix rules: required; uppercase alphanumeric, no spaces, 2-10 chars;
  // unique across existing types. (Auto-uppercase happens in the input's
  // on-raw-value-changed; this is the authoritative re-validation.)
  //
  // DEFERRED (server-side, live/wiring iteration — do NOT enforce here): a
  // Prefix that has already been used on a real agreement transaction cannot
  // be renamed. That check belongs on the backend once numbering is wired.
  class updateAgreementTypeChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const draft = $page.variables.EditAgreementType || {};
      const id = draft.id != null ? Number(draft.id) : null;
      if (id == null) return;

      const label  = (draft.typeLabel  || '').trim();
      const prefix = (draft.typePrefix || '').trim().toUpperCase();

      // ── Validation ──────────────────────────────────────────────────
      if (!label) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Name required',
          message: 'Please enter a name for the agreement type.',
          displayMode: 'transient', type: 'warning'
        });
        return;
      }
      if (!prefix) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Prefix required',
          message: 'Please enter a prefix (used to generate agreement numbers).',
          displayMode: 'transient', type: 'warning'
        });
        return;
      }
      if (!/^[A-Z0-9]{2,10}$/.test(prefix)) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Invalid prefix',
          message: 'Prefix must be 2-10 uppercase letters/numbers, no spaces.',
          displayMode: 'transient', type: 'warning'
        });
        return;
      }

      // Uniqueness across other types (in-memory).
      const all = $page.variables.AgreementTypeAllArray || [];
      const clash = all.some(function(t) {
        return Number(t.id) !== id &&
               String(t.typePrefix || '').toUpperCase() === prefix;
      });
      if (clash) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Prefix already in use',
          message: 'The prefix "' + prefix + '" is already used by another type.',
          displayMode: 'transient', type: 'error'
        });
        return;
      }

      // ── PATCH ───────────────────────────────────────────────────────
      // typePrefix persists once the backend TYPE_PREFIX column + DTO field
      // exist; until then MapStruct drops the unmapped field harmlessly.
      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchConfAgreementType',
        uriParams: { id: id },
        body: { typeLabel: label, typePrefix: prefix }
      });

      if (result.ok) {
        const dlg = document.getElementById('agreementTypeEditDialog');
        if (dlg) dlg.close();
        await Actions.callChain(context, { chain: 'loadAgreementTypesChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Type updated',
          message: '"' + label + '" (prefix ' + prefix + ') saved.',
          displayMode: 'transient', type: 'confirmation'
        });
      } else {
        const detail = (result.body && JSON.stringify(result.body)) || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not save',
          message: 'Failed to update the agreement type. ' + detail,
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return updateAgreementTypeChain;
});
