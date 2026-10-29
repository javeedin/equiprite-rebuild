define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/addAgreementTypeChain.js, unchanged.

  // Create a new agreement type from the inline add form, then reload the table.
  class addAgreementTypeChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const draft = $page.variables.NewAgreementType || {};

      const label  = (draft.typeLabel  || '').trim();
      const prefix = (draft.typePrefix || '').trim().toUpperCase();

      if (!label) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Type name required',
          message: 'Please enter a name for the agreement type before adding.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      // Prefix rules mirror the edit dialog (updateAgreementTypeChain):
      // required; 2-10 uppercase letters/numbers, no spaces; unique across
      // existing types. Prefix generates agreement numbers as PREFIX-#### later.
      if (!prefix) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Prefix required',
          message: 'Please enter a prefix (used to generate agreement numbers).',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }
      if (!/^[A-Z0-9]{2,10}$/.test(prefix)) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Invalid prefix',
          message: 'Prefix must be 2-10 uppercase letters/numbers, no spaces.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      // Derive the stored code from the label: uppercase, spaces/punctuation -> underscores.
      // e.g. "Demo Agreement" -> "DEMO_AGREEMENT". Keeps the stored value stable & clean
      // while the user only types the friendly name.
      const code = label
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')   // any run of non-alphanumerics -> single underscore
        .replace(/^_+|_+$/g, '');       // trim leading/trailing underscores

      if (!code) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Invalid type name',
          message: 'The name must contain at least one letter or number.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      // Auto-assign display order = (highest existing order) + 1, so new types
      // always append to the bottom of the list with no collisions. The user
      // never sets order manually.
      const existing = $page.variables.AgreementTypeAllArray || [];

      // Prefix must be unique across existing types (in-memory check).
      const clash = existing.some(function(t) {
        return String(t.typePrefix || '').toUpperCase() === prefix;
      });
      if (clash) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Prefix already in use',
          message: 'The prefix "' + prefix + '" is already used by another type.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      const maxOrder = existing.reduce(function(m, t) {
        const o = (t && t.displayOrder != null) ? Number(t.displayOrder) : 0;
        return o > m ? o : m;
      }, 0);

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/createConfAgreementType',
        body: {
          typeCode:     code,
          typeLabel:    label,
          typePrefix:   prefix,
          isActive:     'Y',
          displayOrder: maxOrder + 1
        }
      });

      if (result.ok) {
        // Reset the add form
        $page.variables.NewAgreementType = { typeLabel: '', typePrefix: '' };
        await Actions.callChain(context, { chain: 'loadAgreementTypesChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Type added',
          message: '"' + label + '" (prefix ' + prefix + ') is now available when creating agreements.',
          displayMode: 'transient',
          type: 'confirmation'
        });
      } else {
        const detail = (result.body && JSON.stringify(result.body)) || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not add type',
          message: 'The type code may already exist. ' + detail,
          displayMode: 'transient',
          type: 'error'
        });
      }
    }
  }

  return addAgreementTypeChain;
});
